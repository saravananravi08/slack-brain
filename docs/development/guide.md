# Gist developer guide

- **Task:** [T507](../implementation/tasks/T507-HANDOVER.md)
- **Written at:** `integration/mastra-rewrite` @ `956393c`
- **Audience:** a developer taking over Gist without access to the people who built it.

Gist is a Slack knowledge assistant. It answers questions about approved Slack
channels from what those channels have actually said, cites sender and date, and
silently ingests ordinary channel traffic so it has something to cite. It runs as
one process holding one Slack Socket Mode connection.

## 1. Read these first

Four frozen contracts in [`docs/architecture/contracts/`](../architecture/contracts/)
govern almost every decision in the codebase. They are not background reading —
most non-obvious code exists to satisfy a specific clause.

| Contract | What it fixes |
|---|---|
| `slack-event.md` | Event classification, the `NormalizedEvent` shape, dual idempotency keys, mutation semantics, skip reasons |
| `identity.md` | `ch:`/`dm:` boundary IDs, thread-root normalization, forbidden operations |
| `authorization.md` | The three gates, deny reasons, retrieval scope rules |
| `errors.md` | What a user sees, what a log may contain, failure containment |

Then [`DECISIONS.md`](../implementation/DECISIONS.md). D001 (channel allowlist),
D002 (DMs are private-memory-only), D005 (edit/delete propagation), D006
(membership vs allowlist), D009 (citations), and D012 (OpenAI provider) all have
direct code consequences.

## 2. Architecture

### Three request paths

Everything the runtime does is one of three paths. Confusing them is the most
common way to break a privacy or behavioural invariant.

```
                  ┌─ addressed ──→ authorize → recall → generate → ONE reply
Slack event ─────►├─ ambient ────→ authorize → dedupe → persist   (no reply, no model call)
                  └─ mutation ───→ authorize → edit/delete row + embedding
```

- **Addressed** — a DM, an `@Gist` mention, or a message in a thread Gist has
  subscribed to. The only path permitted to call the model or post.
- **Ambient** — an ordinary human message in an approved channel. **INV-6: this
  path must never generate or reply.** It exists purely to build the corpus.
- **Mutation** — `message_changed` / `message_deleted`. Propagates the edit or
  delete into both the message row and its embedding (D005, INV-9).

### Module map

| Path | Responsibility | Notes |
|---|---|---|
| `src/config.ts` | Environment validation (zod) | Fails closed. No defaults for anything security-relevant. Exits non-zero on invalid config |
| `src/index.ts` | Process lifecycle | Validates config, starts the channel, installs SIGINT/SIGTERM handlers |
| `src/mastra/index.ts` | Composition root | Builds storage, Mastra, memory, agent, security policy, and the live channel. **The only place these are wired** |
| `src/mastra/channels/` | Slack transport (T104) | `handlers.ts` runs one addressed turn; `slack.ts` adds ambient + mutation ingestion; `errors.ts` holds the fixed user-facing strings |
| `src/mastra/memory/resource-policy.ts` | Identity | `resolveIdentity`, `messageKey`, `deliveryKey`. **The only place a `BoundaryId` may be composed** |
| `src/mastra/memory/gist-memory.ts` | Memory + recall | Semantic recall scoped to the resource, post-recall boundary filter, citation metadata |
| `src/mastra/storage/` | libSQL store + observability | Trace redaction lives in `observability.ts` |
| `src/security/` | Authorization guard (T203) | `authorize()` is pure, total, deny-by-default. No I/O, no clock, no ambient config |
| `src/ingestion/events/` | Normalization + dedupe (T402) | Pure. Converts raw Slack events into `NormalizedEvent` |
| `src/ingestion/persistence/` | Ambient writes (T403) | Channel-only; DM content can never reach a channel boundary |
| `src/ingestion/mutations/` | Edit/delete/retention (T404) | Includes `reconcileTombstones()` for interrupted mutations |
| `src/migration/` | Archive import (T302–T305) | Read-only source reader, mapping, idempotent writer, orchestration |

### Invariants you must not break

These are enforced by tests. If you find yourself editing one of these tests to
make a change pass, stop and re-read the contract instead.

1. **Authorization precedes every storage read or write** (INV-2), on all three
   paths including mutations. `withAuthorization()` in `src/security/guard.ts`
   makes this structural.
2. **Ambient messages never generate or reply** (INV-6).
3. **`BoundaryId`s are composed only in `resource-policy.ts`** (identity.md §4).
   A dropped `ch:`/`dm:` prefix is how cross-boundary leaks happen.
4. **Slack `ts` stays a verbatim string.** Never `Number()` it — the precision
   pair `1735689600.000200` / `1735689600.0002` must stay distinct.
5. **Both root encodings collapse to one thread.** `thread_ts` absent and
   `thread_ts === message_ts` are the same root.
6. **Retrieval queries only the authorized scope**, and recalled messages are
   filtered against it before citations are built.
7. **Logs never contain message text, tokens, or user names.** Reason codes,
   classes, and counts only.
8. **Deleting a message removes its row and its embedding together**, and the
   agent's copy and the ingestion copy are the same row (F-17).

## 3. Local setup

No credentials are needed for the default test suite.

