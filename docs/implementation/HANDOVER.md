# Gist → Mastra Migration — Orchestrator Handover

> **Purpose:** zero-knowledge continuation of the multi-agent Mastra migration for the `slack-brain` repo.
> **Revised:** 2026-08-30 at `integration/mastra-rewrite` @ `1d6cc20` (576 tests passing, typecheck clean, build succeeds). Supersedes the earlier handover written before the security fix packs.
> **Read first:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, `docs/implementation/README.md`, `docs/implementation/STATUS.md` (canonical live status), `docs/implementation/EXECUTION_LOG.md` (event history).

---

## 1. What this program is

Rebuild the internal Slack knowledge bot **Gist** on the **Mastra** framework (TypeScript). Mastra owns Slack connectivity (Socket Mode), conversation state, memory and semantic recall, model execution, persistence, and tracing. Legacy Slack Bolt / Claude CLI / custom SQLite FTS / search CLI are removed from the production path.

Hard rules: automatic pre-generation retrieval (no search tool), per-channel and per-DM privacy isolation (fail-closed), idempotent event handling, restart durability.

## 2. Where the work lives

- **Machine:** user workstation `pop-os`, repo at `~/Documents/slack-brain`
- **Integration branch:** `integration/mastra-rewrite` (all task work merges here, `--no-ff`)
- **Task branches:** `task/T<NNN>-<slug>` in git worktrees at `~/Documents/worktrees/T<NNN>`
- **Runtime code:** `src/mastra/**`, `src/config.ts`, `src/security/**`, `src/ingestion/**`, `src/migration/**`, `benchmarks/**`, `tests/**`
- **Credentials:** the gitignored environment file at the repo root (mode 0600) holds the Slack bot and app tokens, the dev channel ID, and the OpenAI key. D012 means **one OpenAI key serves both generation and embeddings**; there is no Anthropic credential.

### Documentation map (know what already exists before writing anything)

| Path | What it is |
|---|---|
| `docs/implementation/` | The task system: one spec + one append-only log per task, plus `STATUS.md`, `EXECUTION_LOG.md`, `DECISIONS.md` |
| `docs/architecture/contracts/` | Four frozen contracts (slack-event, identity, authorization, errors) + synthetic fixtures |
| `docs/security/design-review.md` | 20 findings, resolutions, merge commits |
| `docs/security/remaining-findings-triage.md` | Testability triage for the findings that outlived the review |
| `docs/reports/` | `prd-acceptance.md` (T501), `performance-observability.md` (T503), `live-ingestion-validation.md` (T406), `security-review-signoff.md` (T502), `current-system-baseline.md` (T002) |
| `docs/runbooks/` | deployment, backup-restore, rollback, archive-import, slack-dev-environment |
| `docs/releases/beta.md` | T505 beta scope, checklist, observation plan |
| `docs/operations/handover.md` | **Operator** guide — troubleshooting, monitoring, limitations |
| `docs/development/guide.md` | **Developer** guide — architecture, invariants, testing conventions |
| `docs/spikes/slack-event-support.md` | What the pinned Slack SDK actually does (T401) |

## 3. Agent mesh operations (herdr MCP)

Agents run as terminal panes on the user's machine, steered via the `agent-mesh` MCP server.

**Model rules (operator-mandated):** planning/design → claude (Opus 5); coding → pi (gpt-5.6-sol). If Claude hits limits or friction, fall back to pi. Rotate any session past ~50% context (pi shows `%/272k`): `/quit`, Enter, relaunch `pi --model gpt-5.6-sol`, then `/auto-accept-writes`, Enter, then `herdr_agent_rename`.

**Known MCP/CLI quirks (learned the hard way — these have not changed):**

- `herdr_relay` / `herdr_handoff` / `herdr_agent_send` are BROKEN (they map to a nonexistent `herdr agent send`). Use `herdr_pane_send_text` (types) + `herdr_pane_send_keys ["enter"]` (submits).
- `herdr_agent_start` requires a `--kind` the MCP tool does not pass — start agents via `herdr_pane_run` (`pi --model gpt-5.6-sol` / `claude --model opus`).
- `herdr_agent_wait` is broken (`--status` vs `--until`) — poll `herdr_agent_list`.
- pi `agent_status` goes stale ("working" while idle) — verify with `herdr_pane_read`.
- The MCP server drops for minutes occasionally — wait ~60s and retry; agents keep running.
- Narrow panes mangle wide tables — keep output short or redirect to a temp file and `head -c`.
- Claude Code's auto-mode classifier intermittently blocks bash calls needing manual approval — watch for the "Do you want to proceed?" dialog, or move the work to pi. It also blocks heredocs whose text mentions credential paths; use the editor tool instead.
- pi: `/auto-accept-writes` must be enabled per session or writes stall. `/quit` exits cleanly.

## 4. Governance workflow (must follow)

Per `docs/implementation/README.md`:

