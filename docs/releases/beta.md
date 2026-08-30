# Gist internal beta — release preparation

- **Task:** [T505](../implementation/tasks/T505-BETA-RELEASE.md)
- **Prepared at:** `integration/mastra-rewrite` @ `0839422`
- **Date:** 2026-08-30
- **Prepared by:** claude-planner-2
- **State:** **Preparation only. The beta has not been executed and is not yet approved to start.**

This document is the checklist, scope, and procedure for an internal beta in the
test workspace. It does not record a beta run, because none has happened, and it
does not grant production approval.

## 1. Can the beta start?

**Not yet — one code blocker and one process gap.** Everything else is ready,
and more is ready than the dashboard suggests.

| Precondition | State |
|---|---|
| Slack app installed, scoped, and **a member of the beta channel** | **Ready** — verified 2026-08-30: `conversations.info` reports `is_member: true`, not private, not archived |
| Slack scopes for messages, DMs, and user lookup | **Ready** — `chat:write`, `users:read`, `im:*`, `channels:history` granted (B-05, B-06 resolved) |
| Provider credential | **Ready** — one `OPENAI_API_KEY` serves generation and embeddings (D012) |
| Socket Mode connect / reconnect against real Slack | **Ready** — T501 opt-in `T501_LIVE_SOCKET=1` passed; two sessions over one state |
| Real generation, grounded and cited | **Ready** — T501 opt-in live provider passed (AC-07, AC-08) |
| Runtime starts and fails closed | **Ready** — `npx tsc && node dist/src/index.js` starts; with no config it prints variable names only and exits 1 |
| Security review | **Conditional go** — [sign-off](../reports/security-review-signoff.md); zero high-severity outstanding |
| Deployment/backup/rollback procedure | **Ready as documentation** — [T504 runbook](../runbooks/deployment.md); rehearsals not performed |
| `npm run build` | **BROKEN — blocker B-08, see §4.1** |
| Performance and observability baseline (T503) | **Not started — see §4.2** |
| Historical corpus | **Absent by design for this beta — see §2** |

## 2. Beta scope

Scoped to what can actually be exercised now. Everything excluded is excluded
for a stated reason, not for convenience.

### In scope

| Behaviour | Why it can be tested |
|---|---|
| Addressed turns in the beta channel (`@Gist`) | App is in the channel; generation and Socket Mode verified live |
| Addressed turns by DM | `im:*` scopes granted; DM boundary isolation covered by AC-10 |
| Thread follow-ups without re-mention | Subscription path merged (T104/T405), AC-03 |
| Silent ambient ingestion of channel messages | T405 merged; AC-09 asserts zero generation and zero posts |
| Recall over messages posted **during the beta** | Ambient persistence + semantic recall merged; AC-07 |
| Edit and delete propagation | T404 merged; AC-14, F-17 fix verified end to end |
| Privacy boundaries — channel↔channel, channel↔DM, DM↔DM | AC-10, AC-11, plus the T502 review |
| Error behaviour and the single-reply rule | AC-15 |

### Out of scope, and why

