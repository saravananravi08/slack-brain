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

## Conflict check before handoff

```bash
git diff --name-only integration/mastra-rewrite...HEAD
```

Every listed path must appear in the task write scope. If not, revert or split it into the correct dependent task before handoff.
