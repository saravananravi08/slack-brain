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

## Service inventory

Unit names are fixed by this runbook; hosts, accounts, and legacy unit names
come from the private operator inventory and are never committed.

| Service | Unit | Runs | Must be inactive when |
|---|---|---|---|
| Gist runtime | `gist.service` | The single Socket Mode process (`node dist/src/index.js`) | Any retention sweep, archive import, or restore is running |
| Legacy Slack bot | `<legacy-bot-unit>.service` | Old `bot.ts` runtime | **Always, once `gist` is active** — the unit `Conflicts=` with it |
| Legacy ingestion cron | `<legacy-cron-unit>.service` / timer | Old `cron.ts` ingestion | **Always, once `gist` is active** |
| Retention sweep | operator-run, not a unit | T404 message/vector purge | `gist` is active (see the single-instance constraint) |
| Archive import | operator-run, not a unit | `npm run import:slack` | `gist` is active |

There is deliberately no `gist@.service` template and no second instance. See
[Single-instance constraint](#single-instance-constraint).

## Secret inventory

Names, locations, and owners only. **No value from this table is ever written to
Git, a ticket, a log line, a command argument, or a shell history.**

| Secret | Held in | Rendered to | Readable by | Rotation |
|---|---|---|---|---|
| `SLACK_BOT_TOKEN` | Approved secret manager | `/etc/slack-brain/runtime.env` (0640) | Deployment owner; service account via group | On suspected disclosure, or app reinstall |
| `SLACK_APP_TOKEN` | Approved secret manager | same | same | Same; regenerating requires app-level token reissue |
| `OPENAI_API_KEY` | Approved secret manager | same | same | Per provider policy; **one key now serves generation and embeddings** (D012) |

Non-secret but environment-specific, and equally not committed:
`GIST_APPROVED_WORKSPACE_ID`, `GIST_APPROVED_CHANNEL_IDS`, `MASTRA_DATABASE_URL`.
Real workspace and channel IDs live in the operator inventory only (D001).

Rotation procedure: update the secret-manager record, re-render
`/etc/slack-brain/runtime.env`, `systemctl restart gist`, confirm one Socket
Mode connection, and record only the rotation time and operator. A Slack token
change requires app reinstallation first; see
[slack-dev-environment.md](./slack-dev-environment.md).

## Pending release gates

| Gate | Required evidence | State |
|---|---|---|
| T307 full import | Merged `docs/reports/full-import-summary.md`; reconciled counts; zero unapproved failures; rerun/idempotency result; usable pre-import backup reference | **PENDING T307** |
| T406 live ingestion | Merged `docs/reports/live-ingestion-validation.md`; approved root/reply/edit/delete/retry behavior; zero ambient generation/replies; recall/privacy result | **PENDING T406** |
| Production start command | Exact command that starts `src/index.ts`, holds one Socket Mode connection, exits non-zero on startup failure, and handles SIGTERM cleanly | **PARTIAL** — `npx tsc && node dist/src/index.js` verified to start and to exit non-zero on invalid config (see [Current runtime facts](#current-runtime-facts)). Socket Mode hold, reconnect, and SIGTERM behaviour still **PENDING T406** |
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

### The entry point must be compiled — verified 2026-08-30

`node --experimental-strip-types src/index.ts` **does not work** and must not be
put in a service unit. The sources use NodeNext `.js` specifiers, which
strip-types does not remap, so the process dies immediately:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/config.js'
  imported from .../src/index.ts
```

The working shape, verified from a clean compile:

```bash
npx tsc                      # emits dist/ ; typecheck alone uses --noEmit
node dist/src/index.js       # the Socket Mode entry
```

Started with no configuration, the compiled entry prints variable **names**
only and exits non-zero — the fail-closed startup FR-OPS-001 requires:

```text
Invalid configuration: EMBEDDING_MODEL, GIST_APPROVED_CHANNEL_IDS, ...
$? = 1
```

Two caveats before this becomes the approved command:

1. `tsconfig.json` includes `tests/**`, so a plain `npx tsc` emits `dist/tests`
   alongside `dist/src`. Only `dist/src` is needed at runtime. A build-time
   exclude belongs in a follow-up change (outside this task's write scope);
   until then the operator must be aware that test code is present in the
   release tree, and it must never be executed there.
2. This proves the process **starts and fails closed**. It does not prove the
   live Slack path, which is why the gate below stays open until T406.

Do not replace the pending service command with `npm start` or
`node .mastra/output/index.mjs` unless T406 proves that command starts and
validates the complete live-ingestion path.

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
- one host/process only — see [Single-instance constraint](#single-instance-constraint), which is a correctness requirement and not only a storage one.

## Single-instance constraint

**Gist runs as exactly one process. This is a correctness requirement, and
running two is a data-integrity fault, not a capacity decision.**

Three independent reasons, in increasing order of how quietly they fail:

1. **Slack Socket Mode.** Two connected runtimes both receive every event, so
   the same message is answered twice and ingested twice. This one is loud —
   users see duplicate replies — and is why §2 requires proving the legacy
   runtime is stopped before starting the new one.
2. **The database is a local file.** `MASTRA_DATABASE_URL` is an absolute
   `file:` URL. A second process on another host has its own store; a second
   process on the same host contends for the same SQLite file. Neither is a
   supported configuration.
3. **Mutation serialization is in-process only** — finding **F-12** in the
   security design review, accepted as a risk on the condition that this
   constraint is written down and honoured (T502 sign-off §3.1).
   `MastraMutationStorage` serialises edits and deletes through an in-memory
   lock (`#exclusive`). It holds within one Node process and has no meaning
   across processes. Two runtimes editing or deleting the same message can
   interleave a row write with a vector write, leaving a message whose stored
   text and its embedding disagree — the row says one thing and semantic recall
   surfaces another.

Failure mode 3 is the dangerous one because **it is silent**. There is no error,
no duplicate reply, and nothing in the logs; the corpus simply becomes
inconsistent, and the inconsistency is only visible if someone compares a
message against what recall returns for it. `reconcileTombstones()` repairs an
*interrupted* mutation, not an *interleaved* one — it cannot tell which of two
concurrent writers was correct.

### Operating rules

- Exactly one `gist` service, on exactly one host, at any time.
- Never run `systemctl start gist` on a second host "to test", and never run a
  second copy from a release directory by hand while the service is active.
- Retention sweeps, archive imports, and any other tool that writes to the store
  must not run while the service is active. They are separate processes and the
  lock does not span them. Stop the service, run the job, restart.
- The systemd unit must not be templated (`gist@.service`) or given
  `Restart=always` semantics that could overlap an old and new process. The
  supplied unit uses `Type=simple` with `Restart=on-failure` and
  `StartLimitBurst=3` deliberately.

### Before scaling out

If the deployment ever needs more than one instance — horizontal scaling, an
active/standby pair, or a separate worker for ingestion — **F-12 must be
reopened before that change ships**, not after. Minimum required:

1. Move mutation serialization to a lock the store itself enforces (the state
   adapter's lock, or a database-level transaction), not an in-memory one.
2. Move `MASTRA_DATABASE_URL` to a managed store that supports concurrent
   writers.
3. Ensure exactly one instance holds the Socket Mode connection, or move event
   intake behind a queue.
4. Re-run the T502 security review items that assume a single writer.

Owner: T506 if production topology changes; otherwise the security owner at the
next review.

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
| `GIST_MODEL` | `gpt-4.1` (D012), or the pre-approved step-down `gpt-4.1-mini`. No other value is accepted |
| `EMBEDDING_MODEL` | Literal `openai/text-embedding-3-small` |
| `OPENAI_API_KEY` | **Single provider credential — serves both generation and embeddings** under no-training/bounded-retention terms (D012 superseded D007; there is no Anthropic credential) |
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

### Health checks available today

These run without T406 and should be part of every start and every window check.
None prints message content.

```bash
# 1. Liveness: active, and exactly one main process.
sudo systemctl is-active --quiet gist
sudo systemctl show gist -p MainPID -p NRestarts

# 2. Single instance: exactly one matching runtime process on this host.
test "$(pgrep -c -f 'dist/src/index\.js')" -eq 1

# 3. No legacy runtime is connected.
systemctl is-active '<legacy-bot-unit>' '<legacy-cron-unit>'   # expect inactive

# 4. Restart storm: NRestarts must not climb between two checks a minute apart.
#    A climbing count means the process is failing closed and re-launching —
#    read the class-level log, do not restart through it.

# 5. Storage reachable and correctly owned, without reading contents.
sudo test -O /var/lib/slack-brain/mastra.db
sudo test "$(stat -c '%a' /var/lib/slack-brain/mastra.db)" = 600

# 6. Disk headroom for the store and 35 days of backups.
df -h /var/lib/slack-brain /var/backups/slack-brain
```

Check 2 is the one that catches the failure the
[single-instance constraint](#single-instance-constraint) describes, and it is
the only check here that catches it. Run it after every start and before every
manually run sweep or import.

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
