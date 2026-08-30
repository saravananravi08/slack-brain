# Contract — automatic retrieval and citation metadata

- **Contract version:** 1.0.0
- **Owner:** T004 (frozen); consumers T201, T105, T205
- **Enforces:** INV-7, INV-8, INV-5
- **Implements:** D002 (scope), D009 (citations), FR-MEM-003/004/009/010/013

## 1. The tool prohibition (INV-7)

Retrieval executes **before** generation and its output is injected into the prompt as context. It is not reachable by the model.

Forbidden, without exception:

- A tool/function definition the model can call to search.
- A shell command in the prompt (this is exactly what the legacy system did — see the T002 baseline, "the generation process is instructed to execute `search.ts` through a shell command").
- Any instruction that asks the model to request more context.
- A user-visible search command (`/search`, `/summary`, …) — PRD §5.

A user must never learn that retrieval exists (G2). Retrieval quality is configured in code, not prompted (NFR-MNT-002).

## 2. Types

```ts
interface RetrievalRequest {
  contract_version: string;
  query_text: string;
  scope: readonly BoundaryId[];       // from AuthorizationDecision — exhaustive, never widened
  thread_id: ThreadId;                // for nearby-context expansion
  limit: number;
  include_nearby_context: boolean;
}

interface RetrievedItem {
  message_key: MessageKey;
  boundary_id: BoundaryId;
  thread_id: ThreadId;

  // Citation metadata — all three REQUIRED (INV-8, D009)
  sender_name: string;
  sent_at: string;                    // RFC 3339
  channel_id: string;

  text: string;
  score: number;
  relation: 'match' | 'nearby_context';
}

interface RetrievalResult {
  items: readonly RetrievedItem[];
  scope_used: readonly BoundaryId[];  // must equal request.scope
  duration_ms: number;
  truncated: boolean;
}
```

## 3. Citation metadata is mandatory (D009)

`sender_name`, `sent_at`, and `channel_id` are **required, non-nullable** on every item. D009 requires attribution for every historical claim; a retrieval layer that returns bare text makes that impossible at the prompt layer no matter how the instructions are written. This is why the requirement lives in the contract rather than in T105's persona.

An item that cannot supply all three must not be returned. Records lacking sender or timestamp are excluded at import under D003, which is what keeps this satisfiable.

`RetrievedItem` carries no internal storage path or trace ID — citations are human-readable attributions, never debug handles (INV-11, FR-RSP-007).

## 4. Scope enforcement (INV-5)

1. `scope` comes from `AuthorizationDecision.scope`. Retrieval **must not** compute, widen, or default it.
2. An empty scope is a contract violation, not an empty search — fail rather than searching everything.
3. Every returned item's `boundary_id` must be in `scope`. T502 asserts this against the returned set, not only against the query.
4. `scope_used` is echoed back so a trace shows exactly which boundaries were searched (NFR-OBS-002).
5. Boundary filtering happens **inside** the vector query, not as a post-filter (`storage.md` §2).

## 5. Nearby context (FR-MEM-010)

When `include_nearby_context` is set, matches may be expanded with adjacent messages from the same `thread_id`, marked `relation: 'nearby_context'`. Expansion is subject to the same scope rules — it must never reach outside `scope`, and it never crosses a boundary or a thread.

## 6. Mechanism independence (FR-MEM-013)

This contract is deliberately written against Memory-based semantic recall **and** pre-generation RAG through a context processor. If T205 shows Memory alone cannot meet archive-scale quality, the mechanism may change without reopening T004, provided:

- retrieval still runs automatically before generation,
- it is still invisible to the model as a callable tool (INV-7),
- `RetrievedItem` still carries full citation metadata,
- scope enforcement is unchanged.

Consumers depend on the shapes here, not on the mechanism.

## 7. Observability (NFR-OBS-002)

Every retrieval emits: `duration_ms`, the count of items, `scope_used`, and the returned `message_key`s. **Keys, never bodies** — traces already carry content and are separately restricted (D004, R7); ordinary logs must not (INV-12, FR-PRV-008).

## 8. Benchmark alignment (T205)

`benchmarks/baseline/benchmark.schema.json` scores `evidence_ids`, `forbidden_evidence_ids`, and `attribution.{sender,date}`. `RetrievedItem.message_key` maps to `evidence_ids`; `sender_name`/`sent_at` supply attribution scoring. `forbidden_evidence_ids` is a direct test of §4 — an item from outside scope appearing in a result is a privacy failure, not a relevance miss, and must fail the run rather than lower a score.

## 9. Fixtures

[`fixtures/retrieval.v1.json`](./fixtures/retrieval.v1.json) — a channel-scoped result, a DM-scoped result under the accepted `dm_shared_knowledge: false` default, a nearby-context expansion, and a negative vector where an out-of-scope item must not appear.
