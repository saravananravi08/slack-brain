# T502 — Security and privacy review sign-off

- **Task:** [T502](../implementation/tasks/T502-SECURITY-REVIEW.md)
- **Signed at:** `integration/mastra-rewrite` @ `d9ec0d0`
- **Date:** 2026-08-30
- **Reviewer:** claude-planner-2
- **Source review:** [`design-review.md`](../security/design-review.md) — 20 findings, 4 high / 6 medium / 10 low
- **Triage:** [`remaining-findings-triage.md`](../security/remaining-findings-triage.md)

## 1. Verdict

**Conditional go for internal beta.** Every finding that could leak data across a
privacy boundary, or leave deleted content readable, is fixed and covered by a
test. Two findings are carried as named, accepted risks. One verification item
has never been performed, and it is the one this sign-off is least able to
compensate for.

| | |
|---|---|
| Findings fixed in code | 18 of 20 |
| Findings accepted as risk | 2 (F-12, F-19) — neither is a leak |
| High-severity findings outstanding | **0** |
| Verification items from review §7 completed | 4 of 5 |
| Secrets in tree or history | **none** |
| Dependency advisories | 3 low, none reachable in the deployed path |
| Suite at sign-off | 550 passing, 2 skipped, 4 todo; `typecheck` clean |

**The condition:** no real Slack message has ever traversed this system. Every
privacy guarantee below rests on unit and integration evidence against synthetic
fixtures. The live cross-boundary test that review §7 item 2 asks for is blocked
on B-07 — an operator posting a message in the approved dev channel — and until
it runs, "zero known cross-boundary leak" means *zero known from offline
evidence*. That is a real and stated limit, not a formality. Beta may begin on
this basis, but §7 item 2 must run before the beta corpus contains anything the
team would mind leaking.

## 2. Findings register

All 20 findings from the design review, with resolution and merge commit.

### Fixed

| ID | Sev | Category | Resolution | Merge |
|---|---|---|---|---|
| F-01 | High | Leak (defence) | Post-recall filtering drops any message outside the authorized boundary before citations are built, so `decision.scope` is the filter and not merely an assertion | `79d4f82` |
| F-02 | High | Leak (crash window) | Delete removes the embedding before the row; edit writes a pending marker before replacing the embedding; `reconcileTombstones()` finishes either if interrupted | `538ead1` |
| F-03 | High | Contract / trust | A failed recall is no longer indistinguishable from an empty one — failure emits `retrieval_failed` instead of a confident answer over no evidence | `79d4f82` |
| F-04 | Medium | Fail-open | `isExternal` derives from `team_id` mismatch, so an absent team identity reads as external and denies; envelope `is_ext_shared_channel` cross-checks it | `f64b2dc` (T405) |
| F-05 | Medium | Fail-open / config | Storage built inside `createFoundationRuntime` from validated `config.databaseUrl`; module-level singleton and import-time filesystem side effect removed | `538ead1` |
| F-06 | Medium | Contract divergence | Archive import routed through the shared `authorize()` at `write_memory`, using `resolveIdentity()` / `messageKey()`; D001 has one implementation | `538ead1` |
| F-07 | Medium | Fail-open / retention | A de-approved channel with no recorded removal time starts its clock at `policy.now` and is reported until the timestamp is persisted | `538ead1` |
| F-08 | Medium | Wiring | The ambient write gate injects the real `authorize()` rather than an unbound port | `f64b2dc` (T405) |
| F-09 | Medium | Idempotency | `deduplicate()` backed by the Mastra-store `StateAdapter`, with explicit delivery and content TTLs | `f64b2dc` (T405) |
| F-10 | Medium | Prompt injection | Retrieved Slack text is marked untrusted in the instructions and its closing evidence tags are neutralized | `79d4f82` |
| F-11 | Low | Build hygiene | Test suites moved out of `src/migration/**`, so test code no longer compiles into the production build | `185aa73` |
| F-13 | Low | Operability | Retention sweep pages instead of loading every message of every thread | `185aa73` |
| F-14 | Low | Data growth | Tombstone growth bounded; `updateResource` merge semantics pinned by test | `185aa73` |
| F-15 | Low | Fail-open (future) | `semanticRecall.scope` pinned on the recall the processor performs, not accepted from a caller-supplied `memoryConfig` | `185aa73` |
| F-16 | Low | Decision needed | Ruled by the coordinator as D011: channel history is channel history; external/guest/deactivated authors' historical messages remain in the corpus | D011 |
| F-17 | High | Leak (deletion) | Agent and ingestion writes converge on one row — `agentUserTurn()` gives the agent's turn the same `messageKey`, `createdAt`, and metadata block the ingestion writers use, so a delete reaches every copy | `3d7390b` |
| F-18 | Medium | Fragility | Envelope capture pinned by a spike-style test, plus a rate-limited warning when the delivery context is missing, so a silent stop becomes visible | `be979ec` |
| F-20 | Low | Metadata fidelity | The true classification is preserved instead of relabelled, with `isValidInput` relaxed in the same change so preserving it cannot turn messages into skipped `invalid_event`s | `3f35c00` |

