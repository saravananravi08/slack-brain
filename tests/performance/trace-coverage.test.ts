import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Mastra } from '@mastra/core/mastra';
import { SpanType } from '@mastra/core/observability';
import { afterEach, describe, expect, it } from 'vitest';

import { createMastraStorage } from '../../src/mastra/storage/index.js';
import {
  TRACE_ERROR_MESSAGE,
  createGistObservability,
} from '../../src/mastra/storage/observability.js';

const directories: string[] = [];
const runtimes: Mastra[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((mastra) => mastra.shutdown()));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('T503 trace and span coverage', () => {
  it('persists one correlated run with retrieval, model timing, usage, and redacted failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't503-trace-'));
    directories.push(directory);
    const storage = createMastraStorage({
      databaseUrl: pathToFileURL(join(directory, 'observability.db')).href,
    });
    const observability = createGistObservability();
    const mastra = new Mastra({ storage, observability, loggerOptions: { export: false } });
    runtimes.push(mastra);
    const instance = observability.getDefaultInstance();
    expect(instance).toBeDefined();
    if (!instance) return;

    const runId = 'run-t503-synthetic-001';
    const slackEventId = 'Ev0T503TRACE001';
    const token = 'SYNTHETIC_TOKEN_MUST_BE_REDACTED';
    const root = instance.startSpan({
      type: SpanType.AGENT_RUN,
      name: 'gist addressed turn',
      attributes: { conversationId: 'synthetic-thread' },
      tracingOptions: {
        metadata: { run_id: runId, slack_event_id: slackEventId },
        tags: ['t503'],
      },
    });
    const recall = root.createChildSpan({
      type: SpanType.MEMORY_OPERATION,
      name: 'semantic recall',
      attributes: {
        operationType: 'recall',
        semanticRecallEnabled: true,
        vectorResultCount: 2,
      },
    });
    recall.end({ output: { recalled_item_count: 2 } });
    const model = root.createChildSpan({
      type: SpanType.MODEL_INFERENCE,
      name: 'openai gpt-4.1 inference',
      input: { authorization: token },
      attributes: {
        provider: 'openai',
        model: 'gpt-4.1',
        streaming: true,
        completionStartTime: new Date(),
        usage: { inputTokens: 120, outputTokens: 24 },
      },
    });
    model.end({ output: { response_present: true } });
    const failure = root.createChildSpan({
      type: SpanType.GENERIC,
      name: 'synthetic downstream failure',
    });
    failure.error({ error: new Error(`${token} synthetic private detail`), endSpan: true });
    root.end({ output: { status: 'failed' } });
    await observability.flush();

    const traceStore = await storage.getStore('observability');
    const trace = await traceStore?.getTrace({ traceId: root.traceId });
    const spanTypes = new Set(trace?.spans.map(({ spanType }) => spanType));
    const serialized = JSON.stringify(trace);
    const rootRecord = trace?.spans.find(({ parentSpanId }) => !parentSpanId);
    const modelRecord = trace?.spans.find(
      ({ spanType }) => spanType === SpanType.MODEL_INFERENCE,
    );
    const failureRecord = trace?.spans.find(
      ({ name }) => name === 'synthetic downstream failure',
    );

    expect(trace?.spans).toHaveLength(4);
    expect(spanTypes).toEqual(new Set([
      SpanType.AGENT_RUN,
      SpanType.MEMORY_OPERATION,
      SpanType.MODEL_INFERENCE,
      SpanType.GENERIC,
    ]));
    expect(rootRecord?.metadata).toMatchObject({
      run_id: runId,
      slack_event_id: slackEventId,
    });
    expect(modelRecord?.attributes).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1',
      streaming: true,
      usage: { inputTokens: 120, outputTokens: 24 },
    });
    expect(modelRecord?.endedAt!.getTime()).toBeGreaterThanOrEqual(
      modelRecord!.startedAt.getTime(),
    );
    expect(failureRecord?.error).toEqual({
      message: TRACE_ERROR_MESSAGE,
      name: 'Error',
    });
    expect(serialized).not.toContain(token);
  });
});
