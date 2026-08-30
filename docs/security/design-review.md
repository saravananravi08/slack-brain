# Early security and privacy design review

- **Feeds:** [T502](../implementation/tasks/T502-SECURITY-REVIEW.md) — this is an early design review, not the T502 sign-off
- **Reviewed at:** `integration/mastra-rewrite` @ `f9ad978` (T405 live ingestion merged mid-review; the review was re-run against the new tip)
- **Date:** 2026-08-30
- **Reviewer:** claude-planner-2
- **Scope:** `src/security/**`, `src/ingestion/**`, `src/mastra/memory/**`, `src/mastra/channels/**`, `src/migration/**`, plus the composition root `src/mastra/index.ts` and `src/mastra/storage/**` because every decision point above is wired there
- **Method:** read-only inspection against PRD FR-PRV-001..009 and NFR-SEC-001..004, `DECISIONS.md` (D001, D002, D004, D005, D006, D009, D010), and the frozen contracts in `docs/architecture/contracts/`. No `src/` file was modified.

**Result: 17 findings — 4 high, 6 medium, 7 low.** None is an unauthenticated leak: every path an outsider can reach from Slack fails closed. The four high findings are failure-mode and completeness gaps — the isolation that holds on the happy path is not the thing enforcing it, two crash windows leave content where the contract forbids it, and deletion appears to reach only one of the two places a message is stored.

**T405 landed mid-review** and resolved three findings from the first pass, which are recorded in §8 rather than carried as open items: the ambient write gate is now wired to the real guard, the idempotency ledger is now durable, and sender externality now fails closed on a missing `team_id`. The findings below are against `f9ad978`.

## 1. What is structurally sound

Worth stating plainly, because the rest of this document is about gaps:

- **Boundary identity is structural, not filtered.** `resource-policy.ts` derives the `ch:` / `dm:` prefix from `conversation_type`, never from a Slack ID, so no channel ID can produce a DM boundary and no user ID can produce a channel one (INV-3). The suffix-collision and workspace-disambiguation cases are covered by tests.
- **A DM keys on the human user, not the Slack IM conversation**, giving each user exactly one private boundary (FR-PRV-003).
- **Two independent paths refuse to write DM content into channel knowledge.** `ambient-persistence.ts` accepts only `conversation_type === 'channel'` (`isValidInput`), and `memory-writer.ts:102` rejects any record that is not a `ch:` boundary. FR-PRV-004 is enforced twice, in code, not by convention.
- **The guard is deny-by-default and total.** `authorize()` returns a decision for every input including garbage, evaluates the D001/D006 rules in the contract's order, and denies on any identity that does not describe its event.
- **Authorization precedes storage on every wired path.** `handlers.ts` authorizes before the responder; `mutations/handler.ts` wraps storage in `withAuthorization`; `ambient-persistence.ts` authorizes before its first read. D005's "a mutation is denied before lookup, so it cannot probe stored state" holds.
- **Logs carry no message content.** Every call site (`channel-authorizer.ts:118`, `handlers.ts:113-147`) emits reason codes, surfaces, and error classes only. FR-PRV-008 and INV-12 hold across the merged tree.
- **The archive reader is hardened**: read-only + `immutable=1` + `PRAGMA query_only`, extensions disabled, `realpathSync` before open, and every query parameterised.
- **Trace redaction is real.** `TraceErrorRedactor` replaces error messages and constrains names; `SensitiveDataFilter` runs at full redaction; span retention is 30 days, matching D004/D010.

## 2. Cross-boundary leak analysis

### 2.1 The isolation chain, as built

```
Slack event
  → identity  (resource-policy.ts)     boundary_id = ch:<ws>:<channel> | dm:<ws>:<user>
  → authorize (security/authorize.ts)  decision.scope = [that one boundary]
  → agent     (mastra/index.ts:186)    memory: { resource: boundary_id, thread: thread_id }
  → recall    (gist-memory.ts)         semanticRecall.scope: 'resource'
```