### Accepted as risk — not fixed

| ID | Sev | Status | Merge |
|---|---|---|---|
| F-12 | Low | Accepted (see §3.1) | — |
| F-19 | Medium | Test pinned, fix deferred (see §3.2) | `d9ec0d0` |

## 3. Accepted risks

### 3.1 F-12 — the mutation lock is in-process only

`MastraMutationStorage#exclusive` serialises mutations within one process. Two
processes editing the same message could interleave a row save and a vector
replace.

**Accepted** on the single-instance deployment the PRD assumes. The risk is not
a leak: the worst outcome is a message whose stored text and embedding disagree
until the next edit or reconciliation pass.

- **Condition of acceptance:** the deployment stays single-instance. This must
  be written into the T504 runbook as an operating constraint, not left as an
  implicit property of how it happens to be run today.
- **Revisit when:** anything scales the runtime horizontally, or a second
  process (a migration job, a retention sweep run out-of-band) writes to the
  same store concurrently.
- **Owner:** T504 (runbook), then T506 if production topology changes.

### 3.2 F-19 — ambient messages dropped by the shared concurrency lock

The Chat SDK's `concurrency: 'drop'` default is kept deliberately for the reply
path (FR-SLK-007), and ambient ingestion now shares it. A message arriving in a
thread while a turn is in flight **for that same thread** is dropped before any
handler runs, so it is never stored. FR-MEM-001 expects every approved-channel
message to be captured.

The behaviour is now **pinned by test** (`d9ec0d0`) rather than suspected: the
suite asserts the drop happens and that it is thread-scoped, so the blast radius
is one active thread rather than a whole channel.

**The fix is deferred deliberately**, because it is a design decision rather than
a code change: either ambient ingestion moves off the concurrency-controlled
path, or the loss is accepted and counted. Both have costs — the first
reintroduces the concurrent-turn behaviour FR-SLK-007 excludes, the second
accepts a known gap in the corpus.

- **This is data loss, not a leak.** Nothing is exposed; something is missing.
- **Beta impact:** a user asking about a message posted into an active thread
  during generation may get "I couldn't verify that" for a message that was in
  fact sent. Under D009 that is a correct answer over an incomplete corpus, and
  it is indistinguishable to the user from any other gap.
- **Owner:** T502 follow-up / T505 beta review, with the decision recorded in
  `DECISIONS.md` either way.
- **Recommendation:** count the drops before choosing. The test bounds the
  behaviour; a counter in the ingestion path would bound the *frequency*, and
  that is the number the decision actually turns on.

## 4. Verification items from review §7

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | F-17 end-to-end delete against a real store | **Done** | `tests/integration/live-ingestion/f17-diagnostic.test.ts` — diagnostic first measured two rows and one survivor, then inverted to assert zero survivors, `deleted` for the addressed-only case, and no embedding outliving the row |
| 2 | Live cross-boundary tests | **Not done — blocked** | B-07: needs a human message in the approved dev channel. Offline equivalents exist (`tests/integration/memory-validation/privacy-boundaries.test.ts`, `tests/security/access/boundaries.test.ts`) but no real Slack message has traversed the system |
| 3 | Call-order inspection for INV-2 | **Done** | `tests/channels/routing.test.ts` "authorization ordering (INV-2)"; `tests/ingestion/persistence/ambient-persistence.test.ts` "denies an unapproved channel before any storage or embedding call"; `tests/ingestion/mutations/mutation-policy.test.ts` "denies before any storage lookup or write" |
| 4 | Crash-injection for F-02 | **Done** | `tests/ingestion/mutations/mutation-policy.test.ts` — failure injected at both crash windows, plus reconciliation idempotency and mid-edit repair |
| 5 | Prompt-injection case for F-10 | **Done** | `tests/memory/citation-recall.test.ts` "neutralizes closing evidence tags in recalled Slack text" |

