import type { Thread } from 'chat';
import { describe, expect, it } from 'vitest';

import { handleTurn } from '../../src/mastra/channels/handlers.js';
import type { SlackChannelOptions } from '../../src/mastra/channels/types.js';
import { makeMemoryState, makeMessage, SYNTHETIC } from '../channels/helpers.js';
import { elapsedMs, summarizeLatency } from './metrics.js';

const SAMPLE_COUNT = 20;

describe('T503 addressed response latency boundaries', () => {
  it('tracks typing, first content, and completion for every accepted turn', async () => {
    const typingLatencies: number[] = [];
    const firstContentLatencies: number[] = [];
    const completionLatencies: number[] = [];

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now();
      let firstContentMs: number | undefined;
      let postCount = 0;
      const thread = {
        id: `slack:${SYNTHETIC.channelApproved}:1735689${String(index).padStart(3, '0')}.000100`,
        channelId: SYNTHETIC.channelApproved,
        isDM: false,
        startTyping: async () => {
          typingLatencies.push(elapsedMs(startedAt));
        },
        subscribe: async () => undefined,
        post: async (body: unknown) => {
          postCount += 1;
          if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
            for await (const chunk of body as AsyncIterable<string>) {
              if (chunk.length > 0) firstContentMs ??= elapsedMs(startedAt);
            }
          }
        },
      } as unknown as Thread;
      const options: SlackChannelOptions = {
        credentials: {
          botToken: SYNTHETIC.botToken,
          appToken: SYNTHETIC.appToken,
        },
        state: makeMemoryState(),
        authorize: async () => ({ allowed: true, reason: null }),
        respond: async () => (async function* response() {
          await new Promise((resolve) => setTimeout(resolve, 1));
          yield 'Synthetic response.';
        }()),
      };

      await handleTurn(
        'subscribed_thread',
        thread,
        makeMessage({ ts: `1735689${String(index).padStart(3, '0')}.000200` }),
        false,
        options,
      );
      completionLatencies.push(elapsedMs(startedAt));
      expect(postCount).toBe(1);
      expect(firstContentMs).toBeDefined();
      firstContentLatencies.push(firstContentMs!);
    }

    const typing = summarizeLatency(typingLatencies);
    const firstContent = summarizeLatency(firstContentLatencies);
    const completion = summarizeLatency(completionLatencies);
    expect(typing.p95).toBeLessThan(2_000);
    expect(firstContent.p90).toBeLessThan(5_000);
    expect(completion.p95).toBeLessThan(60_000);
    console.info('T503_METRIC response_boundary', JSON.stringify({
      samples: SAMPLE_COUNT,
      typing_ms: typing,
      first_content_ms: firstContent,
      complete_ms: completion,
    }));
  });
});