Isolation holds because the *resource* handed to the agent is the boundary, and Mastra scopes semantic recall to that resource. Channel A's request carries `ch:ws:A`, so recall cannot reach `ch:ws:B` or any `dm:`; a DM carries `dm:ws:user`, so it cannot reach a channel. Under the accepted D002 posture this coincides exactly with what `authorize()` returns.

**The gap is that the coincidence is doing the work.** `decision.scope` — which `authorization.md` §5 defines as *exhaustive*, "not a hint or a ranking preference" — is used at `mastra/index.ts:179` only as a membership assertion (`scope.includes(boundary_id)`). It is never passed to recall, and recalled messages are never filtered against it (F-01). Today both mechanisms agree. They stop agreeing the moment D002 is flipped, because `scope` would then hold several boundaries while the agent is still handed exactly one resource — which fails *closed* — or someone widens the resource without re-deriving it from `scope`, which fails open. There is no test that would catch the second.

### 2.2 Per-boundary verdicts

| Path | Isolation | Basis |
|---|---|---|
| Channel → channel | **Holds** | recall scoped to `ch:` resource; `authorize` returns only the originating channel |
| Channel → other channel | **Holds** | different `resourceId`; F-01 is the defence-in-depth gap, not a live leak |
| Channel → any DM | **Holds** | `dm:` boundary is a different resource; no path derives one from a channel event |
| DM → own DM | **Holds** | resource is `dm:<ws>:<sender>`, derived from the sender, not the IM channel |
| DM → another user's DM | **Holds** | boundary keys on the sender; a mismatched identity is denied `identity_unresolved` |
| DM → channel knowledge | **Holds** | D002 off, and `dm_shared_knowledge` is typed `false` in config so it cannot be enabled |
| DM content → channel store | **Holds** | rejected independently by ambient persistence and by the archive writer |
| Archive import → DM boundary | **Holds** | `memory-writer.ts:102` rejects non-`ch:` records |
| Deleted content → recall | **Fails under crash** | F-02: the vector row outlives the message row in a failure window |

### 2.3 Content copies outside the message store

Message text exists in three places, which matters for D004 deletion:

1. the Mastra message row,
2. the vector index metadata (`content: text`, written by `ambient-persistence.ts` and `mastra-store.ts#replaceVector`),
3. traces, when a request is sampled (operator-restricted, 30-day, per D010).

Deletion covers (1) and (2) in the happy path and (3) by retention. F-02 is where that breaks.

## 3. Fail-open / fail-closed audit

Every authorization decision point in the merged tree, and what it does when its inputs fail.

| # | Decision point | On failure | Verdict |
|---|---|---|---|
| 1 | `security/authorize.ts` — the guard | malformed input, unknown gate, empty approved list, identity/event mismatch all deny | **Closed** |
| 2 | `channel-authorizer.ts` — sender lookup | `null`, throw, or reject → `identity_unresolved` | **Closed** |
| 3 | `channel-authorizer.ts` — identity resolution | resolver throws → `identity_unresolved` | **Closed** |
| 4 | `channel-authorizer.ts` — absent workspace ID | `malformed_request`; D001 forbids assuming the approved workspace | **Closed** |
| 5 | `mastra/index.ts:139` — authorize seam | context stored only on an allowed decision | **Closed** |
| 6 | `mastra/index.ts:170` — respond | no stored context → `unauthorized`; re-authorizes read *and* write; asserts scope membership | **Closed** |
| 7 | `channels/handlers.ts:120` — turn gate | denial returns before typing, generation, and any responder call | **Closed** |
| 8 | `ambient-persistence.ts:186` — write gate | denial → `skipped` with the deny reason; no storage touched | **Closed**; T405 wires the real guard at `mastra/index.ts:142` |
| 9 | `mutations/handler.ts` — `handle`, `shouldSuppressOriginal` | `withAuthorization` never invokes the storage callback on a denial | **Closed** |
| 10 | `mutations/handler.ts` — `sweepRetention` | **no gate**; reads every message in every boundary | **Trusted system path** — by design (D004 sweep is not a user event), but it is the one place that reads across all boundaries, so it must never be reachable from a Slack-triggered path |
| 11 | `gist-memory.ts` — recall input processor | **no gate**; trusts the thread/resource in the request context | **Open by construction** (F-01) |
| 12 | `gist-memory.ts:139` — recall failure | swallowed; the turn proceeds as if history were searched and empty | **Fails open on trust** (F-03) |
| 13 | `mastra/index.ts` — `isExternal` | `team_id !== workspaceId`, so an absent `team_id` reads as external and denies | **Closed** (was F-04; fixed in T405) |
| 14 | `migration/mapping/archive-message.ts:164` — import channel check | unapproved channel skipped, but via its own check rather than the shared guard | **Closed, divergent** (F-06) |
| 15 | `mutations/policy.ts:84` — de-approved channel purge | missing `channel_removed_at` → `continue`, message never purged | **Open** (F-07) |
| 16 | `storage/index.ts` — database URL | absent/blank → default path under `$XDG_DATA_HOME` | **Open** (F-05) |

