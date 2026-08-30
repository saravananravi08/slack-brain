# T503 Performance and observability report

- **Branch:** `task/T503-validate-performance-and-observability`
- **Base:** `integration/mastra-rewrite` at `276cf52`
- **Date:** 2026-08-30
- **Gate:** **NO-GO pending runtime correlation and concurrent-ingestion remediation**
- **Data posture:** Synthetic inputs and aggregate metrics only. No Slack content, credentials, model output, database, or full trace is retained.

## Method

`tests/performance/**` provides repeatable measurements at four boundaries:

1. addressed-turn typing, first-content, and completion timing with deterministic streamed output;
2. real LibSQL ambient persistence with deterministic 1,536-dimension embeddings;
3. real LibSQL/vector semantic recall over a synthetic 25-message corpus;
4. persisted trace-tree/redaction checks plus an opt-in real OpenAI `gpt-4.1` stream.

Percentiles use nearest rank. Default tests make no network or generation-model call. The paid provider case runs only with `T503_LIVE_PROVIDER=1` and reads `OPENAI_API_KEY` from the external `.env` at execution time.

## Results

### Latency and throughput

| Boundary | Samples | p50 | p90 | p95 | Result |
|---|---:|---:|---:|---:|---|
| Synthetic typing state | 20 | 0.024 ms | 0.053 ms | 0.054 ms | Passes 2,000 ms budget in offline handler boundary |
| Synthetic first content | 20 | 1.128 ms | 1.168 ms | 1.187 ms | Harness check only; not provider evidence |
| Synthetic completion | 20 | 1.135 ms | 1.198 ms | 1.249 ms | Harness check only; not provider evidence |
| Semantic recall | 30 | 3.415 ms | 3.806 ms | 5.173 ms | Passes 1,000 ms regression ceiling |
| Ambient persistence | 40 | 49.027 ms | 78.110 ms | 79.748 ms | 20.33 events/s, serialized steady state |
| OpenAI first content | 3 | 896.191 ms | 1,636.754 ms | 1,636.754 ms | Provisional pass: 3/3 under 5,000 ms |
| OpenAI completion | 3 | 1,272.578 ms | 1,979.100 ms | 1,979.100 ms | Provisional pass: 3/3 under 60,000 ms |

Provider sample is too small to establish production SLO compliance; it proves the measurement path and gives a D012 baseline. Provider incidents and cold starts were not observed in this run.

### GPT-4.1 cost

Official OpenAI GPT-4.1 text pricing used by the suite:

- uncached input: **$2.00 / 1M tokens**;
- cached input: **$0.50 / 1M tokens**;
- output: **$8.00 / 1M tokens**.

Source: [OpenAI GPT-4.1 model documentation](https://developers.openai.com/api/docs/models/gpt-4.1) and [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), checked 2026-08-30.

The three-response run used 915 input tokens, 0 cached input tokens, and 33 output tokens. Estimated total: **$0.002094**, average **$0.000698 per response**. The helper rejects cached-token counts above total input so malformed usage cannot understate cost.

Ambient ingestion used **0 generation calls and $0 generation cost**. Embedding work is intentionally separate from the D012 response-cost figure.

### Trace and span coverage

Passed checks:

- one trace can hold correlated synthetic Slack event metadata and a run ID;
- persisted spans cover agent run, memory recall, model generation/inference, and failure;
- model spans carry provider/model, streaming timing, and token usage;
- real GPT-4.1 calls automatically emitted `agent_run`, `model_generation`, and `model_inference` spans;
- explicit `hideInput`/`hideOutput` removed provider-test prompts from persisted traces;
- sensitive token fields were redacted and error body/stack collapsed to the fixed `Operation failed.` payload;
- standard performance output contains aggregate counts/timings only.

Observed limitation: LibSQL emitted `This storage provider does not support batch creating metrics`. Span storage works, but native metric batch persistence is unavailable through the current provider.

## PRD comparison

| Requirement | Evidence | Verdict |
|---|---|---|
| NFR-PERF-001 typing within 2 s | Offline addressed-handler p95 0.054 ms | Partial: transport/live Slack not measured |
| NFR-PERF-002 first content within 5 s for 90% | Real GPT-4.1 p90 1.637 s, 3/3 pass | Provisional: sample too small for SLO claim |
| NFR-PERF-003 completion within 60 s for 95% | Real GPT-4.1 p95 1.979 s, 3/3 pass | Provisional: sample too small for SLO claim |
| NFR-PERF-004 silent ingestion invokes no generation | 40 measured writes, zero generation calls/cost | Pass |
| NFR-OBS-001 accepted request has traceable run ID | Mastra supports it when `runId`/metadata are supplied | **Gap:** foundation Slack responder does not supply them |
| NFR-OBS-002 retrieval/model latency, items, failures visible | Persisted coverage test proves required span fields; automatic provider spans pass | Partial: real runtime retrieval trace not exercised |
| NFR-OBS-003 correlate Slack event to one run without content logs | Explicit synthetic correlation passes | **Gap:** production response path does not pass Slack event correlation metadata |
| Operational event success >=99% | Serialized persistence 40/40 | **Gap:** four-worker trial produced retry exhaustion |

The synthetic retrieval benchmark also passes all eight cases with 1.0 retrieval/grounding scores, zero unsupported claims, and zero privacy leaks. Its recorded latencies are fixture data, not this machine's live measurements.

## Capacity findings and remediation

1. **Concurrent persistence:** a four-worker steady-state trial produced at least one `persistence_failed` after retries. The service catches the underlying storage error, so this task cannot classify the exact LibSQL/vector collision without changing production diagnostics. Supported serialized throughput is 20.33 events/s on this workstation. Remediation belongs in `src/ingestion/**`: serialize the message/vector transaction or expose sanitized operation-level failure telemetry, then rerun four concurrent threads.
2. **Slack-to-trace correlation:** `createFoundationRuntime` calls `gistAgent.stream` without a Slack-derived `runId` or `tracingOptions.metadata`. Remediation belongs in `src/mastra/**`: derive a content-free event correlation ID and pass it to the agent trace; standard logs should carry only the same run ID.
3. **Metric exporter support:** retain span-derived latency/usage reporting or add a storage exporter that supports metrics before claiming durable cost dashboards.
4. **Open phase gates:** P03 and P04 remain incomplete. Reconnect/load and live Slack typing measurements wait for those phase outcomes.

## Commands

```bash
npx vitest run tests/performance
T503_LIVE_PROVIDER=1 node --env-file=<external-.env> node_modules/vitest/vitest.mjs run tests/performance/provider-observability.test.ts
npm run benchmark:retrieval -- --dataset benchmarks/retrieval/synthetic
npm run typecheck
npm test
```

The `.env` path and values are not recorded in Git.
