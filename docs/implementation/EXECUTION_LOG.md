# Global Execution Log

Integrator-maintained, append-only log of assignments, merges, phase gates, rollbacks, and major blockers. Workers write detailed activity only to `logs/<TASK-ID>.md`.

## Entry format

```text
## YYYY-MM-DD HH:MM UTC — <TASK/PHASE ID> — <event>
- Actor: <name>
- Branch: <branch or n/a>
- Commits: <implementation>, <merge>, <metadata>
- Result: <one-line outcome>
- Verification: <commands/checks>
- Follow-up: <next task, blocker, or none>
```

## Events

_No implementation events recorded yet._

## 2026-08-30

- T000 Completed: repository safety and secret hygiene (pi-coder, merge 730a415). test_secrets.js removed from index; .gitignore hardened; docs/security/repository-safety.md added.
- T002 Completed: baseline and retrieval benchmark (pi-coder-2, merge 818734a). Synthetic dataset + scoring under benchmarks/baseline; docs/reports/current-system-baseline.md added.
- T003 Completed: Slack dev environment runbook (pi-coder-3, merge 090e8ad). docs/runbooks/slack-dev-environment.md added; live app creation/smoke check await operator credentials.
- T001 Completed: product/security decisions D001-D010 Accepted (coordinator-delegated), PRD aligned (merge ef7838e).
- T004 Completed: architecture and data contracts frozen with v1 fixtures (claude-planner, merge 151dc00). Coordinator note: docs/architecture/contracts/archive-import.md reserved to T301; T004 glob treated as excluding it.
- P00 phase gate closed (exception logged: B-01 Slack dev app pending operator). P01 opened.
- T101 Completed: Mastra TS scaffold (pi-coder, merge 872bd8b). npm ci/typecheck/test/build all pass.
- T105 Completed: Gist agent behavior (pi-coder, merge 5a3f443).
- T102 Completed: startup config validation (pi-coder-2, merge 6d6c3c3). 26 config tests.
- T104 Completed: Slack channel adapter (claude-planner, merge 5b211d0). Live smoke test pending B-01 credentials placement.
- Integration regression after T102+T104: typecheck ok, 79/79 tests pass.
- T103 Completed: storage + tracing with pinned @mastra/observability@1.17.4 (pi-coder-3, merge 9f701a5). Integration regression: 87/87 tests, typecheck, build all pass.
- T106 Completed: foundation runtime integrated (pi-coder-4, merge cffce23). 91/91 tests; build ok. Live Slack smoke pending B-01.
- P01 code gate closed (live Slack smoke pending B-01 credentials placement). P02 opened.
- B-01 resolved: Slack dev credentials placed in .env by operator.
- T201 Completed: Mastra memory + semantic recall config (pi-coder-7, merge af8fb8d).
- T202 Completed: resource/thread identity policy (pi-coder-5, merge a55ed56).
- T203 Completed: Slack authorization + privacy guard (claude-planner-2, merge 49751a4). Cross-boundary denial tests included.
- T205 Completed: retrieval benchmark harness (pi-coder-6, merge bcfb465). Synthetic benchmark: 8 cases, all gates pass.
- T204 scope amendment approved (coordinator): tests/integration/foundation/runtime.test.ts added to T204 write scope to mock the Slack users.info resolver required by T203 fail-closed sender attributes.
- Doc drift fixes: STATUS gate -> P02 in progress; P02 phase file -> In Progress; T103-dep/T205-dep write locks released; B-01 marked resolved (credentials in .env); P01 live-smoke wording updated.
- Fixed post-T205 smoke regression: project.test.ts now expects benchmark:retrieval script (integrator fix on integration branch). 302/302 tests pass.
- T204 Completed: memory/identity/access integrated (pi-coder-5, merge b296c18). 305/305 tests in worker verification.
- P02 phase verification amended (integrator): vitest-compatible commands; dataset path benchmarks/retrieval/synthetic; test:memory script not required (tests/memory via npm test).
- T206 blocker-1 fix merged: retrieval citation metadata (pi-coder-7, fix branch). Suite 307/307.
- T206 Completed: memory/retrieval/privacy validated (pi-coder-6, merge a5c77e7). Privacy 178/178 + boundary suites, 0 leaks; synthetic benchmark 8/8; full suite 313/313. Live-provider benchmark pending B-02.
- P02 phase gate closed (exception: live-provider benchmark/traces pending B-02 keys). P03 + P04 opened.
- T401 spike: live probe built and committed; discovered .env tokens are production-scoped (200 public channels) and lack users:read. No live write attempted. B-04 opened.
- T301 Completed: archive import contract + synthetic fixtures (pi-coder-8, merge f50438e). Inventory counts pending B-03.
- T401 Completed: ordinary event spike + live probe committed (claude-planner-2, merge 8ba694e).
- B-04 resolved: workspace confirmed as test workspace by operator.
- T302 Completed: read-only archive source reader (pi-coder-8, merge 2b14097).
- T303 Completed: archive message normalization (pi-coder-9, merge 2640d21).
- T304 Completed: idempotent memory writer (pi-coder-10, merge da7558d). Integration: 392/392 tests.
- T402 Completed: live event normalization + dual-key dedup (claude-planner-2, merge 4c615da).
- T403 Completed: silent ambient persistence, no model calls (pi-coder-10, merge c3365cd).
- T404 Completed: edit/delete + retention mutation policy (pi-coder-11, merge 21f5d72).
- Smoke assertion changed to subset match so T305+ script additions do not regress T101 smoke.
- T305 Completed: archive importer orchestration + CLI + runbook (pi-coder-9, merge aa1b4ea). 499/499 tests.
- T401 live probe re-run merged (6b0655b): post/edit/delete + users.info confirmed. New finding: derive is_external from team_id mismatch (is_stranger absent = fail-open risk); recorded in spike 7.1 as T405 requirement. B-05 resolved; B-06 opened for DM scopes/events.
- T405 Completed: live silent ingestion integrated (pi-coder-12, merge f64b2dc). 513/513 tests.
- T502 early security design review merged (claude-planner-2, review at f9ad978 tip). Findings in docs/security/design-review.md.
- T306 synthetic import rehearsal merged (pi-coder-13). Real sample import still pending B-03.
- Security fix packs dispatched: A (F-01/F-03/F-10 memory+agent, pi-coder-13), B (F-02/F-05/F-06/F-07 ingestion/storage/migration, claude-planner-2).
- Integrator added test:ingestion + test:e2e scripts; .env chmod 600. ANTHROPIC_API_KEY still missing from .env (B-02 open).
- HANDOVER.md added: full orchestrator state for zero-knowledge continuation.