| Excluded | Reason |
|---|---|
| **Historical recall over imported Slack archive** | T306/T307 are blocked on **B-03** — the legacy archive database path has not been provided. Nothing has been imported. See §3 for what this means for beta expectations |
| Production workspace or any real customer channel | Beta runs in the test workspace only |
| Multi-instance or failover operation | F-12: single instance is a correctness constraint, not a capacity choice ([runbook](../runbooks/deployment.md#single-instance-constraint)) |
| Cross-channel recall | D002/FR-PRV-002 — not a feature, and asserted absent |
| DM access to channel knowledge | D002 accepted default; `GIST_DM_SHARED_KNOWLEDGE` is typed `false` and cannot be enabled by configuration |
| Production go/no-go decision | Requires T503 and a completed beta observation window |

## 3. The expectation to set with beta users

**Gist will not know anything that happened before the beta starts.**

No historical archive has been imported (B-03), so its entire corpus is the
messages posted in the beta channel while it is running. Asked about an older
decision, it will correctly answer "I couldn't verify that from the available
evidence" (D009, FR-RSP-006).

This is correct behaviour, not a defect — but it is *indistinguishable from a
defect* to a user who has not been told, and it is the single most likely thing
to be reported as one. It must be in the beta invitation, in the operator's own
words, before the first message is sent.

A second, smaller expectation: under D002 a DM will not surface channel
knowledge. DM questions about channel history are expected to come back
unverified.

## 4. Blockers

### 4.1 B-08 — `npm run build` fails (new; introduced by the F-05 security fix)

```text
ERROR  Failed to analyze Mastra application:
       "mastra" is not exported by "src/mastra/index.ts"
```

**Cause, stated plainly:** the F-05 fix (SECFIX-B, `538ead1`) removed the
module-level `storage` / `mastra` singletons from `src/mastra/index.ts` and moved
construction inside `createFoundationRuntime`, because the import-time singleton
read `process.env` and created a database directory before `parseConfig()` had
validated anything — a defaulted start that D001 and FR-OPS-001 forbid. That was
the right fix for the security finding. It also broke the Mastra CLI, which
requires a module-scope `export const mastra`. I made that change; recording it
here rather than leaving T501's finding unattributed.

**Impact on the beta: low but not zero.**

- The documented production start path does **not** use `mastra build`. `npx tsc
  && node dist/src/index.js` compiles and starts correctly (verified again at
  `0839422`), so the beta runtime is deployable today.
- `mastra build`, `mastra dev`, and `mastra start` are unusable. `npm run build`
  in the T504 release-prep step will fail and must not be treated as a gate
  failure for the beta.

**Required fix (not in this task's write scope):** re-export a `mastra` instance
from `src/mastra/index.ts` in a way that does not reconstruct the F-05 defect —
a lazily-initialised export, or a separate CLI entry point that builds the
instance on demand. Do not restore the eager module-level singleton. Owner:
whoever holds `src/mastra/**` next; must land before T506, and the T504 runbook's
release-prep step should be corrected in the same change.

### 4.2 T503 never started — no launch thresholds exist

T505's acceptance criterion "metrics meet launch thresholds" cannot be evaluated,
because T503 (performance and observability validation) is `Planned` and no
thresholds have been defined. The beta can still be *observed* — §7 lists what to
record — but "meets thresholds" is not a judgement anyone can make yet.

**This is a dependency gap, not a defect.** T505 depends on T501, T502, T503,
T504; T503 has not been assigned.

### 4.3 Carried from elsewhere

| ID | Blocker | Effect on beta |
|---|---|---|
| B-03 | Legacy archive DB path not provided | No historical corpus. Drives §3 |
| B-07 | T406's live cases need a human message in the channel | The beta *is* the resolution: the first human message closes it. T406 should collect its evidence during the beta window |
| F-19 | Ambient messages dropped when one arrives in a thread while a turn is in flight | Accepted risk. Instrument the count during beta — that number decides the deferred fix (T502 sign-off §3.2) |

## 5. Pre-flight checklist

Run in order. Stop on any failure.

- [ ] Confirm the release commit and record it privately (not in Git).
- [ ] `npm ci` — pinned install.
- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — 569 passing at `0839422`.
- [ ] `npm run test:e2e` — acceptance suite.
- [ ] **Skip `npm run build`** — known failure B-08; use the compiled path below.
- [ ] `npx tsc` and confirm `dist/src/index.js` exists.
- [ ] Confirm `.env` / rendered environment carries all of `SLACK_BOT_TOKEN`,
      `SLACK_APP_TOKEN`, `GIST_APPROVED_WORKSPACE_ID`, `GIST_APPROVED_CHANNEL_IDS`,
      `GIST_MODEL`, `EMBEDDING_MODEL`, `OPENAI_API_KEY`, `MASTRA_DATABASE_URL`;
      `GIST_DM_SHARED_KNOWLEDGE` unset or `false`.
- [ ] Confirm `GIST_APPROVED_CHANNEL_IDS` contains **only** the beta channel.
- [ ] Confirm the database path is absolute, outside the repository, mode `0600`.
- [ ] Take a pre-beta backup per [backup-restore.md](../runbooks/backup-restore.md).
- [ ] Confirm no other Gist process is running: `pgrep -c -f 'dist/src/index\.js'` is 0.
- [ ] Confirm the legacy bot and cron are inactive.
- [ ] Send the beta invitation, including the §3 expectation.

## 6. Deployment procedure — test workspace

The full procedure is [deployment.md](../runbooks/deployment.md). For the beta,
the reduced form is:

```bash
# 1. From the release checkout
npm ci
npm run typecheck && npm test
npx tsc                       # emits dist/ ; npm run build is broken (B-08)

# 2. Start one process, with the environment loaded from the rendered file
node --env-file=<rendered-env-file> dist/src/index.js

# 3. Confirm exactly one instance
test "$(pgrep -c -f 'dist/src/index\.js')" -eq 1
```

For a supervised beta, prefer the systemd unit in
[`deploy/systemd/gist.service.in`](../../deploy/systemd/gist.service.in) with
`@T406_VALIDATED_START_COMMAND@` set to the absolute `node .../dist/src/index.js`
invocation. **One instance only** — see the
[single-instance constraint](../runbooks/deployment.md#single-instance-constraint).

Shut down with SIGTERM (`systemctl stop gist`, or Ctrl-C for a foreground run)
and confirm the process exits; the runtime closes Slack, drains memory work, and
closes the vector client on the way out.

## 7. Observation plan

Record continuously, in a private operator log. **No message text, no user names,
no channel IDs in anything committed.**

| Signal | Why | Source |
|---|---|---|
| Duplicate replies | FR-SLK-007; two replies to one message is a stop-the-beta event | Channel observation |
| Ambient generation calls | INV-6; an ambient message must never produce a reply or a model call | Model call count vs. addressed turn count |
| Privacy: any answer citing a channel or DM the asker is not in | The highest-severity failure class | Channel observation + citation check |
| Drops from the F-19 concurrency lock | The number that decides the deferred fix | Count ambient events accepted vs. persisted |
| Socket reconnects and restart count | AC-13, service stability | `systemctl show gist -p NRestarts`, logs |
| Recall quality on beta-window content | Whether grounding and citation hold on real text | User feedback |
| "I couldn't verify that" frequency | Expected to be high (§3); a *low* rate would be more surprising | User feedback |
| Latency and cost per addressed turn | Feeds T503 when it starts | Provider dashboard |
| Storage growth | Capacity planning | `df`, database size |

**Stop the beta immediately** on: any cross-boundary disclosure, any duplicate
reply, any ambient reply or ambient model call, or any storage-integrity error.
Follow [rollback.md](../runbooks/rollback.md). Do not restart through a privacy
or duplicate-response failure.

## 8. Exit criteria

The beta is complete when all of these hold:

- [ ] An agreed observation window has elapsed with the runtime continuously up.
- [ ] Zero cross-boundary disclosures, zero duplicate replies, zero ambient
      replies or ambient model calls.
- [ ] T406's live cases are collected and its report updated (closes B-07).
- [ ] The F-19 drop count is measured and recorded.
- [ ] Sanitized metric and incident summary written here.
- [ ] User feedback collected, with §3 expectation-setting accounted for.

**Before production (T506) — additional and not part of the beta window:**

- [ ] B-08 fixed and `npm run build` green.
- [ ] T503 started and launch thresholds defined and met.
- [ ] B-03 resolved, T306 and T307 executed, historical corpus imported and
      quality-gated.
- [ ] T504 restore and rollback rehearsals performed in non-production.
- [ ] Live cross-boundary validation run (T502 sign-off's open condition).
- [ ] F-19 disposition decided and recorded in `DECISIONS.md`.

## 9. Why T505 is not yet complete

T505's own acceptance criteria are "no critical/privacy incident", "metrics meet
launch thresholds", and "production approval is recorded". None can be satisfied
from preparation alone:

- The first requires a beta to have **run**.
- The second requires **T503**, which has not started (§4.2).
- The third requires the first two.

This document is therefore the preparation deliverable. T505 stays open until an
operator runs the window and its results are recorded here.

## 10. Beta run record

*Empty until the beta runs. Fill from the operator's private log, sanitized.*

```text
Release commit:            PENDING
Window start / end (UTC):  PENDING
Operator:                  PENDING
Addressed turns:           PENDING
Ambient messages ingested: PENDING
Ambient drops (F-19):      PENDING
Duplicate replies:         PENDING
Privacy incidents:         PENDING
Socket reconnects:         PENDING
Restarts:                  PENDING
Median / p95 reply latency: PENDING
Provider cost:             PENDING
Incidents:                 PENDING
Production recommendation: PENDING
```