Live ingestion (T405, `src/mastra/channels/slack.ts`) adds four more:

| # | Decision point | On failure | Verdict |
|---|---|---|---|
| 17 | `slack.ts:166` — envelope context | missing delivery context or bot user ID → skip | **Closed** |
| 18 | `slack.ts:184` — ambient sender lookup | throw or `null` → `identity_unresolved`, no persistence | **Closed** |
| 19 | `slack.ts:216` — `accept()` | `resolveIdentity` throws or `authorize` denies → return before dedupe and before any storage call | **Closed** |
| 20 | `slack.ts:274`, `:288` — ingestion catch-all | any throw → logged by error class, event dropped, nothing persisted | **Closed**, but silently drops (F-19) |

Points 1–9 and 17–20 are the ones an attacker reaches from Slack, and all thirteen fail closed. The open ones are reachable only through misconfiguration (16), a dependency failure (12), a concurrency collision (F-19), or a future change (11).

## 4. Idempotency and deduplication audit

| Layer | Key | Durable? | Covers |
|---|---|---|---|
| Chat SDK delivery dedup | `slack:event-delivered:<event_id>`, 24 h | **Yes** — `MastraStateAdapter` over the memory store | Slack retries of one envelope (AC-06) |
| Chat SDK content dedup | `dedupe:slack:<ts>`, 10 min default | **Yes**, same store | `message` + `app_mention` duplicate delivery |
| T402 `deduplicate()` | `delivery:<event_id>` then `content:<messageKey>` | **Yes** — T405 backs it with the state adapter (`slack.ts:146`), 24 h delivery / 10 min content | Cross-restart delivery and content identity |
| Ambient persistence | `messageKey` as the Mastra message `id`, plus a canonical-content comparison | **Yes** — the store is the ledger | Re-delivery, and live-vs-import convergence (INV-10, AC-14) |
| Archive writer | same `messageKey`, plus `delivery_key: import:<run>:<key>` | **Yes** | Re-running an import |
| Mutations | none by design — delivery dedup only | n/a | A replayed mutation relies on `event_id`; T404's own operations are idempotent |

Sound: the content identity is the storage primary key rather than a side table, so the durable guarantee does not depend on a ledger being consulted. `ambient-persistence.ts` goes further with a `live_persistence_pending` marker so an interrupted write is repaired by a later retry rather than left half-applied — that is the right pattern, and F-02 is the case where the same pattern is missing.

Remaining gap: the mutation path has no protection against two edits arriving concurrently in **different processes**, since `#exclusive` is an in-process lock (F-12).

The deeper idempotency problem is not in this table at all: it is that two independent writers store the same Slack message under two different primary keys, and only one of them is reachable by a delete (F-17).

## 5. Secrets handling audit

