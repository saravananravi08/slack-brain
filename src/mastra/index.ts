import { MastraStateAdapter } from '@mastra/core/channels';
import { Mastra } from '@mastra/core/mastra';

import { parseConfig, type Config } from '../config.js';
import { createGistAgent, createGistModel } from './agents/gist.js';
import {
  createSlackChannel,
  type GistSlackChannel,
} from './channels/index.js';
import type {
  ChannelAuthorizationDecision,
  ChannelRequest,
} from './channels/types.js';
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

function authorizeFoundationRequest(
  config: Readonly<Config>,
  request: ChannelRequest,
): ChannelAuthorizationDecision {
  if (!request.workspaceId) {
    return { allowed: false, reason: 'identity_unresolved' };
  }
  if (request.workspaceId !== config.approvedWorkspaceId) {
    return { allowed: false, reason: 'unapproved_workspace' };
  }
  if (!request.isDirectMessage && !config.approvedChannelIds.includes(request.channelId)) {
    return { allowed: false, reason: 'unapproved_channel' };
  }
  if (config.userAllowlist.length > 0 && !config.userAllowlist.includes(request.senderId)) {
    return { allowed: false, reason: 'not_in_allowlist' };
  }
  return { allowed: true, reason: null };
}

export interface FoundationRuntime {
  readonly config: Readonly<Config>;
  readonly mastra: Mastra;
  readonly channel: GistSlackChannel;
  readonly gistAgent: ReturnType<typeof createGistAgent>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createFoundationRuntime(): Promise<FoundationRuntime> {
  const config = parseConfig();
  const gistAgent = createGistAgent(createGistModel(config.gistModel));
  mastra.addAgent(gistAgent, 'gist');

  await storage.init();
  const memoryStore = await storage.getStore('memory');
  if (!memoryStore) throw new StorageUnavailableError();

  const channel = createSlackChannel({
    credentials: {
      botToken: config.slackBotToken,
      appToken: config.slackAppToken,
    },
    state: new MastraStateAdapter(memoryStore, () => gistAgent.id),
    authorize: (request) => authorizeFoundationRequest(config, request),
    respond: async (request) => {
      const response = await gistAgent.stream(request.text);
      return response.textStream;
    },
  });

  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    config,
    mastra,
    channel,
    gistAgent,
    start: () => {
      startPromise ??= channel.start();
      return startPromise;
    },
    stop: () => {
      stopPromise ??= (async () => {
        let failure: unknown;
        try {
          await channel.stop();
        } catch (error) {
          failure = error;
        }
        try {
          await mastra.shutdown();
        } catch (error) {
          failure ??= error;
        }
        if (failure) throw failure;
      })();
      return stopPromise;
    },
  };
}
