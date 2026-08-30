# Gist deployment runbook

> **EARLY DRAFT — NOT CUTOVER-APPROVED.** T307 full-import evidence and T406 live-ingestion validation are pending. Do not deploy beta/production from this draft, render the service template, or mark T504 ready until every pending gate below is filled from merged task evidence.

Deploy Gist as one continuously running Socket Mode process with one file-backed libSQL database. This procedure never prints credentials, Slack IDs, database contents, traces, or message text.

Related procedures:

- [Backup and restore](./backup-restore.md)
- [Rollback](./rollback.md)
- [Archive import](./archive-import.md)
- [Slack environment](./slack-dev-environment.md)

## Owners and change record

Fill these in the private operator change record, not Git:

- change owner and backup operator;
- incident/security escalation contacts;
- target environment and maintenance window;
- approved release commit and previous release commit;
- secret-manager record reference;
- persistent database and backup locations;
- approved workspace/channel inventory reference;
- legacy bot/cron service names;
- backup ID and digest;
- T307 and T406 report references.

Never place real IDs, paths containing private names, credentials, or report contents in a commit or ticket.

## Pending release gates

| Gate | Required evidence | State |
|---|---|---|
| T307 full import | Merged `docs/reports/full-import-summary.md`; reconciled counts; zero unapproved failures; rerun/idempotency result; usable pre-import backup reference | **PENDING T307** |
| T406 live ingestion | Merged `docs/reports/live-ingestion-validation.md`; approved root/reply/edit/delete/retry behavior; zero ambient generation/replies; recall/privacy result | **PENDING T406** |
| Production start command | Exact command that starts `src/index.ts`, holds one Socket Mode connection, exits non-zero on startup failure, and handles SIGTERM cleanly | **PENDING T406** |
| Retention commands/jobs | Integrated T404 message/vector sweep, trace prune, 14-day log policy, and 35-day backup rotation | **PENDING integration/host rehearsal** |
| Restore rehearsal | Sanitized rehearsal record from [backup-restore.md](./backup-restore.md) | **PENDING T307/T406 inputs** |
| Rollback rehearsal | Sanitized rehearsal record from [rollback.md](./rollback.md) | **PENDING T307/T406 inputs** |

Stop if any gate is absent, failed, unmerged, or refers only to another task branch.

## Current runtime facts

- `src/index.ts` is the standalone lifecycle entry: it validates config, starts the Slack channel, and installs SIGINT/SIGTERM shutdown handlers.
- Shutdown stops Slack, waits for memory work, closes the libSQL vector client, then shuts down Mastra.
- `npm run build` currently emits a Mastra HTTP/server bundle. It does **not** prove that Socket Mode starts.
- `npm start` currently runs `mastra start`; it is not an approved production Slack-runtime command.
- No HTTP health endpoint is defined for the standalone Socket Mode runtime.

Do not replace the pending service command with `npm start` or `node .mastra/output/index.mjs` unless T406 proves that command starts and validates the complete live-ingestion path.

## Host layout

Use a dedicated non-login service account and paths outside Git:

```text
/opt/slack-brain/releases/<release-commit>/   immutable release checkout
/opt/slack-brain/current -> releases/<release-commit>
/etc/slack-brain/runtime.env                  secret-manager rendered, mode 0640
/var/lib/slack-brain/mastra.db                message/vector/trace store, mode 0600
/var/backups/slack-brain/                     encrypted/restricted backups, mode 0700
```

Required controls:

- release tree owned by the deployment owner and read-only to service account;
- `/etc/slack-brain/runtime.env` owned by `root:<service-group>`, mode `0640`;
- state and backup directories owned by service account, mode `0700`;
- database and backup files mode `0600`;
- no database, backup, `.env`, trace, report, or secret under the release/Git tree;
- one host/process only; current config accepts an absolute local `file:` database URL, not a multi-instance managed store.

## Configuration checklist

Populate values through the approved secret manager. Enter values in an editor or secret-manager UI, never as command arguments.

| Variable | Requirement |
|---|---|
| `SLACK_BOT_TOKEN` | Current bot installation credential |
| `SLACK_APP_TOKEN` | Current app-level Socket Mode credential |
| `GIST_APPROVED_WORKSPACE_ID` | Exactly the approved workspace |
| `GIST_APPROVED_CHANNEL_IDS` | Non-empty comma-separated approved channel IDs |
| `GIST_USER_ALLOWLIST` | Empty for accepted beta posture; production safe default requires security-owner decision |
| `GIST_DM_SHARED_KNOWLEDGE` | Literal `false`; do not override |
| `GIST_MODEL` | Accepted pinned model ID |
| `ANTHROPIC_API_KEY` | Provider credential under no-training/bounded-retention terms |
| `EMBEDDING_MODEL` | Literal `openai/text-embedding-3-small` |
| `OPENAI_API_KEY` | Embedding-provider credential |
| `MASTRA_DATABASE_URL` | Absolute `file:` URL outside repository, e.g. `file:///var/lib/slack-brain/mastra.db` |

Validate file metadata without printing contents:

```bash
sudo test "$(stat -c '%a' /etc/slack-brain/runtime.env)" = 640
sudo test "$(stat -c '%a' /var/lib/slack-brain)" = 700
sudo test "$(stat -c '%a' /var/backups/slack-brain)" = 700
```