| Check | Result |
|---|---|
| Secrets in Git | **Clean.** No `.env`, `.db`, `.sqlite`, or token file is tracked; `.gitignore` covers `.env`, `.env.*` (with `!.env.example`), every SQLite extension, `traces/`, and `worktrees/` |
| `.env.example` | **Clean.** Placeholders only, with explicit "never commit real IDs" guidance |
| Secrets in logs | **Clean.** No call site logs a token, and `ConfigError` names variables, never values |
| Secrets in errors to users | **Clean.** `errors.ts` maps everything to fixed strings; unknown throws degrade to `internal` |
| Secrets in traces | **Clean.** Error messages replaced wholesale; `SensitiveDataFilter` at full redaction |
| Credentials in the DB URL | **Rejected.** `resolveDatabaseUrl` refuses a URL carrying username or password |
| Database location | **Constrained.** Must be absolute, outside the repository, and the directory is created `0o700` |
| Credential injection | **Explicit.** The Slack adapter refuses to construct without both tokens and never auto-detects them from the environment |
| Fixtures and tests | **Clean.** Every identifier in `docs/architecture/contracts/fixtures/` and in the test suites is synthetic |

One structural note rather than a leak: `config.ts` returns the tokens on a frozen `Config` object that is held for the process lifetime and passed into the channel factory. That is unavoidable for a Socket Mode client, and the object never reaches a log, a trace, or a span.

## 6. Findings

Severity: **High** = a contract or PRD requirement is violated under a reachable condition. **Medium** = a requirement is violated only under misconfiguration or a future change, or a defence is missing where the contract asks for one. **Low** = hygiene, operability, or a decision that should be recorded rather than left implicit.

