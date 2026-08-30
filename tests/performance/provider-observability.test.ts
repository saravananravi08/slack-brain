import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Mastra } from '@mastra/core/mastra';
import { SpanType } from '@mastra/core/observability';
import { describe, expect, it } from 'vitest';

import {
  createGistAgent,
  createGistModel,
} from '../../src/mastra/agents/gist.js';
import { createMastraStorage } from '../../src/mastra/storage/index.js';
import { createGistObservability } from '../../src/mastra/storage/observability.js';
import {
  elapsedMs,
  gpt41CostUsd,
  summarizeLatency,
} from './metrics.js';

const LIVE_PROVIDER = process.env.T503_LIVE_PROVIDER === '1';
const PROMPTS = [
  'Synthetic performance check alpha. Reply with one short sentence and no factual claim.',
  'Synthetic performance check beta. Reply with one short sentence and no factual claim.',
  'Synthetic performance check gamma. Reply with one short sentence and no factual claim.',
] as const;

interface ProviderSample {
  readonly run_id: string;
  readonly trace_id: string;
  readonly first_content_ms: number;
  readonly complete_ms: number;
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly output_tokens: number;
  readonly cost_usd: number;
}

describe.runIf(LIVE_PROVIDER)('T503 real OpenAI response performance', () => {
  it('tracks GPT-4.1 TTFT, completion, usage, cost, and automatic spans per response', async () => {
    expect(process.env.OPENAI_API_KEY).toBeTruthy();
    const directory = await mkdtemp(join(tmpdir(), 't503-provider-'));
    const storage = createMastraStorage({
      databaseUrl: pathToFileURL(join(directory, 'observability.db')).href,
    });
    await storage.init();
    const observability = createGistObservability();
    const mastra = new Mastra({ storage, observability, loggerOptions: { export: false } });
    const agent = createGistAgent(createGistModel('gpt-4.1'));
    mastra.addAgent(agent, 'gist');

    try {
      const samples: ProviderSample[] = [];
      for (const [index, prompt] of PROMPTS.entries()) {
        const runId = `t503-provider-${index + 1}`;
        const traceId = (index + 1).toString(16).padStart(32, '0');
        const startedAt = performance.now();
        const response = await agent.stream(prompt, {
          runId,
          tracingOptions: {
            traceId,
            metadata: { slack_event_id: `Ev0T503PROVIDER${index + 1}` },
            tags: ['t503-provider'],
            hideInput: true,
            hideOutput: true,
          },
        });

        let firstContentMs: number | undefined;
        let responsePresent = false;
        for await (const chunk of response.textStream) {
          if (chunk.length === 0) continue;
          firstContentMs ??= elapsedMs(startedAt);
          responsePresent = true;
        }
        const completeMs = elapsedMs(startedAt);
        const usage = await response.usage;
        const inputTokens = usage.inputTokens ?? 0;
        const cachedInputTokens = usage.cachedInputTokens ?? 0;
        const outputTokens = usage.outputTokens ?? 0;

        expect(responsePresent).toBe(true);
        expect(firstContentMs).toBeDefined();
        expect(inputTokens).toBeGreaterThan(0);
        expect(outputTokens).toBeGreaterThan(0);
        samples.push({
          run_id: runId,
          trace_id: traceId,
          first_content_ms: firstContentMs!,
          complete_ms: completeMs,
          input_tokens: inputTokens,
          cached_input_tokens: cachedInputTokens,
          output_tokens: outputTokens,
          cost_usd: gpt41CostUsd({ inputTokens, cachedInputTokens, outputTokens }),
        });
      }

      await observability.flush();
      const traceStore = await storage.getStore('observability');
      for (const [index, sample] of samples.entries()) {
        const trace = await traceStore?.getTrace({ traceId: sample.trace_id });
        const spanTypes = new Set(trace?.spans.map(({ spanType }) => spanType));
        const serialized = JSON.stringify(trace);

        expect(trace).not.toBeNull();
        expect(spanTypes).toContain(SpanType.AGENT_RUN);
        expect(spanTypes).toContain(SpanType.MODEL_GENERATION);
        expect(spanTypes).toContain(SpanType.MODEL_INFERENCE);
        expect(trace?.spans.some(({ runId }) => runId === sample.run_id)).toBe(true);
        expect(trace?.spans.some(({ metadata }) =>
          metadata?.slack_event_id === `Ev0T503PROVIDER${index + 1}`)).toBe(true);
        expect(serialized).not.toContain(PROMPTS[index]);
      }

      const firstContent = summarizeLatency(samples.map((sample) => sample.first_content_ms));
      const completion = summarizeLatency(samples.map((sample) => sample.complete_ms));
      expect(firstContent.p90).toBeLessThanOrEqual(5_000);
      expect(completion.p95).toBeLessThanOrEqual(60_000);

      console.info('T503_METRIC provider', JSON.stringify({
        model: 'gpt-4.1',
        responses: samples.length,
        first_content_ms: firstContent,
        complete_ms: completion,
        tokens: {
          input: samples.reduce((sum, sample) => sum + sample.input_tokens, 0),
          cached_input: samples.reduce((sum, sample) => sum + sample.cached_input_tokens, 0),
          output: samples.reduce((sum, sample) => sum + sample.output_tokens, 0),
        },
        total_cost_usd: Number(samples.reduce(
          (sum, sample) => sum + sample.cost_usd,
          0,
        ).toFixed(6)),
      }));
    } finally {
      await mastra.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
