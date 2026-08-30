# Gist → Mastra Migration — Orchestrator Handover

> **Purpose:** zero-knowledge continuation of the multi-agent Mastra migration for the `slack-brain` repo. Written 2026-08-30 by the outgoing coordinator (Augment Agent).
> **Read first:** `GIST_MASTRA_PRD.md`, `MASTRA_MIGRATION_PLAN.md`, `docs/implementation/README.md`, `docs/implementation/STATUS.md` (canonical live status), `docs/implementation/EXECUTION_LOG.md` (event history).

---

## 1. What this program is

Rebuild the internal Slack knowledge bot **Gist** on the **Mastra** framework (TypeScript). Mastra owns: Slack connectivity (Socket Mode), conversation state, memory + semantic recall, model execution, persistence, tracing. Legacy Slack Bolt / Claude CLI / custom SQLite FTS / search CLI are removed from the production path. Hard rules: automatic pre-generation retrieval (no search tool), per-channel + per-DM privacy isolation (fail-closed), idempotent event handling, restart durability.

## 2. Where the work lives

- **Machine:** user workstation `pop-os`, repo at `~/Documents/slack-brain`
- **Integration branch:** `integration/mastra-rewrite` (all task work merges here, `--no-ff`)
- **Task branches:** `task/T<NNN>-<slug>` in git worktrees at `~/Documents/worktrees/T<NNN>`
- **New runtime code:** `src/mastra/**`, `src/config.ts`, `src/security/**`, `src/ingestion/**`, `src/migration/**`, `benchmarks/**`, `tests/**`
- **Credentials:** `~/Documents/slack-brain/.env` (gitignored, chmod 600) — `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `GIST_DEV_CHANNEL_ID`, `OPENAI_API_KEY` present; D012 uses OpenAI for generation and embeddings

## 3. Agent mesh operations (herdr MCP)

Agents run as terminal panes on the user's machine, steered via the `agent-mesh` MCP server.

**Current fleet** (workspace `w1`):
| Name | Pane | Harness | Model | Role |
|---|---|---|---|---|
| pi-coder-15 | w1:p3 | pi | gpt-5.6-sol | idle, fresh |
| claude-planner-2 | w1:p4 | claude | Opus 5 | running SECFIX-B |
| pi-coder-13 | w1:p5 | pi | gpt-5.6-sol | running SECFIX-A |
| pi-coder-14 | w1:p6 | pi | gpt-5.6-sol | running T406 live validation |
| (shell) | w1:p1 | bash | — | coordinator shell (git/integrator work) |

**Model rules (operator-mandated):**
- Planning/design → claude (Opus 5). Coding → pi (gpt-5.6-sol). If Claude hits limits/friction → fall back to pi.
- Rotate any session whose context exceeds ~50% (pi shows `%/272k` in its status line): send `/quit`, Enter, relaunch `pi --model gpt-5.6-sol`, then `/auto-accept-writes`, Enter, then `herdr_agent_rename`.

**Known MCP/CLI quirks (learned the hard way):**
- `herdr_relay` / `herdr_handoff` / `herdr_agent_send` are BROKEN (map to nonexistent `herdr agent send`). Instead: `herdr_pane_send_text` (types text) + `herdr_pane_send_keys` `["enter"]` (submits).
- `herdr_agent_start` requires `--kind` the MCP tool doesn't pass — start agents via `herdr_pane_run` (`pi --model gpt-5.6-sol` / `claude --model opus`).
- `herdr_agent_wait` broken (`--status` vs `--until`) — poll `herdr_agent_list`.
- pi agent_status can be stale ("working" while idle) — always verify by `herdr_pane_read` of the pane.
- The MCP server occasionally drops for minutes — wait ~60s and retry; agents keep running meanwhile.
- Narrow panes mangle wide table output — keep shell output short or redirect to /tmp files and `head -c`.
- Claude Code auto-mode classifier intermittently blocks bash calls requiring manual Enter approval in the pane — watch for the "Do you want to proceed?" dialog and press Enter, or move the work to pi.
- pi: `/auto-accept-writes` (toggles ON) must be enabled per session or file writes stall. `/quit` exits cleanly.

## 4. Governance workflow (must follow)

Per `docs/implementation/README.md`:
1. **Coordinator** (you) assigns tasks in `STATUS.md` (small commit), then worker branches from latest `integration/mastra-rewrite` into a worktree.
2. Worker edits only task **write scope** + its own `tasks/<ID>.md` / `logs/<ID>.md`; never phase files, STATUS.md, EXECUTION_LOG.md, DECISIONS.md.
3. Worker verifies (task file's verification section + `git diff --check` + scope diff), commits with task ID in subject, marks `Ready for Integration`, handoff commit.
4. **Integrator** (you, in w1:p1): scope-check (`git diff --name-only integration/mastra-rewrite...<branch>`), merge `--no-ff`, run `npm test` + `npm run typecheck`, mark task `Completed` in task file + phase file + STATUS.md, append `EXECUTION_LOG.md`, commit `docs(Pxx): complete Txxx`.
5. `package.json`/lockfile/tsconfig are T101/T508-owned. When a worker needs a script/dep, record a narrow ownership transfer row in STATUS.md "Active write locks", then let the worker add it. (Precedents: T103-dep `@mastra/observability`, T205-dep benchmark script, T305-dep import CLI script.)
6. `tests/smoke/project.test.ts` asserts package.json scripts as a **subset** (`toMatchObject`) — additive scripts are safe.
7. Never commit secrets/Slack content/DBs/traces/.env. `.env.probe` copies must be deleted after use.

## 5. Decisions (all Accepted — DECISIONS.md)

D001 deny-by-default channel allowlist from config · D002 DMs = private memory only (shared recall behind off-flag) · D003 full archive, approved channels, staged import · D004 retention: channels indefinite, DMs 90d, traces 30d, logs 14d, backups 35d · D005 edits re-embed, deletes hard-delete (content-free tombstones) · D006 workspace membership sufficient, external/guest/deactivated denied · D007 superseded by D012 · D008 OpenAI text-embedding-3-small (1536d) · D009 sender+date citation required · D010 US/EU no-training provider · D012 OpenAI gpt-4.1 generation (gpt-4.1-mini step-down). Decision authority was delegated by the operator to the coordinator on 2026-08-30 — continue deciding, escalate only true blockers (keys/approvals) via Slack DM `U08853HLC5U`.

## 6. Status: what's done

**P00 Governance ✅** (T000 repo safety, T001 decisions, T002 baseline benchmark, T003 Slack dev runbook, T004 architecture contracts)
**P01 Foundation ✅ code gate** (T101 scaffold, T102 config, T103 storage/tracing, T104 Slack adapter, T105 Gist agent, T106 runtime integration)
**P02 Memory ✅** (T201 memory config, T202 identity policy, T203 authz/privacy guard, T204 memory integration, T205 benchmark harness, T206 validation — privacy 178/178, 0 leaks; D012 generation re-baseline pending)
**P03 History — code complete except real import:** T301 contract, T302 reader, T303 mapping, T304 writer, T305 orchestration+CLI all merged. T306 synthetic rehearsal merged; **real sample import blocked on B-03**. T307 not started.
**P04 Live ingestion — code complete:** T401 spike (+2 live probes merged), T402 normalization/dedup, T403 silent persistence, T404 mutation policy, T405 integration merged. **T406 live validation running.**
**Security:** early design review merged (`docs/security/design-review.md`, 20 findings: 3 High, 4 Medium). **SECFIX-A (F-01 post-retrieval boundary filter, F-03 retrieval-failed vs empty, F-10 prompt-injection delimiter) and SECFIX-B (F-02 mutation delete ordering, F-05 storage import-time side effect, F-06 identity/authorize single implementation in migration mapping, F-07 retention fail-open) are IN FLIGHT** — merge them when workers hand off (branches `fix/security-review-pack-a` / `fix/security-review-pack-b`).
**P05 Release — not started** except T504 runbook draft (branch `task/T504-write-and-rehearse-deployment-backup-restore-rollback-runbook`, keep open until T307/T406 outcomes land).

Test count on integration as of handover: 514 passing (before SECFIX merges).

## 7. Open blockers (operator: saravanan, Slack DM U08853HLC5U)

| ID | Need | Why |
|---|---|---|
| B-03 | read-only path to legacy archive DB backup (`slack_messages.db` or equivalent) — NOT on this machine under `/home/saravananravi` | T306 real sample import → T307 full import |
| — | operator posts one **human-authored** message in the probe channel (bot posts are filtered as bot traffic) | T406 ambient-message live validation |

Resolved: B-01 (Slack creds placed), B-02 (D012 moved generation to existing OpenAI credential), B-04 (workspace is a test workspace), B-05 (chat:write/users:read + reinstall + channel invite), B-06 (im:* scopes + reinstall).

## 8. Slack app state (test workspace)

App reinstalled with: `chat:write`, `users:read`, `im:read`, `im:write`, `im:history`. Bot invited to probe channel. Event subscriptions (`message.channels`, `message.im`) assumed on but **cannot be read back via API** — first live delivery confirms. Live probe: post/edit/delete + users.info pass. Probe tooling: `tests/spikes/slack-events/live-probe.ts` (has preflight that reports granted/missing scopes). Details: `docs/spikes/slack-event-support.md`.

## 9. Next actions (in order)

1. Merge SECFIX-A and SECFIX-B when handed off (scope-check, merge --no-ff, full `npm test`, log). Watch for cross-pack conflicts in `src/ingestion/mutations/**` — merge B first, then A; both must be green before T502.
2. Collect T406 results from pi-coder-14 (live validation matrix). If the ambient case is pending the human message, ask operator to post one in the probe channel.
3. Re-run T205's generation benchmark against D012's `gpt-4.1`; record the re-baseline before release acceptance.
4. When B-03 (archive DB) lands: T306 real sample import (backup source first, mount read-only), then T307 full import (needs sample approval — you may approve per delegation, note in DECISIONS/EXECUTION_LOG).
5. P04 gate close after T406; P03 gate after T307.
6. P05 wave: T501 E2E acceptance, T502 security review (confirm all 20 findings resolved), T503 perf/observability with D012 cost/latency assumptions, T504 runbook completion (branch exists). Then T505 beta → T506 cutover → T507 handover → T508 legacy cleanup (each needs explicit gate notes; T506/T508 need operator approval).
7. Keep STATUS.md / phase files / EXECUTION_LOG.md accurate after every merge — a doc-drift review already caught stale gates once.

## 10. Communicating with the operator

Slack DM channel `D0BSXJ2JKPX` (user `U08853HLC5U`, saravanan@fabulate.com.au). He prefers: decide autonomously, only ping for true blockers (keys, approvals, human actions in Slack UI). He monitors the agent panes live and expects all workers busy — keep idle slots filled and poll frequently.
