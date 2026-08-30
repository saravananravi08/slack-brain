import type { SlackAdapter } from '@chat-adapter/slack';
import { MastraStateAdapter } from '@mastra/core/channels';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLVector } from '@mastra/libsql';

import { parseConfig, type Config } from '../config.js';
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
import {
  ChannelError,
  createSlackChannel,
  type GistSlackChannel,
} from './channels/index.js';
import type { ChannelRequest } from './channels/types.js';
import { createGistMemory } from './memory/gist-memory.js';
import {
  IDENTITY_CONTRACT_VERSION,
  resolveIdentity,
} from './memory/resource-policy.js';
import {
  StorageUnavailableError,
  createMastraStorage,
} from './storage/index.js';
import { createGistObservability } from './storage/observability.js';

const databaseUrl = process.env.MASTRA_DATABASE_URL;

export const storage = createMastraStorage(
  databaseUrl ? { databaseUrl } : undefined,
);
export const observability = createGistObservability();

export const mastra = new Mastra({
  storage,
  observability,
  loggerOptions: { export: false },
});

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
  if (response.ok !== true || user?.id !== input.senderId) return null;

  const senderType = user.is_app_user
    ? 'app'
    : user.is_bot || user.is_connector_bot || user.is_workflow_bot
      ? 'bot'
      : 'human';

  return {
    senderType,
    isExternal:
      user.is_stranger === true ||
      (typeof user.team_id === 'string' && user.team_id !== input.workspaceId),
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

export interface FoundationRuntime {
  readonly config: Readonly<Config>;
  readonly mastra: Mastra;
  readonly channel: GistSlackChannel;
  readonly memory: ReturnType<typeof createGistMemory>;
  readonly gistAgent: ReturnType<typeof createGistAgent>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createFoundationRuntime(
  options: FoundationRuntimeOptions = {},
): Promise<FoundationRuntime> {
  const config = parseConfig();

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
  let channel: GistSlackChannel;
  const resolveSender: SenderResolver =
    options.resolveSender ?? ((input) => resolveSlackSender(channel.adapter, input));
  const authorizedContexts = new WeakMap<
    ChannelRequest,
    {
      event: AuthorizationEvent;
      identity: ReturnType<typeof resolveIdentity>;
    }
  >();

  channel = createSlackChannel({
    credentials: {
      botToken: config.slackBotToken,
      appToken: config.slackAppToken,
    },
    state: new MastraStateAdapter(memoryStore, () => gistAgent.id),
    authorize: async (request) => {
      let context:
        | {
            event: AuthorizationEvent;
            identity: ReturnType<typeof resolveIdentity>;
          }
        | undefined;
      const decision = await createChannelAuthorizer({
        policy,
        resolveSender,
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

      const response = await gistAgent.stream(request.text, {
        memory: {
          resource: context.identity.resource_id,
          thread: context.identity.thread_id,
        },
      });
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
