import { describe, expect, it } from 'vitest';

import {
  GPT_4_1_PRICING_USD_PER_MILLION,
  gpt41CostUsd,
  nearestRankPercentile,
  summarizeLatency,
} from './metrics.js';

describe('T503 response metrics', () => {
  it('uses accepted D012 GPT-4.1 token prices', () => {
    expect(GPT_4_1_PRICING_USD_PER_MILLION).toEqual({
      input: 2,
      cachedInput: 0.5,
      output: 8,
    });
    expect(gpt41CostUsd({
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    })).toBe(10);
    expect(gpt41CostUsd({
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    })).toBe(0.5);
  });

  it('rejects impossible usage rather than understating cost', () => {
    expect(() => gpt41CostUsd({
      inputTokens: 10,
      cachedInputTokens: 11,
      outputTokens: 1,
    })).toThrow('cachedInputTokens cannot exceed inputTokens');
  });

  it('reports nearest-rank p50, p90, and p95 without averaging away spikes', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);

    expect(nearestRankPercentile(samples, 0.5)).toBe(10);
    expect(summarizeLatency(samples)).toEqual({
      samples: 20,
      p50: 10,
      p90: 18,
      p95: 19,
      min: 1,
      max: 20,
    });
  });
});