```bash
git clone <repo> slack-brain && cd slack-brain
npm ci                # pinned install; do not use npm install for a clean setup
npm run typecheck     # tsc --noEmit
npm test              # full suite, entirely offline
```

For anything that talks to Slack or a provider, copy `.env.example` to `.env` and
fill it from the approved secret store. `.env` is gitignored; never commit it,
never paste values into a ticket, and never pass them as command arguments.

### Test suites

| Command | Covers |
|---|---|
| `npm test` | Everything offline |
| `npm run test:ingestion` | Normalization, dedupe, persistence, mutations |
| `npm run test:e2e` | PRD acceptance scenarios (AC-01…AC-15) |
| `npm run test:migration` | Archive import |
| `npx vitest run tests/security` | Authorization and privacy boundaries |
| `npx vitest run tests/performance` | T503 latency/throughput measurements |
| `npx vitest run tests/spikes` | **SDK behaviour pins — see §6** |

Opt-in suites that cost money or need credentials, all skipped by default:

```bash
T501_LIVE_PROVIDER=1 ...   # real OpenAI generation
T501_LIVE_SOCKET=1 ...     # real Slack Socket Mode connect/reconnect
T503_LIVE_PROVIDER=1 ...   # provider latency sampling
```

### Build and run

```bash
npm run build                    # mastra build → .mastra/output
npx tsc && node dist/src/index.js   # the Socket Mode runtime
```

`node --experimental-strip-types src/index.ts` **does not work** — the sources
use NodeNext `.js` specifiers and the process exits `ERR_MODULE_NOT_FOUND`. The
entry point must be compiled.

## 4. Testing conventions

- **Tests live in `tests/`**, mirroring the source tree. (One exception survives;
  see §7.)
- **Everything is synthetic.** Identifiers come from
  `docs/architecture/contracts/fixtures/manifest.json` — `T0SYNTH01`,
  `C0APPROVED1`, `U0MEMBER01`, and so on. No real workspace, channel, user, or
  message text appears anywhere in the repository.
- **Contract fixtures drive the tests that implement a contract.** Pin
  `contract_version` and fail on a major bump rather than silently adopting new
  semantics.
- **Negative assertions must be mutation-checked.** A test asserting "no handler
  fired" or "nothing was stored" is worthless if it would pass anyway. Change the
  input, confirm the test fails, change it back.
- **Model calls are faked, not stubbed away, when the write path matters.**
  `MastraModelConfig` accepts a `LanguageModel` object, so an agent turn can run
  with a hand-rolled fake — no provider, no key. See
  `tests/integration/live-ingestion/f17-diagnostic.test.ts`. Stubbing
  `agent.stream` removes the memory write and hides whole classes of bug.

## 5. Making a change safely

1. Find the contract clause your change touches. If there isn't one, you may be
   about to invent behaviour that another module already assumes.
2. Work in a branch and a worktree. Keep to one area of the tree.
3. Add or update tests with the behaviour, in the same commit.
4. `npm run typecheck && npm test` before every commit.
5. Never commit secrets, Slack content, database files, or traces.

## 6. Upgrading the Slack SDK

`chat` and `@chat-adapter/slack` are pinned to exact versions, and the ingestion
path depends on behaviour that is **not** in their public type surface: the
routing order, the dedupe key shapes, ack ordering, mutation dispatch, and the
`processEventPayload` entry that envelope capture patches.

`tests/spikes/slack-events/` exists to guard exactly that. It drives the real SDK
classes offline and asserts the behaviour P04 was designed against.

**A failure in `tests/spikes/` after a version bump is not a test to update — it
is a re-run of the T401 spike.** Read
[`docs/spikes/slack-event-support.md`](../spikes/slack-event-support.md), confirm
what changed, and decide whether the ingestion design still holds before
touching the assertions.

## 7. Known rough edges

Real, small, and worth knowing before you trip over them.

- **One test suite still lives under `src/`.**
  `src/migration/source/tests/migration/source/archive-reader.test.ts` was missed
  when finding F-11 relocated the others, so it is still compiled into the build
  output by `tsconfig.json`'s `src/**/*.ts` include. Its sibling
  (`mapping/tests/`) was moved correctly. Moving it to `tests/migration/source/`
  is a small, safe change nobody has made yet.
- **`npx tsc` emits `dist/tests` as well as `dist/src`**, because `tsconfig.json`
  includes `tests/**`. Only `dist/src` is needed at runtime. A production build
  wants a config that excludes tests.
- **No Slack-to-trace correlation.** `createFoundationRuntime` calls
  `gistAgent.stream` without a Slack-derived run ID, so a trace cannot be tied
  back to the Slack event that caused it (T503 finding 2). NFR-OBS-001 expects
  that correlation; it is not implemented.
- **Three low-severity dependency advisories** are outstanding (`npm audit
  --omit=dev`). None is reachable in the deployed path; `npm audit fix` clears
  them.

## 8. Where the history is

- [`docs/implementation/`](../implementation/) — the task system: one spec and
  one append-only log per task, plus `DECISIONS.md`, `STATUS.md`, and
  `EXECUTION_LOG.md`. Task logs record why things were done the way they were.
- [`docs/security/design-review.md`](../security/design-review.md) — the 20
  findings, their resolutions, and their merge commits.
- [`docs/reports/`](../reports/) — acceptance, performance, live-ingestion, and
  the security sign-off.