| ID | Sev | Category | File | Issue | Recommendation |
|---|---|---|---|---|---|
| F-01 | High | Leak (defence) | `src/mastra/index.ts:179`, `src/mastra/memory/gist-memory.ts:100-160` | `authorize()` returns an exhaustive `scope`, but retrieval is bounded only by the Mastra `resourceId` in the request context. `scope` is used as a membership assertion and never as the query filter, and recalled messages are not filtered against it. `authorization.md` §5 requires the opposite: "Retrieval must query only these — it is not a hint." Today the two agree; a D002 flip or a caller-supplied `memoryConfig` breaks the agreement silently. | Pass `decision.scope` into the recall path and drop any recalled message whose `resourceId` is not in it, before citations are built. Add a test that a recall returning a foreign-boundary message is discarded rather than cited. |
| F-02 | High | Leak (failure window) | `src/ingestion/mutations/mastra-store.ts:124-131`, `:83-86` | Delete removes the message row **before** the vector row, and edit saves the new text **before** replacing the embedding. A crash in either window leaves message text in the vector index — `#replaceVector` writes `content: text` into vector metadata — where semantic recall can still surface it. For delete this means deleted content stays retrievable; for edit it means the stale pre-edit embedding survives, which `slack-event.md` §4 forbids outright. Nothing repairs either state. | Invert the order (vector first, then row), or adopt the `live_persistence_pending` marker `ambient-persistence.ts` already uses and add a reconciliation pass keyed on the tombstone map. Test by injecting a failure between the two writes. |
| F-03 | High | Contract / trust | `src/mastra/memory/gist-memory.ts:139` | A recall failure is swallowed and the turn proceeds with no evidence, so Gist answers as though history were searched and found empty. `errors.md` §4 names this exact case: "Never silently answer as though history were searched and empty — that manufactures a confident wrong answer, which is worse than an error (D009, FR-RSP-006)." The comment says it matches Mastra's fail-soft default, which is the behaviour the contract overrides. | Distinguish "searched, found nothing" from "search failed". On failure either return `retrieval_failed` or answer with an explicit statement that history could not be searched. Never both silent and confident. |
| F-05 | Medium | Fail-open / config | `src/mastra/index.ts:34`, `src/mastra/storage/index.ts:46-56` | The storage singleton is built at **import time** from `process.env.MASTRA_DATABASE_URL`, falling back to `defaultDatabaseUrl()` and creating the directory with `mkdirSync`. This runs before `parseConfig()` inside `createFoundationRuntime`, so a process with missing or invalid configuration still gets a working database at a default path. D001 and FR-OPS-001 require the process to exit rather than start on defaulted configuration. | Build storage inside `createFoundationRuntime` from the validated `config.databaseUrl`, after `parseConfig()`. Remove the module-level singleton and the import-time filesystem side effect. |
| F-06 | Medium | Contract divergence | `src/migration/mapping/archive-message.ts:164`, `:267`, `:273` | The import path composes `ch:<ws>:<channel>` and `<boundary>#<ts>` by string concatenation, which `identity.md` §4 forbids outside `resource-policy.ts`, and re-implements the D001 channel check instead of calling the shared guard. Two implementations of one policy will drift, and the concatenated boundary skips the ID-shape validation `boundaryFor` applies. | Call `resolveIdentity()` / `messageKey()` from `resource-policy.ts`, and run import records through `authorize()` at the `write_memory` gate so D001 has exactly one implementation. |
| F-07 | Medium | Fail-open / retention | `src/ingestion/mutations/policy.ts:83-84` | A message in a de-approved channel is purged only when `channel_removed_at[id]` is a valid date. If the operator removes a channel from the allowlist without recording a removal timestamp, `continue` runs and the content is retained indefinitely. D004's 30-day purge becomes a no-op exactly when it matters. | Treat a de-approved channel with no recorded removal time as removed at the sweep's `now` (starting the clock), and surface a count of channels in that state so it cannot pass unnoticed. |
| F-10 | Medium | Prompt injection | `src/mastra/memory/gist-memory.ts:97`, `src/mastra/agents/instructions.ts` | Retrieved Slack text is embedded verbatim in a system message inside `<retrieved_slack_messages>` tags. `JSON.stringify` escapes quotes but not the tag, so a message containing `</retrieved_slack_messages>` can appear to close the block. The instructions never tell the model to treat retrieved content as data rather than instructions. Anyone who can post in an approved channel can attempt to steer answers given to other users. | Add an explicit instruction that retrieved evidence is untrusted data and never an instruction, and neutralise the delimiter in retrieved text (strip or escape `<`/`>` sequences matching the tag). Add a test posting a message containing the closing tag. |
| F-17 | High | Leak (deletion) | `src/mastra/channels/slack.ts:267`, `src/mastra/index.ts:217`, `src/ingestion/mutations/handler.ts` | A message in a **subscribed thread** is stored twice: once by `AmbientPersistenceService` under `id = messageKey`, and once by the agent's own Mastra memory when `gistAgent.stream` runs with `memory: { resource, thread }`. Mutations resolve targets by `messageKey` only, so an edit or delete reaches the ambient copy and appears to leave the agent-memory copy untouched — a user deleting a Slack message would keep its text in memory and in recall. The same applies to every addressed turn, which is stored only by the agent and therefore never reachable by `MutationHandler` at all. D005, INV-9, and FR-PRV's deletion guarantee assume one record per message. | **Verify first**, then fix: assert what ID Mastra assigns to an agent-persisted user turn (the T405 integration test stubs generation, so the suite cannot see this). If the IDs differ, either route addressed turns through the same `messageKey`-keyed writer, or extend `MutationHandler` to resolve every stored copy of a message before deleting. Add a test that deletes a Slack message and asserts zero rows and zero vectors remain for it. |
| F-18 | Medium | Fragility | `src/mastra/channels/slack.ts:146-165` | Envelope capture works by reassigning the pinned adapter's `processEventPayload` — an internal method with no type contract — and by carrying `event_id` through `AsyncLocalStorage`. An SDK upgrade that renames or defers that method breaks ingestion silently: `normalized()` returns `null` and every event is skipped as `malformed_event`. The ALS store also survives only while the SDK dispatches synchronously inside the patched call; a non-default concurrency strategy that queues would lose it. | Pin the behaviour with a spike-style test that fails on an SDK change (the T401 suite is the precedent), and emit a rate-limited `warn` when the delivery context is missing so a silent stop is visible in metrics rather than as absent data. |
| F-19 | Medium | Data loss | `src/mastra/channels/index.ts:32`, `src/mastra/channels/slack.ts:267` | The Chat SDK's `concurrency: 'drop'` default is kept deliberately for the reply path (FR-SLK-007), but ambient ingestion now shares it. A message arriving in a thread while a turn is in flight for that same thread is dropped before any handler runs, so it is never stored. FR-MEM-001 expects every approved-channel message to be captured. Thread-scoped, so the blast radius is one active thread. | Confirm the lock scope is `thread` and not `channel` in production, then either move ingestion off the concurrency-controlled path or count drops explicitly so the gap is measurable rather than invisible. |
| F-20 | Low | Metadata fidelity | `src/mastra/channels/slack.ts:129-136` | `ambientProjection` overwrites `class` to `'ambient'` and `addressed_to_gist` to `false` on events the normalizer classified `addressed` (every subscribed-thread message). The stored record then misdescribes how the message arrived, and the projection is what makes the F-17 double-write look like a single ambient write. | Persist the true classification and let the persistence service accept both classes, rather than relabelling to satisfy its input type. |
| F-11 | Low | Build hygiene | `src/migration/mapping/tests/**`, `src/migration/source/tests/**` | Two test suites are committed under `src/`, where `tsconfig` includes them and `mastra build` will compile them into `dist`. Test code and its `vitest` imports ship to production, and the directories sit outside the declared write scope of the tasks that created them. | Move both to `tests/migration/...` alongside the suites already there. |
| F-12 | Low | Concurrency | `src/ingestion/mutations/mastra-store.ts:230` | `#exclusive` serialises mutations within one process only. Two processes editing one message can interleave a save and a vector replace. | Acceptable for the single-instance deployment the PRD assumes — record the assumption in the runbook so a future scale-out revisits it, or take the state adapter's lock. |
| F-13 | Low | Operability | `src/ingestion/mutations/mastra-store.ts:174`, `handler.ts` `sweepRetention` | The retention sweep calls `listMessages()`, which loads every message of every thread into memory. It grows with the corpus and is the one code path that reads across all boundaries. | Page the sweep by thread or by boundary, and assert in T502 that no Slack-triggered path can reach it. |
| F-14 | Low | Data growth | `src/ingestion/mutations/mastra-store.ts:113-121` | Tombstones accumulate in one resource-metadata map, rewritten whole on each delete. It grows without bound, and `updateResource` is called with only that key — if the store replaces rather than merges metadata, other resource metadata is lost. | Confirm `updateResource` merge semantics with a test; move tombstones to their own table if the map outgrows metadata. |
| F-15 | Low | Fail-open (future) | `src/mastra/memory/gist-memory.ts:126` | The recall processor forwards a caller-supplied `memoryConfig` to `recall`, which can override `semanticRecall.scope`. No caller does today. | Pin `scope: 'resource'` on the recall the processor performs, rather than accepting it from the request context. |
| F-16 | Low | Decision needed | `src/migration/mapping/archive-message.ts` | Import excludes bots and system subtypes but not messages authored by external, guest, or deactivated users. D006 excludes those people from *interacting* with Gist; whether their historical messages belong in the channel corpus is unspecified. | Record a decision. The defensible default is that channel history is channel history — but it should be written down rather than inherited from an omission. |