### 2026-08-30 — SECFIX-A and SECFIX-B merged

- Scope-checked both fix branches against integration/mastra-rewrite: zero file overlap (A touches src/mastra/agents/instructions.ts, src/mastra/memory/gist-memory.ts + tests; B touches src/ingestion/mutations/**, src/migration/mapping/**, src/mastra/index.ts + tests). git diff --check clean on both.
- Merged SECFIX-B first (fix/security-review-pack-b, 3 commits) --no-ff as 538ead1. Covers F-02 (mutation crash windows / tombstone rollback), F-05 (storage built from validated config not import-time), F-06 (archive import routed through authorize()), F-07 (retention fail-open closed).
- Merged SECFIX-A second (fix/security-review-pack-a, 1 commit) --no-ff as 79d4f82. Covers F-01 (post-recall boundary filter), F-03 (retrieval_failed vs empty), F-10 (prompt-injection delimiter + untrusted-data instruction).
- Verified: npm test -- 35 files, 534 tests passed (up from 514 pre-merge). npm run typecheck -- clean.
- Recorded D011 (F-16 ruling: channel history is channel history; external/guest/deactivated historical messages remain in corpus).
- Updated docs/security/design-review.md section 9 with resolution table.
- Workers: pi-coder-13 (SECFIX-A) and claude-planner-2 (SECFIX-B) now idle. pi-coder-14 (T406) blocked on B-02 (ANTHROPIC_API_KEY), missing package.json scripts, and human ambient message. pi-coder-15 idle/fresh.

### 2026-08-30 — D012 accepted; B-02 resolved

- D012 superseded D007: generation moved to OpenAI `gpt-4.1`, with `gpt-4.1-mini` as the pre-approved step-down.
- Existing `OPENAI_API_KEY` now serves generation and embeddings; no Anthropic credential is required. B-02 resolved.
- Follow-up: T205 re-baselines generation quality; T503 adjusts cost and latency expectations.

### 2026-08-30 — SECFIX-C merged

- Merged `fix/security-review-pack-c` --no-ff as `185aa73`. Covers F-11 (test files relocated out of `src/migration/**` so they no longer compile into `dist`), F-13 (retention sweep paged instead of loading every message), F-14 (tombstone map growth and `updateResource` merge semantics), F-15 (`semanticRecall.scope` pinned on the recall processor rather than accepted from the request context).
- Touched `src/ingestion/mutations/{handler,mastra-store,types}.ts`, `src/mastra/memory/gist-memory.ts`, and the matching suites. No overlap with SECFIX-A or SECFIX-B.
- Design review section 9 updated with the four resolutions.

### 2026-08-30 — D012 merged (generation on OpenAI)

- Merge `ab6f023` lands the D012 provider switch in code: `src/config.ts` now validates `GIST_MODEL` as `gpt-4.1` / `gpt-4.1-mini` and requires only `OPENAI_API_KEY`; the Anthropic credential and model IDs are gone from the runtime.
- D007 marked Superseded in `DECISIONS.md`; D008 embeddings unchanged and now share the same provider and credential.
- B-02 resolved as a consequence — there is no second credential to obtain.
- Follow-ups stand: T205 re-baselines generation quality against the new model, T503 revisits cost and latency expectations.

### 2026-08-30 — T406 live-ingestion e2e scaffold merged

- Merged as `347ec14` (pi-coder-14). Offline validation matrix plus the OpenAI recall/mutation checks (`d2b5def`, `b05b8c9`) are green.
- T406 stays **In Progress**. The ambient-ingestion cases cannot close offline: they need a real human message in the approved dev channel, because the bot's own messages are filtered as `isMe` before any handler runs (T401 §3). Recorded as B-07.
- Everything not requiring a human message — normalization, authorization, dedup, mutation dispatch, recall — is covered by the merged scaffold.

### 2026-08-30 — F-17 fixed and merged

- Merged `fix/security-f17` --no-ff as `3d7390b` (claude-planner-2). Highest-severity finding from the T502 early design review.
- Diagnostic first (`c144a44`): with the agent driven by a hand-rolled fake model — no provider, no key — the agent persisted the user turn under a random UUID while the ingestion writers used `messageKey`. One Slack message, two rows. `MutationHandler` resolves by `messageKey`, so a delete reached one and left the other: deleted text stayed in memory and recall saw the message twice.
- Fix: `agentUserTurn()` builds the agent's user turn as the canonical record for that message — same `messageKey` id, `createdAt` from the Slack timestamp, and the same metadata block `ambient-persistence.ts` writes. Assigning the id alone was not sufficient: once both writers shared a key, ambient persistence refused to overwrite a row it did not recognise and every subscribed-thread message became a `content_conflict`. Making the row canonical makes the two writers converge whichever arrives first.
- Diagnostic inverted to assert the fixed behaviour: zero survivors after a delete, the addressed-only case now reports `deleted` rather than a no-op `unchanged`, and no embedding outlives the row (INV-9).
- Verified on the integration branch after all merges: `npm test` — 37 files passed (2 skipped), 546 tests passing (2 skipped, 4 todo). `npm run typecheck` clean.
- Remaining T502 findings: F-12, F-18, F-19, F-20. Testability triaged in `docs/security/remaining-findings-triage.md` — none is blocked on live Slack.

### 2026-08-30 — F-18, F-19, F-20 closed out

Worked in the order the triage recommended (`docs/security/remaining-findings-triage.md`): F-20 first because it had to land with its coupled change, then F-18, then F-19's test.

- **F-20 merged as `3f35c00`** (impl `3985b40`). `ambientProjection` no longer relabels an addressed subscribed-thread message as ambient. The coupled change the triage flagged landed with it: `AmbientNormalizedEvent.class` widened to `'ambient' | 'addressed'`, `addressed_to_gist` to `boolean`, and `isValidInput` now accepts either consistent pair. Without that relaxation, preserving the true classification would have turned every subscribed-thread message into a skipped `invalid_event` — converting a metadata inaccuracy into data loss. Mutations are now rejected from the persistence path with an explicit `TypeError` rather than silently mis-shaped.
- **F-18 merged as `be979ec`** (impl `a537a8d`). Envelope capture is pinned by a spike-style test, and a missing delivery context now emits a rate-limited `ingestion.delivery_context.missing` warning (60 s interval) instead of failing silently. The failure mode this protects against is an SDK upgrade that renames or defers `processEventPayload`: ingestion would stop, every event skipping as `malformed_event`, with nothing in the logs. It is now visible in metrics.
- **F-19 test merged as `c6fc4c2`, handoff `25edd12`.** The same-thread ambient drop under `concurrency: 'drop'` is now pinned by test, including that it is thread-scoped rather than channel-scoped, so the blast radius is bounded and measured. **The fix is deliberately deferred**: it is a design decision about whether ambient ingestion should keep sharing the reply path's concurrency control, and the recommendation is to instrument the drop count before choosing, because frequency is what the decision turns on. Carried as an accepted risk in the T502 sign-off §3.2, owner T502 follow-up / T505.

### 2026-08-30 — T502 security and privacy review sign-off

- Sign-off merged as `276cf52`: [`docs/reports/security-review-signoff.md`](../reports/security-review-signoff.md).
- **Verdict: conditional go for internal beta.** 18 of 20 findings fixed in code, zero high-severity outstanding, 2 carried as named accepted risks (F-12, F-19).
- Checks run for the sign-off rather than inherited: `npm audit --omit=dev` — 3 low, 0 moderate/high/critical (the esbuild advisory is dev-server-on-Windows only and unreachable in the deployed path); secret scan of the working tree and the full history of all branches — no `.env` ever added, zero Slack or OpenAI token-pattern matches; `tests/security` 175 passing.
- **The condition:** no real Slack message has ever traversed the system. Design review §7 item 2 — live cross-boundary validation — is the one verification item not performed, blocked on B-07. Until it runs, "zero known cross-boundary leak" means zero known from offline evidence, and the acceptance criterion is checked with that qualification rather than silently.
- The sign-off covers the security review only. T502's own dependencies are unsatisfied — PG-04D is open on T406 — so it does not close the P05 gate or unblock T505 by itself.

### 2026-08-30 — T504 deployment runbook merged

- Merged as `eebe8a9` (impl `820a393`, handoff `1b1e1cc`). The task branch was 49 commits behind and still listed `ANTHROPIC_API_KEY`; integration was merged in first so the runbook describes the tree it actually deploys.
- **F-12's single-instance constraint is documented**, closing the T502 sign-off §3.1 condition. All three reasons Gist runs as one process, with the dangerous one named: mutation serialization is an in-process lock, so a second writer interleaves a row write with a vector write and leaves a message whose text and embedding disagree — no error, no duplicate reply, nothing in the logs. Cross-referenced from `backup-restore.md`, `rollback.md`, and the systemd unit, because a retention sweep or archive import run against a live service is the same unserialized second writer.
- **The start command was tested, not assumed, and the obvious one is wrong.** `node --experimental-strip-types src/index.ts` fails with `ERR_MODULE_NOT_FOUND` — the sources use NodeNext `.js` specifiers — and must never go in a service unit. `npx tsc && node dist/src/index.js` works and, with no configuration, prints variable names only and exits 1. That gate moved PENDING → PARTIAL; Socket Mode hold, reconnect, and SIGTERM remain T406's.
- Added: service inventory, secret inventory (names, locations, owners, rotation — no values), and six health checks that run today without T406, one of which is the only check that catches a second instance.
- Recorded rather than fixed out of scope: `tsconfig.json` includes `tests/**`, so a plain `npx tsc` emits `dist/tests` beside `dist/src`.
- **Not cutover approval.** Restore and rollback rehearsals need a non-production environment plus T307 (B-03) and T406 (B-07) evidence; acceptance criterion 2 stays unchecked.
- Verified after merge: `npm test` — 550 passing (2 skipped, 4 todo) across 37 files; `npm run typecheck` clean.

### 2026-08-30 — T501 — acceptance suite merged

- Actor: integration coordinator / pi coding agent
- Branch: `task/T501-run-complete-prd-acceptance-suite`
- Commits: implementation `c3e3edc`, evidence `1405b46`, merge `0839422`
- Result: AC-01 through AC-15, config, real-provider, Socket Mode, ambient silence, recall, mutation, archive idempotency, and privacy coverage merged. Automated acceptance passed; launch recommendation remained NO-GO on open P03/P04 gates.
- Verification: typecheck; full suite 569 passing; E2E suite; opt-in real OpenAI generation and Slack Socket Mode reconnect.
- Follow-up: Complete B-03/B-07 operator evidence before launch approval.

### 2026-08-30 — BUILD-FIX — Mastra production build restored

- Actor: integration coordinator / pi coding agent
- Branch: `integration/mastra-rewrite`
- Commits: `92aa6a3`
- Result: Added the Mastra CLI-required named `mastra` export without restoring the F-05 import-time configured storage defect. B-08 resolved.
- Verification: `npm run build`, `npm run typecheck`, compiled standalone-entry fail-closed check, and full suite 569 passing.
- Follow-up: None for build; production cutover still requires operator approval.

### 2026-08-30 — T503 — performance and observability suite merged

- Actor: integration coordinator / pi coding agent
- Branch: `task/T503-validate-performance-and-observability`
- Commits: implementation `aadf6f6`, blocker record `044f2e5`, merge `f9b7723`
- Result: Repeatable latency, throughput, trace-redaction, correlation, cost, and opt-in provider measurements merged. Gate remains NO-GO pending production-path correlation and concurrent-ingestion remediation.
- Verification: performance suites, real GPT-4.1 sample, retrieval benchmark, typecheck, and full regression.
- Follow-up: Add content-free Slack run correlation and remediate concurrent persistence before claiming operational SLOs.

### 2026-08-30 — T504 — coordinator status synchronized

- Actor: integration coordinator / claude-planner-2
- Branch: `task/T504-write-and-rehearse-deployment-backup-restore-rollback-runbook`
- Commits: implementation `820a393`, status `1b1e1cc`, merge `eebe8a9`
- Result: Deployment, backup/restore, rollback, systemd, service/secret inventory, and F-12 single-instance guidance are merged. Rehearsals remain pending T307/T406.
- Verification: build/start-command checks, runbook link/syntax checks, typecheck, and full regression.
- Follow-up: Operator supplies T307/T406 evidence and performs restore/rollback rehearsals.

### 2026-08-30 — T505 — beta release preparation merged

- Actor: integration coordinator / claude-planner-2
- Branch: `task/T505-execute-internal-beta-release`
- Commits: implementation `2dccf1f`, blocker record `c8f4a51`, merge `956393c`
- Result: Beta scope, preflight, deployment procedure, observation plan, exit criteria, and blocker register merged. No beta window or production approval has occurred.
- Verification: Documentation reviewed against merged T501/T503/T504 evidence; current integration build/typecheck/tests pass.
- Follow-up: Operator runs the beta window, captures B-07 evidence, and records go/no-go.

### 2026-08-30 — T507 — handover documentation merged

- Actor: integration coordinator / claude-planner-2
- Branch: `task/T507-complete-operator-and-developer-handover`
- Commits: implementation `fb76167`, status `e34e66d`, merge `67f8e5e`
- Result: Developer architecture/setup guide and operator monitoring/troubleshooting/rollback handover merged. Walkthrough and named-owner acceptance remain pending.
- Verification: `npm ci`, typecheck, full suite 576 passing, and production build at the documented baseline.
- Follow-up: Incoming operator completes the practical walkthrough and private acceptance record.

### 2026-08-30 — T508 — legacy cleanup assessment merged

- Actor: integration coordinator / pi coding agent
- Branch: `task/T508-remove-legacy-runtime-after-rollback-window`
- Commits: assessment `a9a8f4d`, merge `f1e856b`
- Result: Eight dead root legacy modules, stale README/config surfaces, dependency candidates, rollback risks, and safe deletion sequence documented. Nothing was removed.
- Verification: static import/dependency/config scans, typecheck, full suite 576 passing, and production build.
- Follow-up: Deletion remains blocked on T506, explicit rollback-window approval, and verified external rollback assets.

### 2026-08-30 — F-11 — residual source-reader test relocated

- Actor: integration coordinator / coding agent
- Branch: `integration/mastra-rewrite`
- Commits: `7f86d3a`
- Result: Moved `src/migration/source/tests/migration/source/archive-reader.test.ts` to `tests/migration/source/archive-reader.test.ts`; no test files remain under `src/migration/**`.
- Verification: source-reader suite 7 passing; `npm run typecheck`; full suite 576 passing; `git diff --check`.
- Follow-up: None; F-11 source-tree test hygiene is complete.

### 2026-08-30 — CI and toolchain corrections

Five small commits that make the repository buildable, runnable, and continuously verified. Grouped because they are one thread of work.

- **CI added (`f8a4357`).** `.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` on push and pull request against `integration/mastra-rewrite` and `main`, on Node 22 with npm caching. Verified locally at `0ce82e2` in a clean detached worktree: all four steps green. The GitHub-side run itself has not been observed from here.
- **`npm start` fixed (`7bfb04b`).** It now runs `node dist/src/index.js` — the compiled Socket Mode runtime — instead of `mastra start`, which served an HTTP bundle that was never the production entry. Together with the `build` script now being `tsc`, `npm run build && npm start` is exactly the sequence the T504 runbook documents.
- **`tsx` declared (`18f80f4`).** `import:slack` invoked `tsx` without depending on it, so the archive-import CLI worked only where `tsx` happened to be installed. Now pinned at 4.21.0.
- **`dist/` excluded from test discovery (`0ce82e2`).** `vitest.config.ts` adds `**/dist/**` to the default excludes. Without it, running the suite after a build discovers and re-runs the compiled copies of every test.
- **Verified after the batch:** 580 passing, 5 skipped, 4 todo across 46 files; typecheck clean; build produces `dist/src/index.js`.

**Follow-up for the doc owners:** `build` is no longer `mastra build`, which makes two documents stale. `docs/runbooks/deployment.md` still says the build emits a Mastra HTTP bundle and describes `npx tsc` as a separate step, and `docs/releases/beta.md` still instructs the operator to *skip* `npm run build` because of B-08. Both should now say `npm run build` is the supported step.

### 2026-08-30 — F-19 drop instrumentation merged

- Merged as `d48a6d2` (implementation `c5083eb`, claude-planner-2).
- Uses the Chat SDK's supported `onLockConflict` configuration hook rather than patching an internal: the callback fires on thread-lock contention, counts it, emits a rate-limited warning, and returns `'drop'`. Behaviour is unchanged — returning `'force'` would let two turns run concurrently on one thread, which FR-SLK-007 exists to prevent.
- Exposes `channel.concurrencyDrops()` → `{ total, sinceLastWarning, lastDropAt }` for the T505 observation plan, and warns at most once per 60 s carrying the reason code, running total, drops accumulated while the log was silent, and a best-effort `likelyAddressed` hint. No message text, channel, or user reaches the log; a test asserts the exact field set.
- **This is what the deferred F-19 decision was waiting on.** The T502 sign-off §3.2 deferred the fix because the choice turns on how often the drop happens and nobody had the number. The beta can now produce it.
- Tests were mutation-checked: neutralising the counter fails two of them.

### 2026-08-30 — T406 progress and B-03 unblocking

- **T406 (pi-coder-14) remains In Progress.** Reported from the live session: ambient silent persistence confirmed against the real transport, and a **channel-ID recall bug** found. Edit/delete validation still needs operator action. **These findings are not yet in `logs/T406.md` or `docs/reports/live-ingestion-validation.md`** — both still end at the 15:43 UTC provider-validation entry. pi-coder-14 should record the recall bug with its evidence before the task is handed off; a defect found in live validation is exactly what that report exists to carry.
- **B-03 is being unblocked differently than expected.** Rather than supplying a path to an archived SQLite file, pi-coder-15 is standing up the legacy archive as a Docker Postgres instance and adding `src/migration/source/postgres-archive-reader.ts` beside the existing read-only SQLite reader. Work is uncommitted and **does not currently typecheck** — `rowMode` is not a property of `pg`'s `QueryConfig`, so the query calls fail overload resolution. With CI now green on every push, that must be fixed before the branch lands or CI goes red on arrival.
- Reminder for whoever reviews that reader: the SQLite reader is hardened read-only (`immutable=1`, `PRAGMA query_only`, extensions disabled, parameterised queries). A Postgres reader should reach the same posture — a read-only role at minimum — because T302's acceptance rested on the source being impossible to mutate.

### 2026-08-30 — PostgreSQL archive support merged (B-03 infrastructure)

- Merged as `0f1287a` (pi-coder-15), with the archive README added as `da8fec8`.
- Adds `src/migration/source/postgres-archive-reader.ts` beside the read-only SQLite reader, plus `docker/archive-postgres/` — a Postgres service on loopback `127.0.0.1:55432`, a named volume, and an init script creating the schema, a synthetic corpus, and a read-only `archive_reader` role (`default_transaction_read_only = on`, granted only CONNECT/USAGE/SELECT). That role is the Postgres equivalent of the SQLite reader's `mode=ro` + `immutable=1` + `PRAGMA query_only`, which is what T302's acceptance rested on.
- Schema matches `REQUIRED_COLUMNS` in `archive-reader.ts` exactly, so `assertSchema` still fails closed on drift.
- **Reported by pi-coder-15 and not yet in a task log or report:** container healthy, synthetic import validated at 42 messages / 42 embeddings / zero failures. That evidence belongs in `logs/T306.md` and a sample-import report before T306 moves on.
- Two documented consequences, in `docker/archive-postgres/README.md`: `messages.ts` works as a primary key only because the seed folds the channel index into the fraction (a real dump needs `(channel_id, ts)`), and `source_ref` is not comparable between the two readers, since one hashes `rowid` and the other hashes `ts`. Content identity remains `messageKey`, so re-import idempotency is unaffected.
- **B-03 is unblocked for infrastructure only.** T306's real sample import and T307 still need the operator's production archive.
- Verified after merge: typecheck clean; 581 passing, 5 skipped, 4 todo.

### 2026-08-30 — T406 live validation reaches the real transport

- **T406 remains In Progress** (pi-coder-14). The operator posted an `@Gist` mention in the approved channel and **the bot replied** — the first time a human-authored Slack event has traversed the system.
- Reported so far: ambient silent persistence confirmed, edit propagation passing, recall telemetry being verified now. Delete propagation and the paraphrased-recall assertion remain open.
- **This closes the long-standing B-07 shape.** Every earlier attempt failed because the bot cannot author the message it needs — its own traffic is filtered as `isMe` before any handler runs — so a human in the Slack UI was always the only way through.
- **The evidence is not yet written down.** `logs/T406.md` and `docs/reports/live-ingestion-validation.md` both still end at the 15:43 UTC provider-validation entry. The live matrix, and any defect found while validating recall, must land there before T406 hands off; a finding that exists only in a terminal pane is lost when the session rotates.

### 2026-08-30 — Governance documents resynchronised

- STATUS.md, both P03 and P04 phase files, and the T306/T406 task files brought in line with the merges above.
- Test count across the program is now **581 passing, 5 skipped, 4 todo**.
- Recorded in this pass, each verified against the tree rather than taken from the brief: F-11 test relocation `7f86d3a`, CI workflow `f8a4357`, runtime start fix `7bfb04b`, tsx dependency `18f80f4`, vitest `dist/` exclusion `0ce82e2`, F-19 drop instrumentation `d48a6d2`, PostgreSQL archive support `0f1287a`, archive README `da8fec8`.
- The first five of those were logged in the previous sync (`77e7ffb`) and are repeated here only as the consolidated list; their detail is in the entries above this one.

### 2026-08-30 — T406 live validation completed

- T406 merged GO at `f9e20de`. Human ambient capture, zero ambient generation/posts, bot/app exclusion, edit re-embedding, addressed recall/reply with attribution, channel isolation, and target deletion passed.
- The channel-ID normalization defect found during live validation was fixed before handoff.
- B-07 and P04 are closed; sanitized evidence is in `docs/reports/live-ingestion-validation.md`.

## 2026-08-31

### P06/P07 — channel-memory extension planned

- Product owner accepted D013–D017: dynamic joined-channel enrollment, no backfill, all-sender capture, edit fidelity with temporary delete-ignore, channel-scoped Observation Memory, default history/summary/observations, and one scoped semantic memory tool.
- Added `GIST_CHANNEL_MEMORY_PRD.md`, P06/P07 phase gates, T601–T607 and T701–T706 task/log specifications, dependency waves, ownership, dashboard entries, and machine-readable task index records.
- Planning branch: `planning/channel-memory-v2`. No runtime implementation was changed or assigned.

### 2026-08-31 — T601 completed (P06 Wave 1)

- Task: T601 freeze channel-memory contracts; worker: claude-opus5; branch: task/T601-freeze-channel-memory-contracts (worktree worktrees/T601).
- Implementation `991fc4a`; handoff `38fcec0`; merge `d8206d1`; integration metadata: this commit.
- Verification: typecheck OK; contract suite 354 passed / 9 files; git diff --check clean; scope within declared paths; PRD mapping append-only; post-merge full regression 936 passed / 5 skipped.
- Result: merged GO. Blockers: none. Follow-up: T602/T603/T604/T605 Wave 2 dispatch.
