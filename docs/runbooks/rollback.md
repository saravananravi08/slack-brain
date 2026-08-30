# Gist rollback runbook

> **EARLY DRAFT — REHEARSAL PENDING.** Legacy service names, T307 storage evidence, T406 validation commands, and non-production rehearsal results are not yet available. Keep this branch open and do not use it as cutover approval.

Rollback has one invariant: **old and new Slack runtimes are never active together**. Both can receive the same addressed events and create duplicate replies/writes. Stop and prove the active runtime is down before starting its replacement.

## Rollback owners and assets

Keep these in the private operator inventory:

- incident commander, runtime operator, security owner, and communications owner;
- new/previous release commits and service unit names;
- legacy bot and cron service names;
- new Mastra database, previous Mastra backup, legacy database, and immutable archive references;
- secret-manager versions for each runtime;
- T307 and T406 report references;
- rollback start/end time and sanitized outcome.

Keep old code, old database, source archive, previous release, and verified backups unchanged through the approved rollback window. T508 alone removes them after explicit approval.

## Immediate rollback triggers

Stop Gist and escalate without repeated restart attempts when any occurs:

- unauthorized channel/DM content is stored or retrieved;
- deleted text or stale embedding remains recallable;
- ambient events trigger a model call or Slack reply;
- duplicate replies, duplicate runtime PIDs, or competing Socket Mode connections appear;
- import counts/reconciliation differ from approved T307 evidence;
- message/vector storage is partial, corrupt, unavailable, or outside approved path;
- startup validation is bypassed or wrong workspace/channel policy loads;
- Socket Mode cannot connect/reconnect according to T406 threshold;
- provider/model/embedding configuration differs from accepted decisions;
- restore retention reconciliation cannot prove purged content remains purged;
- operator cannot determine which runtime owns Slack events.

For a suspected privacy leak, stop first, preserve restricted evidence, notify security owner, and do not paste payloads or message text into logs/tickets.

## 1. Contain

1. Announce maintenance through the approved private channel without including content or credentials.
2. Stop and disable new Gist:

```bash
sudo systemctl stop gist
sudo systemctl disable gist
sudo systemctl is-active --quiet gist && {
  echo 'New runtime still active.' >&2
  exit 1
} || true
```

3. Confirm no new runtime remains:

```bash
systemctl show gist -p MainPID -p NRestarts -p ActiveState
pgrep -a -f 'src/index\.ts|slack-brain'
```

Review every match. Do not start a replacement while any unknown Gist process remains.

4. Preserve bounded service diagnostics and the failed database according to restricted incident policy. Never copy message bodies, traces, database files, tokens, or raw Slack events into Git or ordinary tickets.
5. If storage integrity is uncertain, take a cold failed-state backup using [backup-restore.md](./backup-restore.md).

## 2. Choose rollback target

### A. Previous Mastra release

Use only when failure is a code/config deployment issue and the previous release is approved against the current storage schema.

1. Keep all Slack runtimes stopped.
2. Restore the pre-cutover database if the failed release may have changed messages, vectors, tombstones, or schema. Follow [backup-restore.md](./backup-restore.md); never mix code rollback with an unreviewed newer database.
3. Atomically repoint `/opt/slack-brain/current` to the previous immutable release.
4. Restore the matching approved service config and secret-manager version without printing values.
5. Run the **PENDING integrated** retention/deletion sweep and trace prune before start.
6. Start one `gist` service.
7. Run the **PENDING T406** startup/reconnect, addressed-response, ambient-silence, mutation, recall, and privacy checks.
8. Stop again if any check fails. Do not fall through automatically to legacy runtime without another explicit ownership check.

### B. Legacy runtime

Use when Mastra/runtime/storage behavior is not safe or cannot be restored promptly.

1. Confirm `gist` is stopped/disabled and has no PID/Socket connection.
2. Confirm legacy code and legacy database/archive are the preserved pre-cutover versions.
3. Confirm old credentials are valid and belong to the approved Slack app/workspace. Never activate a second app installation to avoid a credential issue.
4. Start the legacy bot service **only**:

```bash
sudo systemctl start '<legacy-bot-unit>'
sudo systemctl is-active --quiet '<legacy-bot-unit>'
```

5. Start legacy cron only if the approved rollback plan requires it and its archive remains authoritative:

```bash
sudo systemctl start '<legacy-cron-unit>'
sudo systemctl is-active --quiet '<legacy-cron-unit>'
```

6. Confirm new Gist remains inactive, exactly one bot process exists, and one synthetic addressed event gets one expected reply.
7. Monitor legacy storage writes and service restarts.

Legacy rollback does not make Mastra writes authoritative. Before a later return to Mastra, reconcile the incident window under an approved import/live-ingestion plan.

## 3. Known deletion gap

Slack does not replay deletions that occurred while Gist was offline or before archive import. A user-visible stale message after downtime may therefore remain in memory even though ordinary online deletes hard-delete message and embedding.

Mitigation:

1. Keep serving stopped if stale content may cross a privacy boundary.
2. Ask the Slack user to re-delete only when appropriate, or have an authorized operator run the merged deletion/purge path by message identity.
3. Re-run retention/deletion reconciliation and retrieval privacy checks.
4. Record only content-free IDs/reason counts in restricted tooling; never original text.

Do not inspect or preserve deleted text as an audit tombstone. Tombstones are content-free.

## 4. Validate rollback

The validated command set is **PENDING T406**. At minimum record sanitized pass/fail for:

- one active runtime and one Socket Mode owner;
- addressed DM/mention final reply count;
- reconnect and restart behavior;
- no ambient generation/reply;
- approved-channel persistence or expected legacy behavior;
- denied/external/guest/bot exclusion;
- storage/retrieval integrity;
- deleted/stale content not recallable;
- service restart count and error class counts.

If rolling back to a restored Mastra backup, retention/deletion reconciliation is mandatory before any Slack-facing check.

## 5. Stabilize and recover forward

1. Keep the failed release, database, report references, and diagnostics restricted and unchanged until incident review.
2. Rotate credentials immediately if disclosure is suspected; removing a value from config is not revocation.
3. Keep 35-day backup rotation unless an approved incident/legal hold applies.
4. Define a forward-fix owner and require the same deployment gates before retry.
5. Do not delete legacy assets or re-enable both runtimes.
6. Record a sanitized timeline, trigger, target, result, and follow-up owner outside Git.

## Rollback rehearsal

Use the isolated non-production Slack environment and synthetic content only:

1. Start the candidate new runtime with a restored rehearsal database.
2. Verify one active process and a synthetic T406 smoke pass.
3. Stop new runtime and prove no PID/connection remains.
4. Start the designated rehearsal legacy or previous-Mastra target.
5. Verify exactly one response and correct state ownership.
6. Stop rollback target, restore new runtime state as approved, and repeat ownership check.
7. Remove rehearsal data under sensitive-data policy.

Evidence template:

```text
Rehearsal UTC: PENDING
Operator/reviewer: PENDING
T307 storage/backup reference: PENDING
T406 validation command/report: PENDING
New runtime stop and zero-owner proof: PENDING
Rollback target and start result: PENDING
Single-response/single-owner result: PENDING
State/retrieval/privacy result: PENDING
Return-forward result: PENDING
Overall rollback rehearsal: PENDING
```
