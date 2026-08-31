# File Ownership and Conflict Prevention

## Rules

1. A path may have only one active writer.
2. Task write scopes are exclusive even when Git could auto-merge them.
3. Dependencies must be merged before dependent tasks branch.
4. Shared composition files are changed only by integration tasks.
5. `package.json`, lockfiles, and TypeScript config are exclusive to tasks explicitly assigned below.
6. Each worker owns only `tasks/<ID>.md` and `logs/<ID>.md` under implementation docs.
7. Phase integrator alone updates phase files, `STATUS.md`, and `EXECUTION_LOG.md`.

## Reserved shared paths

| Path | Exclusive owner |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json` | T101; later T508 during final cleanup |
| `src/mastra/index.ts` | T103 initially; T106/T204/T405 when integrating |
| `src/mastra/agents/gist.ts` | T105 initially; T204 when integrating memory |
| `src/mastra/channels/slack.ts` | T104 initially; T405 when integrating ingestion |
| `src/config.ts` | T102 |
| `.env.example` | T102; T508 final cleanup |
| `.gitignore` | T000; T508 final cleanup |
| `docs/implementation/phases/*` | Phase integrator only |
| `docs/implementation/STATUS.md` | Coordinator/phase integrator only |
| `docs/implementation/EXECUTION_LOG.md` | Phase integrator only |
| `docs/implementation/DECISIONS.md` | Coordinator only |
| `src/ingestion/events/**` | T603 during P06 |
| `src/ingestion/persistence/**` | T604 during P06 |
| `src/ingestion/mutations/**` | T605 during P06 |
| `src/config.ts`, `src/security/**`, `src/mastra/channels/**`, `src/mastra/index.ts` | T606 during P06; T705 for P07 agent/context integration |
| `src/mastra/memory/gist-memory.ts` | T702 during P07 |
| `GIST_SLACK_SUPERVISOR_PRD.md`, `docs/architecture/slack-supervisor/**`, `tests/contracts/slack-supervisor/**` | T801; T803 may amend contracts after T802 |
| `src/orchestration/workflows/**` | T901 during P09 |
| `src/orchestration/events/**` | T902 during P09 |
| `src/orchestration/dispatch/**` | T903 during P09 |
| `src/orchestration/supervisor/**` | T904 during PG-09A; T905/T1004 during serialized integration |
| `src/config.ts`, `.env.example`, `src/mastra/channels/**`, `src/mastra/agents/**`, `src/mastra/index.ts`, `src/orchestration/index.ts` | T905 during P09; T1004 for final P10 integration |

## Source ownership by area

| Area | Paths | Tasks |
|---|---|---|
| Runtime scaffold | package/config/build files | T101 |
| Config validation | `src/config.ts`, `tests/config/**` | T102 |
| Storage/tracing | `src/mastra/storage/**`, initial `src/mastra/index.ts`, `tests/storage/**` | T103 |
| Slack channel | initial `src/mastra/channels/**`, `tests/channels/**` | T104 |
| Agent behavior | initial `src/mastra/agents/**`, `tests/agents/**` | T105 |
| Foundation integration | shared composition/startup files | T106 |
| Memory | `src/mastra/memory/gist-memory.ts`, `tests/memory/config*` | T201 |
| Resource mapping | `src/mastra/memory/resource-policy.ts`, matching tests | T202 |
| Access control | `src/security/**`, matching tests | T203 |
| Memory integration | shared agent/channel/runtime files | T204 |
| Benchmarks | `benchmarks/**`, `tests/benchmarks/**` | T205 |
| Memory validation | integration tests only | T206 |
| Migration source | `src/migration/source/**` | T302 |
| Migration mapping | `src/migration/mapping/**` | T303 |
| Migration writer | `src/migration/writer/**` | T304 |
| Migration integration | `src/migration/index.ts`, CLI/scripts | T305 |
| Live event normalization | `src/ingestion/events/**` | T402 |
| Live persistence | `src/ingestion/persistence/**` | T403 |
| Edit/delete handling | `src/ingestion/mutations/**` | T404 |
| Live integration | shared Slack/runtime files | T405 |
| Release validation | `tests/e2e/**`, reports under `artifacts/` ignored from Git | T501–T503 |
| Deployment docs/config | deployment files and runbooks | T504 |
| Channel enrollment | `src/channel-memory/registry/**` | T602 |
| All-sender normalization | `src/ingestion/events/**` | T603 |
| All-message persistence | `src/ingestion/persistence/**` | T604 |
| Channel edit policy | `src/ingestion/mutations/**` | T605 |
| Multi-channel capture integration | shared config/security/channel/runtime paths | T606 |
| Channel capture validation | `tests/e2e/channel-memory-capture/**`, capture report | T607 |
| Chronological channel history | `src/channel-memory/history/**` | T701 |
| Channel observations | `src/channel-memory/observations/**`, Gist memory config | T702 |
| Semantic memory tool | `src/mastra/tools/channel-memory-search.ts` | T703 |
| Channel context assembly | `src/channel-memory/context/**` | T704 |
| Gist context integration | shared agent/channel/runtime paths | T705 |
| Channel intelligence validation | `tests/e2e/channel-context/**`, context report | T706 |
| Supervisor contracts | PRD, `docs/architecture/slack-supervisor/**`, `tests/contracts/slack-supervisor/**` | T801, then T803 |
| Bot compatibility spike | probe script, spike fixtures/docs/report | T802 |
| Supervisor threat model | supervisor architecture/security/contracts | T803 |
| Durable workflow state | `src/orchestration/workflows/**` | T901 |
| Trusted automation routing | `src/orchestration/events/**` | T902 |
| Slack bot dispatch | `src/orchestration/dispatch/**` | T903 |
| Supervisor decision engine | `src/orchestration/supervisor/**` | T904 |
| Supervisor runtime integration | shared config/agent/channel/runtime paths | T905 |
| Supervisor resilience validation | resilience/security/e2e tests and report | T906 |
| Human assignment policy | one policy module/test | T1001 |
| Kilo steering policy | one policy module/test | T1002 |
| Linear steering policy | one policy module/test | T1003 |
| Supervisor final integration/live gate | shared supervisor/runtime, e2e/runbook/report | T1004 |

## Conflict check before handoff

```bash
# P08–P10
 git diff --name-only feature/gist-slack-bot-supervisor...HEAD

# Earlier phases
 git diff --name-only integration/mastra-rewrite...HEAD
```

Use the applicable base. Every listed path must appear in the task write scope. If not, revert or split it into the correct dependent task before handoff.
