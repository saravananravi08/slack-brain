# Gist operator handover

- **Task:** [T507](../implementation/tasks/T507-HANDOVER.md)
- **Written at:** `integration/mastra-rewrite` @ `956393c`
- **Audience:** the operator on call for Gist, without access to the people who built it.

Companion document: [developer guide](../development/guide.md).
Procedures referenced here live in [`docs/runbooks/`](../runbooks/) and are not
duplicated — this document tells you *when* and *why*; the runbooks tell you
*how*.

## 1. What Gist is, in one screen

One continuously running process, holding one Slack Socket Mode connection,
backed by one local libSQL database file.

**It does three things:**

1. Answers when addressed — a DM, an `@Gist` mention, or a follow-up in a thread
   it has joined. Answers are grounded in stored Slack messages and cite sender
   and date.
2. Silently stores ordinary messages in approved channels, so it has something
   to cite later. **This path never replies and never calls the model.**
3. Follows edits and deletes — an edited message is re-embedded, a deleted one is
   removed along with its embedding.

**It never:**

- speaks in a channel that is not on the approved list;
- lets one channel's content answer a question in another channel;
- lets a DM see channel knowledge, or one person see another's DMs;
- answers external, guest, or deactivated users;
- writes message text, user names, or tokens to the application log.

If you observe Gist doing any of those, that is a **stop-the-service incident**
— see §7.

## 2. Ownership and escalation

Fill these in your private operator record, not in Git.

| Role | Responsibility |
|---|---|
| Service owner | Day-to-day operation, deploys, this document |
| Backup operator | Cover during absence; must have completed a handover walkthrough |
| Security owner | Privacy incidents, authorization policy, D002/D006 changes |
| Product owner | Channel allowlist changes, beta/production go-no-go |
| Slack workspace admin | App installation, scopes, channel membership |

**Escalate immediately, before investigating**, on any privacy incident (§7).
Everything else follows normal on-call.

## 3. Configuration

All values come from the approved secret manager and are rendered into the
environment file the service reads. Never a command argument, never a ticket,
never Git. Full inventory: [deployment runbook](../runbooks/deployment.md).

| Variable | What it controls | Getting it wrong means |
|---|---|---|
| `SLACK_BOT_TOKEN` | Bot identity | Service cannot connect or post |
| `SLACK_APP_TOKEN` | Socket Mode connection | Service cannot receive events |
| `GIST_APPROVED_WORKSPACE_ID` | The one approved workspace | Every event denied |
| `GIST_APPROVED_CHANNEL_IDS` | **The privacy boundary.** Comma-separated, never empty | Too wide = Gist ingests and answers from channels nobody approved |
| `GIST_USER_ALLOWLIST` | Empty = all full members (D006) | Non-empty silently denies everyone not listed |
| `GIST_DM_SHARED_KNOWLEDGE` | Must be `false` (D002) | Config rejects any other value; the service will not start |
| `GIST_MODEL` | `gpt-4.1`, or `gpt-4.1-mini` | Any other value fails startup |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Changing it invalidates every stored embedding |
| `OPENAI_API_KEY` | Generation **and** embeddings (D012) | No answers and no ingestion |
| `MASTRA_DATABASE_URL` | Absolute `file:` path outside the repo | Data in the wrong place, or startup failure |

**Configuration failures are loud by design.** An invalid or missing value makes
the process print the offending variable *names* and exit non-zero. It never
starts with a defaulted or partial policy. If the service will not start, read
that line first — it usually is the whole answer.

**Changing the channel allowlist is a privacy decision, not a config tweak.**
Adding a channel means Gist begins ingesting it. Removing one starts a 30-day
purge clock (D004) — and the sweep only counts that clock from a recorded
removal timestamp, so record it when you make the change (see §5).

## 4. Routine operations