A missing, empty, malformed, relative, or in-repository value must fail startup. Never add a fallback.

## 1. Prepare release

1. Confirm all pending gates above are complete and merged.
2. Confirm product, technical, security, and change owners approved the window.
3. Confirm host capacity, clock sync, outbound Slack/provider connectivity, restricted storage, and 35-day backup capacity.
4. Check out the approved commit into a new immutable release directory.
5. From that directory, install pinned dependencies and run checks:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

6. Scan staged/release-controlled files for credentials. Do not scan or print the external environment file.
7. Record only pass/fail, commit hash, and artifact digest in the private change record.

The build output is a verification artifact until T406 confirms the production command. Do not infer the service command from CLI build output.

## 2. Back up and establish single ownership

1. Follow [backup-restore.md](./backup-restore.md) to create and verify a pre-cutover backup.
2. Stop the legacy bot and legacy cron using their operator-inventory service names.
3. Disable automatic restart for both legacy services during the window.
4. Confirm no legacy or new process holds a Socket Mode connection:

```bash
systemctl is-active '<legacy-bot-unit>' '<legacy-cron-unit>' gist
pgrep -a -f 'slack-brain|bot\.ts|cron\.ts|src/index\.ts'
```

Expected before new start: all named services inactive and no matching runtime process. Review matches manually; do not use broad `pkill`.

If the old runtime cannot be proven stopped, abort. Two runtimes can duplicate replies, writes, and mutations.

## 3. Render service configuration

`deploy/systemd/gist.service.in` is intentionally non-runnable. Copy it outside Git, replace every `@...@` field with approved host values, and set `@T406_VALIDATED_START_COMMAND@` to the exact merged T406 command.

Before installation:

```bash
if rg -n '@[A-Z0-9_]+@' /tmp/gist.service; then
  echo 'Unresolved service-template fields.' >&2
  exit 1
fi
sudo systemd-analyze verify /tmp/gist.service
```

Install only after both commands pass:

```bash
sudo install -o root -g root -m 0644 /tmp/gist.service /etc/systemd/system/gist.service
sudo systemctl daemon-reload
```

The final unit must conflict with the real legacy bot/cron units. Never remove those conflicts to work around a start failure.

## 4. Start and validate

1. Point `/opt/slack-brain/current` atomically at the approved release.
2. Start one service:

```bash
sudo systemctl start gist
sudo systemctl is-active --quiet gist
sudo systemctl show gist -p MainPID -p NRestarts -p ActiveEnterTimestamp
```

3. Review bounded service logs by time and class. Do not paste logs into tickets; application logs must not contain message bodies or tokens.
4. Run the exact sanitized T406 health checks. At minimum they must prove:
   - one Socket Mode connection and reconnect;
   - one expected response to a synthetic addressed event;
   - zero ambient responses/model calls;
   - ambient root/reply persistence;
   - edit re-embedding and delete removal;
   - denied/bot/retry exclusion;
   - later recall with correct boundary/citation.
5. Confirm only one runtime PID and that legacy units remain inactive.

Until T406 defines the final readiness probe, `systemctl is-active` is liveness only, not readiness. Absence of an HTTP endpoint is not permission to skip Slack-path validation.

## 5. Retention operations

A production deployment is incomplete until operators have executable, merged commands/jobs for every D004 tier:

| Data | Required operation | Draft state |
|---|---|---|
| Approved-channel messages/embeddings | Keep while approved; after allowlist removal, purge through T404 delete primitive within 30 days | **PENDING integrated operator command** |
| DM messages/embeddings | Run T404 rolling purge at 90 days | **PENDING integrated operator command** |
| Mastra traces | Invoke supported storage prune at least daily; verify no trace older than 30 days | **PENDING integrated operator command** |
| Application logs | Configure host journal/log sink to delete after 14 days and exclude bodies/tokens | **PENDING host configuration/rehearsal** |
| Backups | Run reviewed 35-day rotation from `backup-restore.md` | Drafted; rehearsal pending |

Do not substitute raw SQL for message/vector deletion. Restores must run message, vector, tombstone, and trace reconciliation before service resumes because old backups can reintroduce purged data. Record aggregate counts and completion time only.

## 6. Observe and close

Monitor during the approved window:

- service state, restart count, Socket reconnects, and event failures;
- accepted/skipped/denied counts without message bodies;
- duplicate delivery/reply count;
- storage/vector failures and disk capacity;
- model/embedding errors, latency, and cost;
- retrieval/privacy validation result.

Rollback immediately on any trigger in [rollback.md](./rollback.md). Do not repeatedly restart through a privacy, duplicate-response, or storage-integrity failure.

After a successful window:

1. Keep legacy code, legacy database, source archive, previous Mastra release, and verified backups unchanged through the approved rollback window.
2. Keep backup rotation at 35 days.
3. Keep application logs 14 days and traces 30 days with operator-restricted access.
4. Record sanitized result and owners privately.
5. Do not delete legacy infrastructure; T508 requires explicit rollback-window approval.

## Pending evidence template

Replace only from merged, sanitized reports:

```text
T307 merge/report: PENDING
Full-import reconciliation: PENDING
Pre-import backup verified: PENDING
T406 merge/report: PENDING
Validated start command: PENDING
Socket reconnect/live ingestion/privacy result: PENDING
Deployment rehearsal UTC/operator/environment: PENDING
Deployment rehearsal result: PENDING
```