## 7. What T502 should verify beyond this review

1. **F-17 first.** It is the only finding that could mean deleted Slack content survives in memory, and the current suite cannot see it because generation is stubbed. Delete a message end to end against a real store and assert nothing remains.
2. **Live cross-boundary tests**, once the app is added to the probe channel (B-01): a real message in an approved channel must not surface in another channel or any DM, exercised end to end rather than at unit level.
3. **Call-order inspection** for INV-2, as `authorization.md` §6 requires — assert `authorize` precedes the first storage call by instrumenting the store, not by reading the code.
4. **Crash-injection** for F-02: kill the process between the message write and the vector write, then assert the orphaned embedding is not recallable.
5. **A prompt-injection case** for F-10: post a message containing the closing evidence tag and assert Gist neither follows it nor leaks the surrounding instructions.

## 8. Resolved during the review

T405 merged while this review was in progress and closed three first-pass findings. They are recorded here so the T502 sign-off can see they were considered rather than missed:

| Was | Issue | Resolution |
|---|---|---|
| F-04 | `isExternal` fell open when `users.info` returned neither `is_stranger` nor `team_id` | Now `user.team_id !== input.workspaceId`, so an absent `team_id` reads as external and denies. The envelope's `is_ext_shared_channel` is also forced into the sender attributes (`slack.ts:198`), which is the cross-check T401 §7.1 asked for. |
| F-08 | The ambient write gate was an injected port with no production wiring | `mastra/index.ts:142` injects the real `authorize()` at the `write_memory` gate. |
| F-09 | `deduplicate()` had only an in-memory reference ledger | `slack.ts:146` backs it with the Mastra-store-backed `StateAdapter`, with explicit 24 h delivery and 10 min content TTLs. |