| When | Task | How |
|---|---|---|
| Every deploy | Full deployment procedure | [deployment.md](../runbooks/deployment.md) |
| Every deploy | Confirm exactly one instance | `test "$(pgrep -c -f 'dist/src/index\.js')" -eq 1` |
| Daily | Service state, restart count, reconnects | `systemctl show gist -p NRestarts -p ActiveEnterTimestamp` |
| Daily | Trace prune (30-day retention, D004) | Storage prune; verify nothing older than 30 days |
| Daily | Backup | [backup-restore.md](../runbooks/backup-restore.md) |
| Weekly | Disk headroom for store and backups | `df -h` on both paths |
| Weekly | Review accepted/denied/skip counts for anomalies | Application log, reason codes only |
| Monthly | DM retention sweep (90 days, D004) | T404 sweep |
| Monthly | Backup rotation (35 days) | [backup-restore.md](../runbooks/backup-restore.md) |
| On allowlist change | Record the channel removal timestamp | §3, §5 |
| On credential rotation | Re-render env, restart, confirm one connection | [deployment.md](../runbooks/deployment.md) |

**Before any maintenance job that writes to the store — retention sweep, archive
import, restore — stop the service.** Mutation serialization is in-process only,
so a job running alongside the live service is an unserialized second writer.
See the [single-instance constraint](../runbooks/deployment.md#single-instance-constraint).

## 5. Monitoring

Watch these. None requires reading message content, and none should be pasted
into a ticket.

| Signal | Healthy | Investigate when |
|---|---|---|
| Service active, one PID | Continuously up | Any restart you did not cause |
| `NRestarts` | Stable | Climbing — the process is failing closed and relaunching; read the log class, do not restart through it |
| Socket reconnects | Occasional | Frequent — network or token problem |
| Replies per addressed message | Exactly 1 | 0 (see §6) or 2+ (**stop the service**) |
| Model calls on ambient messages | 0 | Anything above 0 (**stop the service**) |
| Ambient accepted vs persisted | Equal | A gap means messages are being dropped — see §8 |
| `ingestion.delivery_context.missing` warnings | Absent | Present — envelope capture has broken; ingestion is silently stopping |
| Storage/vector errors | Absent | Any occurrence |
| Disk | Headroom for 35 days of backups | Under 20% free |
| Provider latency and cost | Within your baseline | Sustained deviation |

The T503 baseline for comparison: semantic recall p95 ≈ 5 ms, ambient
persistence ≈ 20 events/s serialized, real provider first-content p50 ≈ 900 ms
([performance report](../reports/performance-observability.md)). These are
workstation numbers — establish your own on the production host.

## 6. Troubleshooting

Symptom first, because that is what you will have.

### Gist says nothing at all when mentioned

Silence is a deliberate response to several denials — Gist does not announce that
it is ignoring you. Work down this list:

1. **Is the service running, and only once?** `systemctl is-active gist`,
   `pgrep -c -f 'dist/src/index\.js'`.
2. **Is the app still in the channel?** A removed app receives nothing.
3. **Is the channel on `GIST_APPROVED_CHANNEL_IDS`?** An unapproved channel is
   denied silently and deliberately — replying would confirm Gist is present.
4. **Was the sender a bot, an app, or Slackbot?** Non-human senders are ignored.
5. **Is the workspace the approved one?** Denied silently.
6. Check the log for a `security.authorize.denied` entry and its reason code.

### Gist replies "I can't help with that here."

That is the single authorization message, and it never explains why — by design,
so it cannot be used to probe the policy. The reason is in the log as a code.
Expect one of: `external_user`, `guest_user`, `deactivated_user`,
`not_in_allowlist`. Slack Connect and guest users are denied by policy (D006);
this is correct behaviour, not a fault.

### Gist replies "I couldn't verify that from the available evidence."

It has no stored evidence for the question. **Usually correct, not a fault.**
Common causes, in order of likelihood:

1. The message predates whatever Gist has ingested. If no historical archive has
   been imported (see §8), everything before the service started is unknown.
2. The question is about a different channel — cross-channel recall does not
   exist (D002/FR-PRV-002).
3. The question was asked in a DM about channel content — DMs see private
   conversation memory only (D002).

### Gist replies "I couldn't get to my notes just now."

Storage or retrieval failed. Check disk, database file permissions
(`0600`, owned by the service account), and storage errors in the log. **Note
that this is the correct behaviour** — Gist reports a failed search rather than
answering as though history were searched and empty.

### Gist replies "Something went wrong on my end."

Internal or malformed-event failure. Check the log for the error class. No user
ever sees the underlying error, which is deliberate.

### The service will not start

Read the first line of output. `Invalid configuration: <NAMES>` lists the
variables that failed validation — and only their names. Fix those. The service
deliberately refuses to start on a partial or defaulted configuration.

### Messages are missing from recall

1. Was the sender human? Bot, app, and system messages are never ingested.
2. Was the message empty, or a join/leave/topic-change? Those are skipped.
3. Did it arrive in a thread while Gist was answering in that same thread? Then
   it was dropped — see §8, known limitation F-19.
4. Was it in an approved channel? Ambient ingestion is channel-only; DM content
   is never stored as channel knowledge.

### A deleted message still shows up in an answer

**Treat as a privacy incident (§7).** Deletion is supposed to remove both the
message row and its embedding, and both copies of the message. If a deleted
message is being cited, stop the service and escalate to the security owner.

### Gist replied twice, or replied to a message nobody addressed to it

**Stop the service immediately (§7).** Two replies almost always means two
runtimes are connected. An ambient reply is an INV-6 violation.

## 7. Incidents

**Stop the service and escalate before investigating** on any of:

- an answer citing a channel or DM the asker is not entitled to;
- a deleted message appearing in an answer;
- two replies to one message;
- any reply or model call on an ordinary, unaddressed message;
- a storage-integrity error.

```bash
sudo systemctl stop gist
sudo systemctl is-active gist     # confirm inactive
pgrep -a -f 'dist/src/index\.js'  # confirm no process remains
```

Then follow [rollback.md](../runbooks/rollback.md). **Do not restart through a
privacy, duplicate-reply, or storage-integrity failure** — a restart will not fix
any of them and may make the corpus worse.

For anything less severe, the ordinary loop applies: read the log by class,
check the health checks in [deployment.md](../runbooks/deployment.md), and
escalate if the cause is not obvious within your on-call window.

## 8. Known limitations

Real, current, and deliberately visible. None is a defect to report — each is a
known state with an owner.

### No historical archive has been imported (B-03)

T306 and T307 are blocked: the legacy Slack archive database path has never been
provided. **Gist's corpus is only what it has ingested since it started
running.** Historical questions correctly return "I couldn't verify that".

This is the single most likely thing to be reported as a bug. Anyone onboarding
users must tell them first. Owner: product owner / operator, to supply a
read-only path to the archived database.

### Ambient messages can be dropped in an active thread (F-19)

If a message arrives in a thread while Gist is generating an answer *in that same
thread*, it is dropped before ingestion and never stored. The scope is one active
thread, not the channel.

The behaviour is pinned by test and accepted as a known risk; the fix is deferred
because it is a design decision about whether ingestion should share the reply
path's concurrency control. **Count how often it happens** — that number decides
the fix. Owner: security/product review at T505 or T506.

### Concurrent ingestion can fail under load (T503)

A four-worker trial produced at least one `persistence_failed` after retries.
Supported serialized throughput is about 20 events/s. Ordinary Slack traffic is
far below that; a burst is the risk. Owner: `src/ingestion/**` maintainer, per
the [performance report](../reports/performance-observability.md).

### Traces cannot be correlated to Slack events (T503)

The agent is invoked without a Slack-derived run ID, so a trace cannot be tied
back to the event that caused it. This makes deep debugging harder than it should
be — you can see *that* something failed, not always *which* Slack event it was.
Owner: `src/mastra/**` maintainer.

### Single instance only (F-12)

Not a capacity choice — a correctness constraint. Two processes can corrupt the
store silently. Fully explained in the
[single-instance constraint](../runbooks/deployment.md#single-instance-constraint);
read it before any scaling conversation.

### Live cross-boundary validation has not been performed

Every privacy guarantee is backed by offline evidence against synthetic fixtures.
No real Slack message has traversed the system in a cross-boundary test. This is
the open condition on the
[security sign-off](../reports/security-review-signoff.md), and it should be
closed during the first beta window.

## 9. Handover acceptance

Sign off in the private operator record once the incoming operator has, without
assistance:

- [ ] Deployed to a non-production target from [deployment.md](../runbooks/deployment.md).
- [ ] Taken and verified a backup, and restored it to a non-production target.
- [ ] Rehearsed a rollback.
- [ ] Started the service with a deliberately invalid configuration and read the
      failure correctly.
- [ ] Located a denial reason code in the log and explained which policy caused it.
- [ ] Named the stop-the-service incidents from §7 without looking.
- [ ] Explained the §8 limitations to a non-technical stakeholder.

Until the beta has run, items 1–3 are rehearsals in a non-production
environment; that is sufficient for handover, but not for production cutover.
