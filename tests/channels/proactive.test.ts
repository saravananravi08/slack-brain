import { describe, expect, it, vi } from 'vitest';

import type { ChannelContext } from '../../src/channel-memory/context/index.js';
import { parseConfig } from '../../src/config.js';
import {
  ALL_MESSAGES_PROACTIVE_CLASSIFIER,
  OpenAIProactiveClassifier,
  ProactiveActionGate,
} from '../../src/mastra/channels/proactive.js';
import type { ChannelRequest } from '../../src/mastra/channels/types.js';

const CHANNEL = 'C0APPROVED1';
const REQUEST: ChannelRequest = {
  surface: 'channel_mention',
  workspaceId: 'T0SYNTH01',
  channelId: CHANNEL,
  threadId: `slack:${CHANNEL}:1735689650.000100`,
  messageTs: '1735689650.000100',
  senderId: 'U0MEMBER01',
  senderName: 'Synthetic Member',
  text: 'synthetic proactive candidate',
  isDirectMessage: false,
};
const CONTEXT = {
  contract_version: '1.0.0',
  sections: [],
  token_count: 0,
  token_limit: 6_000,
} as unknown as ChannelContext;

function validEnvironment(): Record<string, string> {
  return {
    SLACK_BOT_TOKEN: 'xoxb-synthetic-credential',
    SLACK_APP_TOKEN: 'xapp-synthetic-credential',
    GIST_APPROVED_WORKSPACE_ID: 'T0SYNTH01',
    GIST_USER_ALLOWLIST: '',
    GIST_DM_SHARED_KNOWLEDGE: 'false',
    EMBEDDING_MODEL: 'openai/text-embedding-3-small',
    OPENAI_API_KEY: 'synthetic-openai-credential',
    MASTRA_DATABASE_URL: 'file:/var/lib/gist-synthetic/mastra.db',
  };
}

describe('D021/D022 proactive configuration', () => {
  it('parses proactive channels and cooldown like validated policy inputs', () => {
    const config = parseConfig({
      ...validEnvironment(),
      GIST_PROACTIVE_CHANNELS: ' C0APPROVED1,G0APPROVED2 ',
      GIST_PROACTIVE_COOLDOWN_MS: '15000',
    });

    expect(config.proactiveChannelIds).toEqual(['C0APPROVED1', 'G0APPROVED2']);
    expect(config.proactiveCooldownMs).toBe(15_000);
    expect(Object.isFrozen(config.proactiveChannelIds)).toBe(true);
  });

  it('defaults to all enrolled channels with a 60 second cooldown', () => {
    const config = parseConfig(validEnvironment());

    expect(config.proactiveChannelIds).toEqual([]);
    expect(config.proactiveCooldownMs).toBe(60_000);
  });

  it.each([
    ['GIST_PROACTIVE_CHANNELS', 'D0DIRECT01'],
    ['GIST_PROACTIVE_CHANNELS', 'C0APPROVED1,C0APPROVED1'],
    ['GIST_PROACTIVE_COOLDOWN_MS', '-1'],
  ])('rejects malformed %s', (variable, value) => {
    expect(() => parseConfig({ ...validEnvironment(), [variable]: value }))
      .toThrow(`Invalid configuration: ${variable}`);
  });
});

describe('temporary all-messages proactive mode', () => {
  it('acts deterministically without model relevance judgment', async () => {
    await expect(ALL_MESSAGES_PROACTIVE_CLASSIFIER.classify({
      context: CONTEXT,
      messageTs: REQUEST.messageTs,
    })).resolves.toEqual({ act: true, reason: 'all_messages_mode' });
  });
});

describe('ProactiveActionGate', () => {
  it('enables an enrolled channel when the restriction list is empty', async () => {
    const classify = vi.fn(async () => ({ act: false, reason: 'synthetic_irrelevance' }));
    const isEnrolled = vi.fn(async () => true);
    const gate = new ProactiveActionGate({
      channelIds: [],
      cooldownMs: 60_000,
      classifier: { classify },
      contextFor: async () => CONTEXT,
      isEnrolled,
    });

    await expect(gate.evaluate(REQUEST)).resolves.toBe(false);
    expect(isEnrolled).toHaveBeenCalledWith(REQUEST.workspaceId, CHANNEL);
    expect(classify).toHaveBeenCalledOnce();
  });

  it('keeps a non-empty list restrictive without consulting enrollment', async () => {
    const classify = vi.fn(async () => ({ act: true, reason: 'synthetic_relevance' }));
    const isEnrolled = vi.fn(async () => true);
    const gate = new ProactiveActionGate({
      channelIds: ['C0OTHER001'],
      cooldownMs: 60_000,
      classifier: { classify },
      contextFor: async () => CONTEXT,
      isEnrolled,
    });

    await expect(gate.evaluate(REQUEST)).resolves.toBe(false);
    expect(isEnrolled).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it('serializes per-channel actions and applies cooldown before a second classification', async () => {
    const classify = vi.fn(async () => ({ act: true, reason: 'synthetic_relevance' }));
    const gate = new ProactiveActionGate({
      channelIds: [CHANNEL],
      cooldownMs: 60_000,
      classifier: { classify },
      contextFor: async () => CONTEXT,
      isEnrolled: async () => true,
      now: () => 1_000,
    });

    await expect(Promise.all([gate.evaluate(REQUEST), gate.evaluate(REQUEST)]))
      .resolves.toEqual([true, false]);
    expect(classify).toHaveBeenCalledOnce();
  });
});

describe('OpenAIProactiveClassifier', () => {
  it('makes one deterministic JSON-schema call over bounded T704 context', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"act":true,"reason":"synthetic_relevance"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const classifier = new OpenAIProactiveClassifier({
      apiKey: 'synthetic-openai-credential',
      model: 'gpt-4.1-mini',
      fetch: fetchMock,
    });

    await expect(classifier.classify({
      context: CONTEXT,
      messageTs: REQUEST.messageTs,
    })).resolves.toEqual({ act: true, reason: 'synthetic_relevance' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      temperature: number;
      max_completion_tokens: number;
      messages: Array<{ content: string }>;
      response_format: {
        type: string;
        json_schema: { name: string; strict: boolean };
      };
    };
    expect(body).toMatchObject({
      model: 'gpt-4.1-mini',
      temperature: 0,
      max_completion_tokens: 120,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'gist_proactive_decision', strict: true },
      },
    });
    expect(body.messages[1]!.content).toContain('<untrusted_channel_context>');
    expect(body.messages[1]!.content).toContain(`Target message_ts: ${REQUEST.messageTs}`);
  });
});
