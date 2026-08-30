import type { SlackAdapter } from '@chat-adapter/slack';
import type { MastraDBMessage } from '@mastra/core/agent';
import { MastraStateAdapter } from '@mastra/core/channels';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLVector, type LibSQLStore } from '@mastra/libsql';

import { parseConfig, type Config } from '../config.js';
import {
  AmbientPersistenceService,
  MastraMutationStorage,
  MutationHandler,
  sentAtFrom,
} from '../ingestion/index.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  authorize,
  createChannelAuthorizer,
  policySnapshotFromConfig,
  type AuthorizationEvent,
  type SenderAttributes,
  type SenderResolver,
} from '../security/index.js';
import { createGistAgent, createGistModel } from './agents/gist.js';
import { ChannelError } from './channels/index.js';
import {
  createLiveSlackChannel,
  type LiveGistSlackChannel,
} from './channels/slack.js';
import type { ChannelRequest } from './channels/types.js';
import { createGistMemory } from './memory/gist-memory.js';
import {
  IDENTITY_CONTRACT_VERSION,
  messageKey,
  resolveIdentity,
} from './memory/resource-policy.js';
import {
  StorageUnavailableError,
  createMastraStorage,
} from './storage/index.js';
import { createGistObservability } from './storage/observability.js';

/**
 * Storage and the configured runtime Mastra instance are built inside
 * {@link createFoundationRuntime}, from the **validated** configuration.
 * The empty module-level `mastra` export is only the configuration-free entry
 * Mastra CLI requires for build discovery.
 *
 * They used to be module-level configured singletons constructed from a raw
 * `process.env.MASTRA_DATABASE_URL` read, falling back to a default path and
 * creating that directory with `mkdirSync` as an import side effect. That ran
 * before `parseConfig()`, so a process with missing or invalid configuration
 * still got a working database somewhere reasonable — precisely the defaulted
 * start D001 and FR-OPS-001 forbid (design review F-05). Importing this module
 * now touches no filesystem and reads no environment variable.
 */
export const mastra = new Mastra({});

export function createRuntimeStorage(config: Readonly<Config>): LibSQLStore {
  return createMastraStorage({ databaseUrl: config.databaseUrl });
}

export function createRuntimeMastra(storage: LibSQLStore): {
  mastra: Mastra;
  observability: ReturnType<typeof createGistObservability>;
} {
  const observability = createGistObservability();
  return {
    mastra: new Mastra({ storage, observability, loggerOptions: { export: false } }),
    observability,
  };
}

export interface FoundationRuntimeOptions {
  /** Test/deployment seam. Absence uses Slack users.info and fails closed. */
  readonly resolveSender?: SenderResolver;
}

export async function resolveSlackSender(
  adapter: SlackAdapter,
  input: { readonly workspaceId: string; readonly senderId: string },
): Promise<SenderAttributes | null> {
  const response = await adapter.webClient.users.info({ user: input.senderId });
  const user = response.user;
  if (
    response.ok !== true ||
    user?.id !== input.senderId ||
    typeof user.team_id !== 'string'
  ) return null;

  const senderType = user.is_app_user
    ? 'app'
    : user.is_bot || user.is_connector_bot || user.is_workflow_bot
      ? 'bot'
      : 'human';

  return {
    senderType,
    isExternal: user.team_id !== input.workspaceId,
    isGuest: user.is_restricted === true || user.is_ultra_restricted === true,
    isDeactivated: user.deleted === true,
  };
}

function identityForChannelRequest(
  request: ChannelRequest,
  adapter: SlackAdapter,
) {
  if (!request.workspaceId) {
    throw new TypeError('Cannot resolve identity without a workspace.');
  }

  const { channel, threadTs } = adapter.decodeThreadId(request.threadId);
  if (channel !== request.channelId) {
    throw new TypeError('Channel request and thread identity do not match.');
  }

  return resolveIdentity({
    contract_version: IDENTITY_CONTRACT_VERSION,
    workspace_id: request.workspaceId,
    channel_id: request.channelId,
    conversation_type: request.isDirectMessage ? 'dm' : 'channel',
    message_ts: request.messageTs,
    thread_ts: threadTs === '' ? null : threadTs,
    sender_id: request.senderId,
  });
}

/**
 * Build the user turn the agent persists, as the canonical record for that
 * Slack message.
 *
 * The agent's own Mastra memory writes the user turn as a row of its own. Left
 * to itself it assigns a random UUID, so the same Slack message ended up
 * stored twice — once here and once by the ingestion writers under
 * `messageKey` — and `MutationHandler`, which resolves targets by `messageKey`,
 * could reach only one of them. A user deleting their message left its text in
 * memory, and recall saw the message twice (design review F-17, confirmed by
 * `tests/integration/live-ingestion/f17-diagnostic.test.ts`).
 *
 * Assigning the ID alone is not enough. Once both writers share a key, the
 * ambient writer compares what it finds against its canonical shape and
 * refuses to overwrite a row it did not recognise — so a bare agent row would
 * turn every subscribed-thread message into a `content_conflict`. The row this
 * builds is therefore identical to the one `ambient-persistence.ts` writes,
 * field for field, so whichever writer gets there first the other converges on
 * it.
 *
 * `messageKey` throws on identifiers that do not satisfy the identity
 * contract. Every caller here has already passed `authorize`, which resolves
 * an identity over the same workspace, channel, and timestamp, so a throw
 * would mean the guard admitted something it should not have.
 */
