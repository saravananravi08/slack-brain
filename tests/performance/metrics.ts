export const GPT_4_1_PRICING_USD_PER_MILLION = {
  input: 2,
  cachedInput: 0.5,
  output: 8,
} as const;

export interface ResponseUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

export interface LatencySummary {
  readonly samples: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number.`);
  }
  return value;
}

export function gpt41CostUsd(usage: ResponseUsage): number {
  const inputTokens = nonNegative(usage.inputTokens, 'inputTokens');
  const cachedInputTokens = nonNegative(usage.cachedInputTokens, 'cachedInputTokens');
  const outputTokens = nonNegative(usage.outputTokens, 'outputTokens');
  if (cachedInputTokens > inputTokens) {
    throw new TypeError('cachedInputTokens cannot exceed inputTokens.');
  }

  const uncachedInputTokens = inputTokens - cachedInputTokens;
  return (
    uncachedInputTokens * GPT_4_1_PRICING_USD_PER_MILLION.input +
    cachedInputTokens * GPT_4_1_PRICING_USD_PER_MILLION.cachedInput +
    outputTokens * GPT_4_1_PRICING_USD_PER_MILLION.output
  ) / 1_000_000;
}

export function nearestRankPercentile(values: readonly number[], percentile: number): number {
  if (values.length === 0) throw new TypeError('At least one sample is required.');
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new TypeError('percentile must be greater than 0 and at most 1.');
  }

  const sorted = values.map((value) => nonNegative(value, 'sample')).sort((a, b) => a - b);
  const index = Math.ceil(percentile * sorted.length) - 1;
  return sorted[index]!;
}

export function summarizeLatency(values: readonly number[]): LatencySummary {
  return {
    samples: values.length,
    p50: nearestRankPercentile(values, 0.5),
    p90: nearestRankPercentile(values, 0.9),
    p95: nearestRankPercentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(3));
}
