# Implementation Status Dashboard

> Canonical assignment/status view. Coordinator and phase integrators only. Workers update their own task file/log, not this dashboard.

## Program status

- **Overall:** In Progress
- **Integration branch:** `feature/gist-slack-bot-supervisor` for P08–P10; upstream `integration/mastra-rewrite`
- **Coordinator:** herdr orchestrator (P08–P10)
- **Current phase gate:** P06/P07 code and offline validation are merged; their operator live checklists remain pending. **Product-owner priority:** T804 structured Channel Supervisor is first—strict intent planning, durable ordered Kilo work/notify/review steps, runtime-owned identity/destination/artifacts, owner-scoped status, and workflow checkpoints in proactive context. Verbatim-tail dispatch is superseded. T802 remains paused.
- **Last updated:** 2026-09-01 07:25 UTC — structured implementation `6729880` and handoff `a697294` are on the T804 branch; full suite 2560 passed / 5 skipped, typecheck/build green. Blocker-only review and structured live gate pending. User-token dispatch is disabled during review; normal Gist questions remain live.

### Security review status

All 20 findings from [`design-review.md`](../security/design-review.md) are
dispositioned. **Zero high-severity outstanding.**

| Disposition | Count | Findings |
|---|---|---|
| Fixed in code and merged | 17 | F-01…F-11, F-13, F-14, F-15, F-17, F-18, F-20 |
| Resolved by ruling | 1 | **F-16** — coordinator ruling D011: channel history is channel history; external/guest/deactivated authors' historical messages stay in the corpus |
| Accepted as risk | 1 | **F-12** — in-process mutation lock; accepted on the single-instance deployment assumption, now documented in the T504 runbook (T502 sign-off §3.1) |
| Test pinned, instrumented, fix deferred | 1 | **F-19** — ambient messages dropped by the shared `concurrency: 'drop'` lock. Data loss, not a leak. The fix is a design decision (should ambient ingestion share the reply path's concurrency control?); instrument the drop count before deciding. Drop-count instrumentation merged (`d48a6d2`), so the beta can now measure the frequency the decision depends on. Owner: T502 follow-up / T505 (sign-off §3.2) |

T502's recorded verdict is **conditional go for internal beta** — see
[`security-review-signoff.md`](../reports/security-review-signoff.md). T406 has
now supplied the previously missing real Slack and cross-boundary evidence and
merged GO at `f9e20de`; T502's report/metadata still needs a release-gate refresh.

## Assignment protocol

1. Coordinator confirms dependencies are merged and write scope is free.
2. Coordinator updates owner/branch/start fields here in a small assignment commit.
3. Worker then creates branch/worktree and starts.
4. Integrator updates status to `Completed` only after merge and checks.

## Phase summary

| Phase | Status | Depends on | Integrator | Exit commit |
|---|---|---|---|---|
| [P00](./phases/P00-GOVERNANCE.md) — Governance, Safety, and Contracts | Completed | — | Augment | T004 merge 151dc00 |
| [P01](./phases/P01-FOUNDATION.md) — Mastra and Slack Foundation | Completed (code gate; live smoke scheduled in P05 validation) | P00 | Augment | cffce23 |
| [P02](./phases/P02-MEMORY.md) — Memory, Retrieval, and Privacy | Completed | P01 | Augment | a5c77e7 |
| [P03](./phases/P03-HISTORY.md) — Historical Slack Migration | In Progress | P02 | Augment | — |
| [P04](./phases/P04-LIVE-INGESTION.md) — Live Silent Channel Ingestion | Completed | P02 | Augment | f9e20de |
| [P05](./phases/P05-RELEASE.md) — Validation, Release, and Cleanup | In Progress (deliverables merged; operator beta/cutover/rollback gates pending) | P03, P04 | Unassigned | — |
| [P06](./phases/P06-CHANNEL-CAPTURE.md) — Complete Multi-Channel Capture | Merged (offline GO; live checklist pending operator) | T406, D013–D015 | Kilo coordinator | 1a63d5e |
| [P07](./phases/P07-CHANNEL-CONTEXT.md) — Channel Context and Observational Memory | Merged (offline GO; live checklist pending operator) | P06, D016–D017 | Kilo coordinator | 58f1cc1 |
| [P08](./phases/P08-SLACK-AUTOMATION-CONTRACTS.md) — Slack Automation Contracts and Compatibility | In Progress | baseline `5fdf8e2`, D023–D029 | herdr orchestrator | — |
| [P09](./phases/P09-DURABLE-SUPERVISOR.md) — Durable Slack Supervisor Runtime | Planned | P08 | Unassigned | — |
| [P10](./phases/P10-BOT-STEERED-WORKFLOWS.md) — Bot-Steered Workflows and Live Validation | Planned | P09 | Unassigned | — |

## Task dashboard

| Task | Phase | Status | Depends on | Parallel group | Owner | Branch | Start | Completion commit |
|---|---|---|---|---|---|---|---|---|
| [T000](./tasks/T000-REPOSITORY-SAFETY.md) — Repository safety and secret hygiene | P00 | Completed | — | PG-00A | pi-coder | task/T000-repository-safety-and-secret-hygiene | 2026-08-30 | 730a415 |
| [T001](./tasks/T001-PRODUCT-DECISIONS.md) — Resolve product and security decisions | P00 | Completed | — | PG-00A | claude-planner | task/T001-resolve-product-and-security-decisions | 2026-08-30 | ef7838e |
| [T002](./tasks/T002-BASELINE-BENCHMARK.md) — Capture baseline and retrieval benchmark | P00 | Completed | — | PG-00A | pi-coder-2 | task/T002-capture-baseline-and-retrieval-benchmark | 2026-08-30 | 818734a |
| [T003](./tasks/T003-SLACK-DEV-ENVIRONMENT.md) — Prepare isolated Slack development environment | P00 | Completed | — | PG-00A | pi-coder-3 | task/T003-prepare-isolated-slack-development-environment | 2026-08-30 | 090e8ad |
| [T004](./tasks/T004-ARCHITECTURE-CONTRACTS.md) — Define architecture and data contracts | P00 | Completed | T001 | PG-00B | claude-planner | task/T004-define-architecture-and-data-contracts | 2026-08-30 | 151dc00 |
| [T101](./tasks/T101-PROJECT-SCAFFOLD.md) — Scaffold Mastra TypeScript project | P01 | Completed | P00 | PG-01A | pi-coder | task/T101-scaffold-mastra-typescript-project | 2026-08-30 | 872bd8b |
| [T102](./tasks/T102-CONFIG-VALIDATION.md) — Implement startup configuration validation | P01 | Completed | T101 | PG-01B | pi-coder-2 | task/T102-implement-startup-configuration-validation | 2026-08-30 | 6d6c3c3 |
| [T103](./tasks/T103-STORAGE-TRACING.md) — Configure Mastra storage and tracing | P01 | Completed | T101 | PG-01B | pi-coder-3 | task/T103-configure-mastra-storage-and-tracing | 2026-08-30 | 9f701a5 |
| [T104](./tasks/T104-SLACK-CHANNEL.md) — Implement Mastra Slack channel adapter | P01 | Completed | T101, T003, T004 | PG-01B | claude-planner | task/T104-implement-mastra-slack-channel-adapter | 2026-08-30 | 5b211d0 |
| [T105](./tasks/T105-GIST-AGENT.md) — Implement Gist agent behavior | P01 | Completed | T101, T004 | PG-01B | pi-coder | task/T105-implement-gist-agent-behavior | 2026-08-30 | 5a3f443 |
| [T106](./tasks/T106-FOUNDATION-INTEGRATION.md) — Integrate foundation runtime | P01 | Completed | T102, T103, T104, T105 | PG-01C | pi-coder-4 | task/T106-integrate-foundation-runtime | 2026-08-30 | cffce23 |
| [T201](./tasks/T201-MEMORY-CONFIG.md) — Configure Mastra Memory and semantic recall | P02 | Completed | T103, T105 | PG-02A | pi-coder-7 | task/T201-configure-mastra-memory-and-semantic-recall | 2026-08-30 | af8fb8d |
| [T202](./tasks/T202-RESOURCE-POLICY.md) — Implement resource and thread identity policy | P02 | Completed | T004, T106 | PG-02A | pi-coder-5 | task/T202-implement-resource-and-thread-identity-policy | 2026-08-30 | a55ed56 |
| [T203](./tasks/T203-ACCESS-PRIVACY.md) — Implement Slack authorization and privacy guard | P02 | Completed | T004, T102, T104 | PG-02A | claude-planner-2 | task/T203-implement-slack-authorization-and-privacy-guard | 2026-08-30 | 49751a4 |
| [T205](./tasks/T205-RETRIEVAL-BENCHMARK.md) — Build retrieval benchmark harness | P02 | Completed | T002, T004 | PG-02A | pi-coder-6 | task/T205-build-retrieval-benchmark-harness | 2026-08-30 | bcfb465 |
| [T204](./tasks/T204-MEMORY-INTEGRATION.md) — Integrate memory, identity, and access | P02 | Completed | T201, T202, T203, T106 | PG-02B | pi-coder-5 | task/T204-integrate-memory-identity-and-access | 2026-08-30 | b296c18 |
| [T206](./tasks/T206-MEMORY-VALIDATION.md) — Validate memory, retrieval, and privacy | P02 | Completed | T204, T205 | PG-02C | pi-coder-6 | task/T206-validate-memory-retrieval-and-privacy | 2026-08-30 | a5c77e7 |
| [T301](./tasks/T301-IMPORT-CONTRACT.md) — Define archive import contract and fixtures | P03 | Completed | P02 | PG-03A | pi-coder-8 | task/T301-define-archive-import-contract-and-fixtures | 2026-08-30 | f50438e |
| [T302](./tasks/T302-SOURCE-READER.md) — Implement read-only archive source reader | P03 | Completed | T301 | PG-03B | pi-coder-8 | task/T302-implement-read-only-archive-source-reader | 2026-08-30 | 2b14097 |
| [T303](./tasks/T303-MESSAGE-MAPPING.md) — Implement archive message normalization | P03 | Completed | T301 | PG-03B | pi-coder-9 | task/T303-implement-archive-message-normalization | 2026-08-30 | 2640d21 |
| [T304](./tasks/T304-MEMORY-WRITER.md) — Implement idempotent Mastra memory writer | P03 | Completed | T201, T301 | PG-03B | pi-coder-10 | task/T304-implement-idempotent-mastra-memory-writer | 2026-08-30 | da7558d |
| [T305](./tasks/T305-IMPORT-ORCHESTRATION.md) — Integrate archive importer and reporting | P03 | Completed | T302, T303, T304 | PG-03C | pi-coder-9 | task/T305-integrate-archive-importer-and-reporting | 2026-08-30 | aa1b4ea |
| [T306](./tasks/T306-SAMPLE-IMPORT.md) — Run sample archive import and quality gate | P03 | Planned | T205, T305 | PG-03D | Unassigned | — | — | — |
| [T307](./tasks/T307-FULL-IMPORT.md) — Execute full historical import | P03 | Planned | T306, Product/security approval | PG-03E | Unassigned | — | — | — |
| [T401](./tasks/T401-ADAPTER-EVENT-SPIKE.md) — Spike supported ordinary Slack event handling | P04 | Completed | T104, T206 | PG-04A | claude-planner-2 | task/T401-spike-supported-ordinary-slack-event-handling | 2026-08-30 | 8ba694e |
| [T402](./tasks/T402-EVENT-NORMALIZATION.md) — Normalize and deduplicate live Slack events | P04 | Completed | T401 | PG-04B | claude-planner-2 | task/T402-normalize-and-deduplicate-live-slack-events | 2026-08-30 | 4c615da |
| [T403](./tasks/T403-SILENT-PERSISTENCE.md) — Persist ambient messages silently | P04 | Completed | T201, T202, T401 | PG-04B | pi-coder-10 | task/T403-persist-ambient-messages-silently | 2026-08-30 | c3365cd |
| [T404](./tasks/T404-MUTATION-POLICY.md) — Implement edit/delete and retention mutation policy | P04 | Completed | T001, T203, T401 | PG-04B | pi-coder-11 | task/T404-implement-edit-delete-and-retention-mutation-policy | 2026-08-30 | 21f5d72 |
| [T405](./tasks/T405-LIVE-INTEGRATION.md) — Integrate live silent ingestion | P04 | Completed | T402, T403, T404, T204 | PG-04C | pi-coder-12 | task/T405-integrate-live-silent-ingestion | 2026-08-30 | f64b2dc |
| [T406](./tasks/T406-LIVE-VALIDATION.md) — Validate live ingestion end to end | P04 | Completed (live matrix GO) | T405, T205 | PG-04D | pi-coder-14 | task/T406-validate-live-ingestion-end-to-end | 2026-08-30 | f9e20de |
| [T501](./tasks/T501-E2E-ACCEPTANCE.md) — Run complete PRD acceptance suite | P05 | Merged (automated acceptance passes; launch gate remains NO-GO pending P03/P04) | P03, P04 | PG-05A | pi coding agent | task/T501-run-complete-prd-acceptance-suite | 2026-08-30 | 0839422 |
| [T502](./tasks/T502-SECURITY-REVIEW.md) — Perform security and privacy review | P05 | Merged (conditional beta sign-off; live cross-boundary evidence pending B-07) | T203, P03, P04 | PG-05A | claude-planner-2 | task/T502-security-design-review-early | 2026-08-30 | 276cf52 |
| [T503](./tasks/T503-PERFORMANCE-OBSERVABILITY.md) — Validate performance and observability | P05 | Merged (suite/report; NO-GO pending runtime correlation and concurrent-ingestion remediation) | P03, P04 | PG-05A | pi coding agent | task/T503-validate-performance-and-observability | 2026-08-30 | f9b7723 |
| [T504](./tasks/T504-DEPLOYMENT-RUNBOOK.md) — Write and rehearse deployment, backup, restore, rollback runbook | P05 | Merged (runbooks complete; rehearsals pending T307/T406) | T106, T307, T406 | PG-05A | claude-planner-2 | task/T504-write-and-rehearse-deployment-backup-restore-rollback-runbook | 2026-08-30 | eebe8a9 |
| [T505](./tasks/T505-BETA-RELEASE.md) — Execute internal beta release | P05 | Merged (preparation only; operator-run beta and approval pending) | T501, T502, T503, T504 | PG-05B | claude-planner-2 | task/T505-execute-internal-beta-release | 2026-08-30 | 956393c |
| [T506](./tasks/T506-PRODUCTION-CUTOVER.md) — Perform production cutover | P05 | Pending operator approval (cutover not run) | T505, Product/technical/security approval | PG-05C | Unassigned | — | — | — |
| [T507](./tasks/T507-HANDOVER.md) — Complete operator and developer handover | P05 | Merged (documents complete; walkthrough and owner acceptance pending) | T505 | PG-05D | claude-planner-2 | task/T507-complete-operator-and-developer-handover | 2026-08-30 | 67f8e5e |
| [T508](./tasks/T508-LEGACY-CLEANUP.md) — Remove legacy runtime after rollback window | P05 | Merged (assessment only; deletion blocked on T506 and rollback-window approval) | T506, Rollback-window approval | PG-05D | pi coding agent | task/T508-remove-legacy-runtime-after-rollback-window | 2026-08-30 | f1e856b |
| [T601](./tasks/T601-CHANNEL-MEMORY-CONTRACTS.md) — Freeze channel-memory contracts | P06 | Completed | T406, D013–D015 | PG-06A | claude-opus5 | task/T601-freeze-channel-memory-contracts | 2026-08-31 | d8206d1 |
| [T602](./tasks/T602-JOINED-CHANNEL-REGISTRY.md) — Implement joined-channel registry | P06 | Completed | T601 | PG-06B | pi-coder-16 | task/T602-implement-joined-channel-registry | 2026-08-31 | 35da11a |
| [T603](./tasks/T603-ALL-SENDER-NORMALIZATION.md) — Normalize all message senders | P06 | Completed | T601 | PG-06B | pi-coder-17 | task/T603-normalize-all-message-senders | 2026-08-31 | 7dfd075 |
| [T604](./tasks/T604-ALL-MESSAGE-PERSISTENCE.md) — Persist all live channel messages | P06 | Completed | T601 | PG-06B | pi-coder-19 | task/T604-persist-all-live-channel-messages | 2026-08-31 | a52871d |
| [T605](./tasks/T605-EDIT-FIDELITY.md) — Enforce edit fidelity and delete-ignore policy | P06 | Completed | T601 | PG-06B | pi-coder-18 | task/T605-enforce-edit-fidelity | 2026-08-31 | 9cc1326 |
| [T606](./tasks/T606-MULTI-CHANNEL-CAPTURE-INTEGRATION.md) — Integrate multi-channel capture runtime | P06 | Completed | T602, T603, T604, T605 | PG-06C | pi-coder-20 | task/T606-integrate-multi-channel-capture-runtime | 2026-08-31 | 7fd43b5 |
| [T607](./tasks/T607-MULTI-CHANNEL-CAPTURE-VALIDATION.md) — Validate complete multi-channel capture | P06 | Merged (offline GO; live gate pending operator) | T606 | PG-06D | pi-coder-21 | task/T607-validate-complete-multi-channel-capture | 2026-08-31 | 1a63d5e |
| [T701](./tasks/T701-CHANNEL-HISTORY.md) — Build chronological channel history provider | P07 | Completed | P06 | PG-07A | pi-coder-23 | task/T701-build-channel-history-provider | 2026-08-31 | e31d0b6 |
| [T702](./tasks/T702-OBSERVATIONAL-MEMORY.md) — Enable channel-scoped Observation Memory | P07 | Completed | P06, T605 | PG-07A | pi-coder-22 | task/T702-enable-channel-observation-memory | 2026-08-31 | 3fdc67f |
| [T703](./tasks/T703-SEMANTIC-MEMORY-TOOL.md) — Implement scoped semantic memory tool | P07 | Completed | P06, D017 | PG-07A | pi-coder-24 | task/T703-implement-semantic-memory-tool | 2026-08-31 | e18fcb1 |
| [T704](./tasks/T704-CHANNEL-CONTEXT-ASSEMBLY.md) — Assemble bounded channel context | P07 | Completed | T701, T702, T703 | PG-07B | pi-coder-23 | task/T704-assemble-bounded-channel-context | 2026-08-31 | fb7e35c |
| [T705](./tasks/T705-GIST-CONTEXT-INTEGRATION.md) — Integrate context with Gist agent | P07 | Completed | T704, T703 | PG-07C | pi-coder-24 | task/T705-integrate-context-with-gist-agent | 2026-08-31 | 0ab9164 |
| [T706](./tasks/T706-CHANNEL-INTELLIGENCE-VALIDATION.md) — Validate channel intelligence end to end | P07 | Merged (offline GO; live gate pending operator) | T705 | PG-07D | pi-coder-25 | task/T706-validate-channel-intelligence-end-to-end | 2026-08-31 | 58f1cc1 |
| [T801](./tasks/T801-SUPERVISOR-CONTRACTS.md) — Freeze Slack supervisor contracts | P08 | Completed | D023–D029, baseline `5fdf8e2` | PG-08A | claude-contracts-1 | task/T801-freeze-slack-supervisor-contracts | 2026-09-01 | `73821b5` |
| [T804](./tasks/T804-CHANNEL-SUPERVISOR-SESSION.md) — Implement durable Channel Supervisor session | P08 | In Progress — structured implementation `6729880`, review/live gate pending | T609d, T801 invariants | PG-08S | pi-t804-channel-supervisor | task/T804-channel-supervisor-session | 2026-09-01 | — |
| [T802](./tasks/T802-BOT-COMPATIBILITY-SPIKE.md) — Prove Kilo and Linear bot compatibility | P08 | Blocked | T804 priority, transport decision | PG-08B | pi-t802-compatibility | task/T802-prove-kilo-linear-bot-compatibility | 2026-08-31 | — |
| [T803](./tasks/T803-AUTOMATION-THREAT-PROTOCOL.md) — Finalize automation protocol and threat model | P08 | Planned | T802 | PG-08C | Unassigned | task/T803-finalize-automation-threat-protocol | — | — |
| [T901](./tasks/T901-WORKFLOW-REGISTRY.md) — Implement durable workflow registry | P09 | Planned | P08 | PG-09A | Unassigned | task/T901-implement-durable-workflow-registry | — | — |
| [T902](./tasks/T902-AUTOMATION-EVENT-ROUTER.md) — Implement trusted automation event router | P09 | Planned | P08 | PG-09A | Unassigned | task/T902-implement-trusted-automation-event-router | — | — |
| [T903](./tasks/T903-SLACK-BOT-DISPATCH.md) — Implement structured Slack bot dispatch | P09 | Planned | P08 | PG-09A | Unassigned | task/T903-implement-structured-slack-bot-dispatch | — | — |
| [T904](./tasks/T904-SUPERVISOR-DECISION-ENGINE.md) — Implement supervisor decision engine | P09 | Planned | P08 | PG-09A | Unassigned | task/T904-implement-supervisor-decision-engine | — | — |
| [T905](./tasks/T905-SUPERVISOR-RUNTIME-INTEGRATION.md) — Integrate durable supervisor runtime | P09 | Planned | T901, T902, T903, T904 | PG-09B | Unassigned | task/T905-integrate-durable-supervisor-runtime | — | — |
| [T906](./tasks/T906-SUPERVISOR-RESILIENCE-VALIDATION.md) — Validate supervisor resilience and security | P09 | Planned | T905 | PG-09C | Unassigned | task/T906-validate-supervisor-resilience-security | — | — |
| [T1001](./tasks/T1001-HUMAN-ASSIGNMENT-LIFECYCLE.md) — Implement human assignment and approval lifecycle | P10 | Planned | P09 | PG-10A | Unassigned | task/T1001-implement-human-assignment-lifecycle | — | — |
| [T1002](./tasks/T1002-KILO-STEERING-LIFECYCLE.md) — Implement Kilo execution and review steering | P10 | Planned | P09 | PG-10A | Unassigned | task/T1002-implement-kilo-steering-lifecycle | — | — |
| [T1003](./tasks/T1003-LINEAR-STEERING-LIFECYCLE.md) — Implement Linear work steering | P10 | Planned | P09 | PG-10A | Unassigned | task/T1003-implement-linear-steering-lifecycle | — | — |
| [T1004](./tasks/T1004-SUPERVISOR-LIVE-VALIDATION.md) — Integrate and validate complete Slack supervisor workflow | P10 | Planned | T1001, T1002, T1003 | PG-10B | Unassigned | task/T1004-integrate-validate-slack-supervisor | — | — |

## Active write locks

| Task | Owner | Paths | Acquired | Released |
|---|---|---|---|---|
| T103-dep | pi-coder-3 | package.json, package-lock.json | 2026-08-30 | RELEASED 2026-08-30 (T103 merged 9f701a5) |
| T205-dep | pi-coder-6 | package.json | 2026-08-30 | RELEASED 2026-08-30 (T205 merged bcfb465) |
| T305-dep | pi-coder-9 | package.json (add migration CLI script entry only; transferred from T101) | 2026-08-30 | reverts to T508 after T305 merge |
| T801 | claude-contracts-1 | `GIST_SLACK_SUPERVISOR_PRD.md`, `docs/architecture/slack-supervisor/**`, `tests/contracts/slack-supervisor/**`, own task/log | 2026-09-01 | RELEASED 2026-08-31 23:31 UTC (`73821b5`) |
| T802 | pi-t802-compatibility | `scripts/probes/slack-bot-compatibility.ts`, `tests/spikes/slack-bot-compatibility/**`, `docs/spikes/slack-bot-compatibility.md`, `docs/reports/slack-bot-compatibility.md`, own task/log | 2026-08-31 | PAUSED; WIP preserved |
| T804 | pi-t804-channel-supervisor | `src/config.ts`, `.env.example`, `src/mastra/index.ts`, `src/mastra/channels/**`, smallest required storage/migration paths, focused tests, own task/log | 2026-09-01 | ACTIVE |

## Blockers

| ID | Task/phase | Blocker | Owner | Unblock condition | Opened |
|---|---|---|---|---|---|
| B-01 | T003/P01 | RESOLVED 2026-08-30: credentials placed in .env (gitignored, 0600); live Slack smoke test to run under P02/P05 validation | Operator (saravanan) | done | 2026-08-30 |
| B-02 | T206/runtime | RESOLVED 2026-08-30: D012 switched generation to OpenAI `gpt-4.1`; existing `OPENAI_API_KEY` serves generation and embeddings | Augment coordinator | done | 2026-08-30 |
| B-03 | T301/P03 | **RESOLVED (infrastructure) 2026-08-30:** PostgreSQL archive support merged (`0f1287a`) with a local Docker Postgres carrying a synthetic archive (`docker/archive-postgres/`, loopback `127.0.0.1:55432`, read-only `archive_reader` role). pi-coder-15 reports the container healthy and a synthetic import validated at 42 messages / 42 embeddings / zero failures — **not yet recorded in `logs/T306.md` or a report**. **The original need is not fully met:** T306's real sample import and T307 still require the operator's production archive path or dump | Operator (production archive path) | Production archive made available read-only, then T306 real sample import | 2026-08-30 |
| B-04 | T401/T104/T405 | RESOLVED 2026-08-30: operator confirmed workspace is a test workspace; tokens usable for dev. Remaining: verify users:read scope via live probe | Operator (saravanan) | done | 2026-08-30 |
| B-05 | T401/T405 | RESOLVED 2026-08-30: app reinstalled, probe post/edit/delete + users.info pass. Follow-up: add im:read/im:write/im:history scopes + message.im subscription for DM support | Operator (saravanan) | done | 2026-08-30 |
| B-06 | FR-SLK-002 DMs | RESOLVED 2026-08-30: im scopes added + app reinstalled by operator; probe re-run to confirm | Operator (saravanan) | done | 2026-08-30 |
| B-07 | T406/PG-04D | RESOLVED 2026-08-30: live human ambient capture, edit, delete, addressed recall/reply, and boundary isolation passed; report merged GO at `f9e20de` | pi-coder-14 / Operator | done | 2026-08-30 |
| B-08 | T505/T506 build gate | RESOLVED 2026-08-30: Mastra CLI-required named `mastra` export restored without reintroducing import-time configured storage | Integration | `92aa6a3`; `npm run build`, typecheck, and full tests pass | 2026-08-30 |
| B-09 | T901/T904 reopen capability | Reopen is intentionally unsupported; neither terminal reactivation nor linked-new-workflow behavior is approved | Product owner | Choose reopen semantics before T901/T904 implement that capability; does not block T802/T803 | 2026-08-31 |