export function agentUserTurn(input: {
  readonly identity: ReturnType<typeof resolveIdentity>;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly messageTs: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly text: string;
}): MastraDBMessage {
  const key = messageKey({
    workspace_id: input.workspaceId,
    channel_id: input.channelId,
    message_ts: input.messageTs,
  });
  const sentAt = sentAtFrom(input.messageTs) ?? new Date().toISOString();

  return {
    id: key,
    role: 'user',
    // The row describes the Slack message, not the moment the agent ran.
    createdAt: new Date(sentAt),
    threadId: input.identity.thread_id,
    resourceId: input.identity.resource_id,
    content: {
      format: 2,
      parts: [{ type: 'text', text: input.text }],
      metadata: {
        contract_version: '1.0.0',
        message_key: key,
        boundary_id: input.identity.boundary_id,
        thread_id: input.identity.thread_id,
        conversation_type: input.identity.conversation_type,
        sender_id: input.senderId,
        sender_name: input.senderName,
        sent_at: sentAt,
        message_ts: input.messageTs,
        channel_id: input.channelId,
        edited_at: null,
        source: 'live',
      },
    },
  } as MastraDBMessage;
}

export interface FoundationRuntime {
  readonly config: Readonly<Config>;
  readonly mastra: Mastra;
  readonly channel: LiveGistSlackChannel;
  readonly memory: ReturnType<typeof createGistMemory>;
  readonly gistAgent: ReturnType<typeof createGistAgent>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createFoundationRuntime(
  options: FoundationRuntimeOptions = {},
): Promise<FoundationRuntime> {
  // Configuration first: an invalid environment must stop the process before
  // anything touches the filesystem (F-05).
  const config = parseConfig();

  const storage = createRuntimeStorage(config);
  const { mastra } = createRuntimeMastra(storage);

  await storage.init();
  const memoryStore = await storage.getStore('memory');
  if (!memoryStore) throw new StorageUnavailableError();

  const memory = createGistMemory({
    storage,
    databaseUrl: config.databaseUrl,
    embeddingModel: config.embeddingModel,
  });
  const gistAgent = createGistAgent(createGistModel(config.gistModel), memory);
  mastra.addAgent(gistAgent, 'gist');

  const policy = policySnapshotFromConfig(config);
  const state = new MastraStateAdapter(memoryStore, () => gistAgent.id);
  const mutationStorage = new MastraMutationStorage({ memory, storage });
  const mutations = new MutationHandler({ storage: mutationStorage, policy });
  const ambientPersistence = new AmbientPersistenceService({
    memory,
    storage,
    resolveIdentity,
    authorizeWrite: ({ event, identity }) => authorize({
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      gate: 'write_memory',
      event,
      identity,
      policy,
    }),
  });

  let channel: LiveGistSlackChannel;
  const resolveSender: SenderResolver =
    options.resolveSender ?? ((input) => resolveSlackSender(channel.adapter, input));
  const authorizedContexts = new WeakMap<
    ChannelRequest,
    {
      event: AuthorizationEvent;
      identity: ReturnType<typeof resolveIdentity>;
    }
  >();

  channel = createLiveSlackChannel({
    credentials: {
      botToken: config.slackBotToken,
      appToken: config.slackAppToken,
    },
    state,
    policy,
    resolveSender,
    ambientPersistence,
    mutations,
    authorize: async (request) => {
      let context:
        | {
            event: AuthorizationEvent;
            identity: ReturnType<typeof resolveIdentity>;
          }
        | undefined;
      const decision = await createChannelAuthorizer({
        policy,
        resolveSender: async (input) => {
          const attributes = await resolveSender(input);
          if (!attributes) return null;
          return channel.adapter.getChannelVisibility(request.threadId) === 'external'
            ? { ...attributes, isExternal: true }
            : attributes;
        },
        resolveIdentity: (event) => {
          const identity = identityForChannelRequest(request, channel.adapter);
          context = { event, identity };
          return identity;
        },
      })(request);

      if (decision.allowed && context) authorizedContexts.set(request, context);
      return decision;
    },
    respond: async (request) => {
      const context = authorizedContexts.get(request);
      authorizedContexts.delete(request);
      if (!context) throw new ChannelError('unauthorized');

      for (const gate of ['read_memory', 'write_memory'] as const) {
        const decision = authorize({
          contract_version: AUTHORIZATION_CONTRACT_VERSION,
          gate,
          event: context.event,
          identity: context.identity,
          policy,
        });
        if (!decision.allowed) throw new ChannelError('unauthorized');
        if (gate === 'read_memory' && !decision.scope.includes(context.identity.boundary_id)) {
          throw new ChannelError('unauthorized');
        }
      }

      const response = await gistAgent.stream(
        agentUserTurn({
          identity: context.identity,
          workspaceId: context.event.workspace_id,
          channelId: context.event.channel_id,
          messageTs: request.messageTs,
          senderId: context.event.sender_id,
          senderName: request.senderName,
          text: request.text,
        }),
        {
          memory: {
            resource: context.identity.resource_id,
            thread: context.identity.thread_id,
          },
        },
      );
      return response.textStream;
    },
  });

  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    config,
    mastra,
    channel,
    memory,
    gistAgent,
    start: () => {
      startPromise ??= channel.start();
      return startPromise;
    },
    stop: () => {
      stopPromise ??= (async () => {
        let failure: unknown;
        for (const settle of [
          () => channel.stop(),
          () => memory.settled(),
          () =>
            memory.vector instanceof LibSQLVector
              ? memory.vector.close()
              : Promise.resolve(),
          () => mastra.shutdown(),
        ]) {
          try {
            await settle();
          } catch (error) {
            failure ??= error;
          }
        }
        if (failure) throw failure;
      })();
      return stopPromise;
    },
  };
}
