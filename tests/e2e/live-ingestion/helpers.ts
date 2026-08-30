import type { Chat, WebhookOptions } from 'chat';
import { vi } from 'vitest';

import type {
  AmbientPersistenceInput,
  CheckOriginalInput,
  HandleMutationInput,
} from '../../../src/ingestion/index.js';
import { createLiveSlackChannel } from '../../../src/mastra/channels/slack.js';
import type {
  PolicySnapshot,
  SenderAttributes,
} from '../../../src/security/index.js';
import { makeMemoryState } from '../../spikes/slack-events/helpers.js';
import { SYNTHETIC } from './fixtures.js';

const FULL_MEMBER: SenderAttributes = {
  senderType: 'human',
  isExternal: false,
  isGuest: false,
  isDeactivated: false,
};

const POLICY: PolicySnapshot = {
  approved_workspace_id: SYNTHETIC.workspace,
  approved_channel_ids: [SYNTHETIC.channel],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

interface AdapterInternals {
  _botUserId: string;
  chat: Chat;
  lookupUser(userId: string): Promise<unknown>;
  postMessage(threadId: string, body: unknown): Promise<unknown>;
  processEventPayload(payload: Record<string, unknown>, options?: WebhookOptions): void;
  startTyping(threadId: string): Promise<void>;
}

export function createAmbientE2EHarness() {
  const state = makeMemoryState();
  const posts: Array<{ threadId: string; body: unknown }> = [];
  const generation = vi.fn(async () => 'Synthetic reply.');
  const resolveSender = vi.fn(async () => FULL_MEMBER);
  const persist = vi.fn(async (_input: AmbientPersistenceInput) => ({
    outcome: 'inserted' as const,
  }));
  const shouldSuppressOriginal = vi.fn(async (_input: CheckOriginalInput) => ({
    status: 'allowed' as const,
    suppressed: false,
  }));
  const handleMutation = vi.fn(async (_input: HandleMutationInput) => ({
    status: 'unchanged' as const,
    message_key: `${SYNTHETIC.workspace}/${SYNTHETIC.channel}/${SYNTHETIC.rootTs}` as const,
  }));

  const channel = createLiveSlackChannel({
    credentials: {
      botToken: SYNTHETIC.botToken,
      appToken: SYNTHETIC.appToken,
    },
    state,
    policy: POLICY,
    resolveSender,
    ambientPersistence: { persist },
    mutations: {
      handle: handleMutation,
      shouldSuppressOriginal,
    },
    authorize: async () => ({ allowed: true, reason: null }),
    respond: generation,
  });

  const adapter = channel.adapter as unknown as AdapterInternals;
  adapter._botUserId = SYNTHETIC.botUserId;
  adapter.lookupUser = async (userId) => ({
    displayName: `synthetic.${userId}`,
    realName: `Synthetic ${userId}`,
    isBot: false,
  });
  adapter.postMessage = async (threadId, body) => {
    posts.push({ threadId, body });
    return { id: 'synthetic-post', raw: {} };
  };
  adapter.startTyping = async () => undefined;
  adapter.chat = channel.bot;

  const pending: Array<Promise<unknown>> = [];
  const chatInternals = channel.bot as unknown as Record<string, (...args: never[]) => unknown>;
  for (const method of ['processMessage', 'processMessageUpdated', 'processMessageDeleted']) {
    const original = chatInternals[method];
    if (typeof original !== 'function') throw new Error(`Missing Chat.${method}`);
    const bound = original.bind(channel.bot);
    chatInternals[method] = (...args: never[]) => {
      const result = bound(...args);
      pending.push(Promise.resolve(result));
      return result;
    };
  }

  async function deliver(payload: Record<string, unknown>): Promise<void> {
    adapter.processEventPayload(payload, {
      waitUntil: (task) => pending.push(task),
    });
    for (let round = 0; round < 8; round += 1) {
      const inFlight = pending.splice(0);
      if (inFlight.length > 0) await Promise.all(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (pending.length === 0 && round > 0) return;
    }
    throw new Error('Synthetic Slack delivery did not settle.');
  }

  return {
    deliver,
    generation,
    handleMutation,
    persist,
    posts,
    resolveSender,
    shouldSuppressOriginal,
    state,
  };
}

export function expectSilent(harness: ReturnType<typeof createAmbientE2EHarness>): void {
  if (harness.generation.mock.calls.length !== 0) {
    throw new Error('Ambient event invoked generation.');
  }
  if (harness.posts.length !== 0) {
    throw new Error('Ambient event posted to Slack.');
  }
}