1. **Coordinator** assigns tasks in `STATUS.md` (small commit); the worker then branches from the latest `integration/mastra-rewrite` into a worktree.
2. Worker edits only its task **write scope** plus its own `tasks/<ID>.md` and `logs/<ID>.md`. Never phase files, `STATUS.md`, `EXECUTION_LOG.md`, or `DECISIONS.md`.
3. Worker verifies (the task file's verification section + `git diff --check` + scope diff), commits with the task ID in the subject, marks `Ready for Integration`, and makes a handoff commit.
4. **Integrator** scope-checks (`git diff --name-only integration/mastra-rewrite...<branch>`), merges `--no-ff`, runs `npm test` + `npm run typecheck`, marks the task `Completed` in the task file, phase file, and `STATUS.md`, appends to `EXECUTION_LOG.md`, and commits `docs(Pxx): complete Txxx`.
5. `package.json` / lockfile / `tsconfig` are T101/T508-owned. When a worker needs a script or dependency, record a narrow ownership transfer row in the STATUS.md "Active write locks" table first.
6. `tests/smoke/project.test.ts` asserts package.json scripts as a **subset** (`toMatchObject`) — additive scripts are safe.
7. Never commit secrets, Slack content, databases, traces, or the environment file. Delete any local copy of it immediately after use.

**A worker branch that has sat for a while is probably stale.** T504's branch was 49 commits behind and still documented a credential D012 had removed. Merge `integration/mastra-rewrite` into the task branch before continuing old work.

## 5. Decisions (all Accepted — `DECISIONS.md`)

D001 deny-by-default channel allowlist from config · D002 DMs = private memory only (shared recall behind an off flag) · D003 full archive, approved channels, staged import · D004 retention: channels indefinite, DMs 90d, traces 30d, logs 14d, backups 35d · D005 edits re-embed, deletes hard-delete with content-free tombstones · D006 workspace membership sufficient, external/guest/deactivated denied · D007 **superseded by D012** · D008 OpenAI `text-embedding-3-small` (1536d) · D009 sender+date citation required · D010 US/EU no-training provider · **D011 archive sender policy: channel history is channel history — messages authored by external, guest, or deactivated users remain in the corpus; D006 governs future interaction, not retroactive removal** · **D012 OpenAI `gpt-4.1` generation, `gpt-4.1-mini` pre-approved step-down**.

Decision authority was delegated by the operator to the coordinator on 2026-08-30 — continue deciding, and escalate only true blockers (keys, approvals, human actions in Slack).

## 6. Status

**Code is complete for P01–P04.** 576 tests passing, `npm run typecheck` clean, `npm run build` succeeds.

| Phase | State |
|---|---|
| **P00 Governance** | Complete — T000 repo safety, T001 decisions, T002 baseline, T003 Slack dev runbook, T004 contracts |
| **P01 Foundation** | Complete — T101 scaffold, T102 config, T103 storage/tracing, T104 Slack adapter, T105 agent, T106 runtime |
| **P02 Memory** | Complete — T201 memory, T202 identity, T203 authz guard, T204 integration, T205 benchmark, T206 validation |
| **P03 History** | **Code complete; real import blocked.** T301–T305 merged, T306 synthetic rehearsal merged. **T306 real sample import and T307 full import are blocked on B-03.** |
| **P04 Live ingestion** | **Code complete; live validation open.** T401–T405 merged. **T406 in progress** (pi-coder-14) — offline matrix green, live cases pending B-07 |
| **P05 Release** | T501 acceptance, T503 perf/observability, T504 runbook, T505 beta prep, T507 handover, T508 legacy assessment **all merged**. T502 sign-off merged and Ready for Integration. **T506 cutover pending operator approval.** |

### Security: all 20 findings dispositioned, zero high-severity outstanding

| Disposition | Count | Detail |
|---|---|---|
| Fixed in code | 17 | F-01…F-11, F-13, F-14, F-15, F-17, F-18, F-20 across SECFIX-A `79d4f82`, SECFIX-B `538ead1`, SECFIX-C `185aa73`, T405 `f64b2dc`, F-17 `3d7390b`, F-18 `be979ec`, F-20 `3f35c00` |
| Resolved by ruling | 1 | F-16 → D011 |
| **Accepted as risk** | 1 | **F-12** — in-process mutation lock. Accepted on the single-instance assumption, now documented in the deployment runbook |
| **Test pinned, fix deferred** | 1 | **F-19** — ambient messages dropped when one arrives in a thread while a turn is in flight there. Data loss, not a leak. Pinned by test `c6fc4c2`; the fix is a design decision |

T502 verdict: **conditional go for internal beta** (`docs/reports/security-review-signoff.md`). The condition is that live cross-boundary validation has never run — no real Slack message has traversed the system.

## 7. Open blockers

| ID | Need | Owner | Blocks |
|---|---|---|---|
| **B-03** | Read-only path to the legacy archive DB (`slack_messages.db` or equivalent). Not present on this machine | Operator | T306 real import → T307 → P03 gate |
| **B-07** | One **human-authored** message in the approved dev channel while the runtime is connected (the bot's own messages are filtered as `isMe`) | Operator | T406 live cases → PG-04D → T502's open condition |
| — | Operator approval for production cutover | Operator | T506 |

Resolved: B-01 (creds placed), B-02 (D012 moved generation onto the existing OpenAI credential), B-04 (test workspace confirmed), B-05 (`chat:write` / `users:read` + reinstall + channel invite), B-06 (`im:*` scopes + reinstall), B-08 (`npm run build` fixed by `92aa6a3` after the F-05 change removed the `mastra` export).

**B-07 is nearly free.** The app is now a member of the dev channel (verified via `conversations.info`), scopes are granted, and T501's opt-in live checks passed for both Socket Mode and real generation. One human message closes it — and running the T505 beta closes it as a side effect, since the first real message *is* the evidence T406 needs.

## 8. Slack app state (test workspace)

Reinstalled with `chat:write`, `users:read`, `im:read`, `im:write`, `im:history`, plus the pre-existing `channels:history`, `channels:read`, `app_mentions:read`. The bot is a **member of the dev channel**. Event subscriptions (`message.channels`, `message.im`) are assumed on but **cannot be read back through the Web API** without an app-configuration token — the first live delivery confirms them.

Probe tooling: `tests/spikes/slack-events/live-probe.ts`, which preflights and reports granted scopes, missing scopes, `users.info` reachability, and channel membership before writing anything. It supports a DM target via `GIST_DEV_DM_USER_ID` and will not choose a DM counterparty for itself. Details in `docs/spikes/slack-event-support.md`.

## 9. Next actions, in order

1. **Get the human message posted** (B-07). It closes T406's live cases, PG-04D, and T502's open condition in one action, and it is the cheapest unblock available.
2. **Collect T406's live results** from pi-coder-14 and update `docs/reports/live-ingestion-validation.md`. Then close PG-04D.
3. ~~**Land the F-11 residue.**~~ **Done** — `7f86d3a` moved `archive-reader.test.ts` out of `src/` to `tests/migration/source/`. Two cosmetic leftovers: the now-empty `src/migration/source/tests/migration/source/` directory tree is still on disk, and `tsconfig.json` still includes `tests/**` so a plain `npx tsc` emits `dist/tests` beside `dist/src`. Neither affects correctness; both are worth a one-line cleanup when someone next owns `tsconfig.json`.
4. **Run the T505 beta** once 1–3 land. `docs/releases/beta.md` has the scope, checklist, and observation plan. **Measure the F-19 drop count during the window** — that number decides the deferred fix.
5. **Decide F-19** on that evidence and record it in `DECISIONS.md` either way.
6. **When B-03 lands:** T306 real sample import (back up the source first, mount read-only), then T307 full import. T307 needs sample approval — you may approve per delegation; note it in `DECISIONS.md` and `EXECUTION_LOG.md`.
7. **T506 cutover** after the beta, with explicit operator approval. **T508 legacy cleanup** last, also with approval.
8. **Keep `STATUS.md`, phase files, and `EXECUTION_LOG.md` accurate after every merge.** Doc drift has been caught twice already — once with stale phase gates, once with a runbook describing a credential D012 had removed.

## 10. Things that will bite you

Collected from where they actually happened.

- **The dashboard lags reality.** `STATUS.md` has more than once said `Planned` for work already merged. Check `git log` and the reports before believing a status cell.
- **`npm run build` is not the production start path.** The service runs `npx tsc && node dist/src/index.js`. `node --experimental-strip-types src/index.ts` does **not** work — NodeNext `.js` specifiers make it exit `ERR_MODULE_NOT_FOUND`.
- **Stubbing `agent.stream` hides real bugs.** Every suite did it, which is exactly why F-17 (deleted content surviving in the agent's copy of a message) went unseen. `MastraModelConfig` accepts a `LanguageModel` object, so a hand-rolled fake model runs a real agent turn with no provider and no key.
- **A `tests/spikes/` failure after an SDK bump is a re-run of the T401 spike, not a test to update.** It pins behaviour outside the SDK's public type surface.
- **Security fixes can interact.** F-17's ID convergence made ambient persistence report `content_conflict` until the agent's row was also made canonical. F-05's singleton removal broke `mastra build` (B-08). Run the full suite *and* `npm run build` after any change to `src/mastra/index.ts`.
- **Two of the four user-facing strings are usually correct behaviour, not faults** — "I couldn't verify that" (empty corpus) and "I can't help with that here" (policy denial). Operators will escalate them if nobody has explained that.
- **The beta has no historical corpus** while B-03 is open. Gist will know only what has been posted since it started running. Tell beta users before the first message, or it will be reported as a bug.

## 11. Communicating with the operator

Direct message in Slack; the channel and user IDs are in the private operator record. He prefers autonomous decisions and pings only for true blockers — keys, approvals, and human actions in the Slack UI. He watches the agent panes live and expects workers busy, so keep idle slots filled and poll frequently.