One note on process rather than code: this review was written against `b639ef0` and re-run against `f9ad978` after T405 landed. A design review of a moving branch is only accurate at a stated commit — T502 should re-check the findings above against whatever tip it signs off, particularly anything touching `src/mastra/channels/slack.ts`, which did not exist when the first pass began.

## 9. Resolved after the review (merged 2026-08-30)

Security review packs A, B, and C, plus the standalone F-17 fix, were
implemented in worktrees, scope-checked, merged --no-ff into
integration/mastra-rewrite, and verified with the full suite and
npm run typecheck -- both green at every step (534 tests after A+B, 546 after
C, D012, T406, and F-17).

| Finding | Pack | Merge commit | Resolution |
|---|---|---|---|
| F-01 | A (fix/security-review-pack-a) | 79d4f82 | Post-recall filtering drops messages outside the authorized conversation boundary before citation construction. |
| F-02 | B (fix/security-review-pack-b) | 538ead1 | Mutation crash windows closed: delete tombstones no longer rolled back on failure; compensation ordering pinned. |
| F-03 | A (fix/security-review-pack-a) | 79d4f82 | Empty recall remains empty; failures emit retrieval_failed and trigger fixed unverifiable-response guidance. |
| F-05 | B (fix/security-review-pack-b) | 538ead1 | Storage built inside createFoundationRuntime from validated config.databaseUrl after parseConfig(). Module-level singleton and import-time side effect removed. |
| F-06 | B (fix/security-review-pack-b) | 538ead1 | Archive import routed through shared authorize() at write_memory using resolveIdentity()/messageKey(). ARCHIVE_SENDER_ATTRIBUTES constant added; ImportFailureReason invalid_identity added. |
| F-07 | B (fix/security-review-pack-b) | 538ead1 | Retention sweep no longer fails open: a de-approved channel with no recorded removal time starts its clock at `policy.now` and is reported in `unrecorded_channel_removals` / `channel_removal_starts` until the timestamp is persisted. |
| F-10 | A (fix/security-review-pack-a) | 79d4f82 | Retrieved Slack evidence marked as untrusted data in instructions; closing evidence tags stripped from retrieved text. |
| F-11 | C (fix/security-review-pack-c) | 185aa73 | Test suites relocated out of `src/migration/**`, so test code no longer compiles into the production build. |
| F-13 | C (fix/security-review-pack-c) | 185aa73 | Retention sweep paged rather than loading every message of every thread into memory. |
| F-14 | C (fix/security-review-pack-c) | 185aa73 | Tombstone growth bounded and `updateResource` merge semantics pinned by test. |
| F-15 | C (fix/security-review-pack-c) | 185aa73 | `semanticRecall.scope` pinned on the recall the processor performs instead of being accepted from a caller-supplied `memoryConfig`. |
| F-17 | fix/security-f17 | 3d7390b | Agent and ingestion writes converge on one message row. `agentUserTurn()` gives the agent's user turn the same `messageKey` id, `createdAt`, and metadata block the ingestion writers use, so a delete keyed on `messageKey` reaches every copy. Confirmed first by diagnostic (`c144a44`), which measured two rows for one Slack message and one survivor after a delete. |

F-16 -- coordinator ruling (2026-08-30): Per decision authority delegated by
the operator, the defensible default applies: channel history is channel
history. Messages authored by external/guest/deactivated users remain in the
channel corpus. D006 covers future interaction, not retroactive removal.
Logged in DECISIONS.md as D011.

Remaining findings for T502: **F-12, F-18, F-19, F-20**.

F-12 (in-process mutation lock) is accepted for the single-instance deployment
the PRD assumes and should be revisited if that changes. F-18, F-19, and F-20
were triaged for testability in
[`remaining-findings-triage.md`](./remaining-findings-triage.md): all three are
testable offline today, and none is blocked on live Slack or a provider key.