Item 2 is the gap. It is not closable by more offline testing; it needs the
operator action tracked as B-07.

## 5. Independent checks run for this sign-off

Not inherited from the review — run against the tree at `d9ec0d0`.

**Dependency advisories** (`npm audit --omit=dev`): **3 low, 0 moderate, 0 high,
0 critical.**

| Advisory | Path | Assessment |
|---|---|---|
| `@ai-sdk/provider-utils` — uncontrolled resource consumption (GHSA-866g-f22w-33x8) | transitive via `@mastra/core` | Low. Reachable only through model-provider calls, which are already bounded by the runtime's own timeouts and single-turn concurrency |
| `@mastra/core` — depends on the above | direct | Same advisory, same assessment |
| `esbuild` — arbitrary file read via the dev server on Windows (GHSA-g7r4-m6w7-qqqr) | build tooling | **Not reachable in the deployed path.** Dev-server-only, Windows-only; this service deploys on Linux and does not run a dev server |

`npm audit fix` is available and would clear all three. It edits `package.json`
and the lockfile, which is outside this task's write scope — recommended as a
separate change before T505, not blocking.

**Secrets and private data:**

- No `.env`, `.db`, `.sqlite`, `.pem`, credential, or secret file is tracked.
- No `.env` file has ever been added in the repository's history.
- Zero matches for Slack (`xoxb-`, `xapp-`) or OpenAI (`sk-`) token patterns
  across the full history of all branches.
- `.gitignore` covers `.env`, `.env.*` (with `!.env.example`), every SQLite
  extension, `traces/`, and `worktrees/`.

**Suite:** 550 passing, 2 skipped, 4 todo across 37 files; `tests/security` alone
is 175 passing across 6 files. `npm run typecheck` clean.

## 6. What this sign-off does not cover

Stated so nobody reads more assurance into it than it carries:

- **No live Slack traffic has been processed.** See §4 item 2.
- **This is a design and code review, not a penetration test.** No adversarial
  testing was performed against a running instance.
- **No review of the deployed environment** — host hardening, network egress,
  backup encryption at rest, and operator access control are T504's, and none
  has been examined here.
- **The model provider's handling of prompt content** is governed by D010's
  no-training terms and was not independently verified.
- **T502's own dependency is not satisfied.** The task depends on P03 and P04
  being complete; PG-04D remains open (T406 live cases, B-07) and P03 has open
  work. This document therefore signs off **the security review**, not the P05
  phase gate. It does not by itself unblock T505.

## 7. Conditions for beta

1. **Run review §7 item 2** — live cross-boundary validation — once B-07 clears.
   This is the one outstanding verification, and it should complete before the
   beta corpus holds anything sensitive.
2. **Record F-19's disposition** in `DECISIONS.md`, whichever way it goes.
   Instrument the drop count first if the decision is not obvious.
3. **Write F-12's single-instance constraint** into the T504 runbook.
4. **Clear the three low advisories** with `npm audit fix` in a separate change.
5. **Re-run this checklist** if any high-severity finding is opened between now
   and T505.

None of the four fixed high-severity findings, and no leak-class finding, is
outstanding. On the security review's own terms — "critical/high findings block
beta unless formally remediated" — nothing blocks.

## 8. Note on task scope

T502's declared write scope is `tests/security/release/**` and
`docs/reports/security-review.md`. This sign-off was written to
`docs/reports/security-review-signoff.md` at the coordinator's direction, and
no `tests/security/release/**` suite exists: T502's "automated negative tests"
deliverable is met by suites that live with the code they exercise
(`tests/security/access`, `tests/integration/memory-validation`,
`tests/ingestion/**`) rather than in a dedicated release directory. That is a
reasonable outcome — tests belong next to their subject — but the task file's
scope should be corrected rather than left describing a directory that will
never exist.
