# Gist backup and restore runbook

> **EARLY DRAFT — REHEARSAL PENDING.** Do not claim restore readiness until T307 identifies production-target database/backup evidence, the integrated runtime exposes supported retention/prune commands, T406 supplies post-restore validation, and a non-production rehearsal succeeds.

The current single-process runtime stores Mastra messages, vectors, channel state, tombstones, and traces in one file-backed libSQL database. Backups therefore contain Slack content and derived embeddings. Treat every backup as sensitive production data.

## Policy

- Back up before full archive import and before every beta/production cutover.
- Keep rotating persistent-storage backups for **35 days** (D004).
- Keep database, sidecars, backup archives, checksums, and restore staging outside Git with operator-only access.
- Encrypt backup storage using the organization-approved mechanism and restrict restore permission to operators.
- Never back up a live local database by copying only its main file. Stop Gist cleanly first so Socket Mode, memory work, vector writes, and storage handles close.
- The stop is not only about file handles. Mutation serialization is in-process
  (finding F-12; see the deployment runbook's single-instance constraint), so
  any tool that writes to the store while the service is running is an
  unserialized second writer. Stop the service, run the job, restart.
- Restoring a backup may reintroduce messages/embeddings already removed by edit/delete or retention. Run the merged, T406-validated retention/deletion reconciliation before reopening service.
- Legal/HR hold policy is pending security-owner confirmation. Accepted safe default remains 35-day backup rotation; do not silently extend it.

## Private inventory

Record outside Git:

- operator and approver;
- environment and release commit;
- source database path and owning service;
- backup ID, creation time, size, encryption state, and digest;
- restore target and previous-state safety backup ID;
- T307 import backup/report reference;
- T406 post-restore validation reference;
- retention reconciliation result;
- 35-day expiry date and deletion evidence.

Do not record Slack IDs, message text, database rows, credentials, or private paths in repository logs.

## 1. Create a cold backup

Set paths in the operator shell without echoing them. `DATABASE_FILE` must match the path encoded by `MASTRA_DATABASE_URL` in the secret store.

```bash
read -r -p 'Absolute database file: ' DATABASE_FILE
read -r -p 'Absolute backup root: ' BACKUP_ROOT
case "$DATABASE_FILE" in /*) ;; *) echo 'Database path must be absolute.' >&2; exit 1;; esac
case "$BACKUP_ROOT" in /*) ;; *) echo 'Backup root must be absolute.' >&2; exit 1;; esac
```

1. Stop Gist and confirm shutdown completed:

```bash
sudo systemctl stop gist
sudo systemctl is-active --quiet gist && exit 1 || true
pgrep -a -f 'src/index\.ts|slack-brain' && {
  echo 'Runtime still active; do not copy storage.' >&2
  exit 1
} || true
```

Review process matches manually. Do not kill an unknown process.

2. Confirm database and backup locations are outside the release repository and distinct. Confirm backup directory mode `0700`.
3. Create one timestamped private directory and copy the stopped database plus any sidecars:

```bash
BACKUP_ID="$(date -u '+%Y%m%dT%H%M%SZ')"
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"
install -d -m 700 "$BACKUP_DIR"
cp --reflink=auto --preserve=mode,timestamps -- "$DATABASE_FILE" "$BACKUP_DIR/mastra.db"
for suffix in -wal -shm; do
  test ! -e "$DATABASE_FILE$suffix" ||
    cp --reflink=auto --preserve=mode,timestamps -- "$DATABASE_FILE$suffix" "$BACKUP_DIR/mastra.db$suffix"
done
chmod 600 "$BACKUP_DIR"/*
(
  cd "$BACKUP_DIR"
  files=(mastra.db)
  test ! -e mastra.db-wal || files+=(mastra.db-wal)
  test ! -e mastra.db-shm || files+=(mastra.db-shm)
  sha256sum -- "${files[@]}" > SHA256SUMS
)
chmod 600 "$BACKUP_DIR/SHA256SUMS"
```

4. Verify without opening or printing database contents:

```bash
(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
test -s "$BACKUP_DIR/mastra.db"
```

5. Record backup ID/digest result in the private inventory. Restart only if no import, cutover, restore, or rollback follows.

A failed stop, copy, or checksum means no usable backup. Keep service stopped until the operator chooses retry or rollback.

## 2. Rotate backups at 35 days

Run at least daily after a new backup succeeds. First list candidates:

```bash
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mmin +50400 -print
```

Review each candidate against:

- active incident/restore needs;
- pre-import and pre-cutover rollback window;
- approved hold inventory;
- most recent verified backup availability.

Delete only approved expired directories with the organization-approved secure deletion process. On SSD/object storage, revocation/expiry of encryption keys and storage lifecycle controls—not plain `rm`—are the reliable erasure controls. Record backup IDs and deletion result, never contents.

Do not delete the legacy source archive or legacy runtime database under this rotation. They remain separate rollback assets until T508 approval.

## 3. Restore to non-production first

Use an isolated non-production Slack app/workspace and a separate restore database path. Never point a rehearsal at production credentials or channels.

1. Select a backup and verify `SHA256SUMS`.
2. Confirm no process uses the restore target.
3. Copy into a fresh mode-`0700` staging directory on the same filesystem as final target.
4. Set database/sidecar modes to `0600` and ownership to the non-production service account.
5. Configure `MASTRA_DATABASE_URL` with the absolute restored `file:` URL.
6. Run the **PENDING integrated** retention/deletion and trace-prune commands before service start.
7. Start exactly one non-production runtime with the **PENDING T406** validated command.
8. Run the merged T406 sanitized checks for startup, reconnect, persistence, retrieval, mutations, and privacy.
9. Stop it cleanly and verify a second restart preserves state.
10. Delete the rehearsal copy according to sensitive-data policy.

Do not inspect message bodies to prove restore. Use aggregate counts, synthetic probes, message keys, and pass/fail results authorized by T307/T406.

## 4. Restore production

Prerequisites: successful non-production rehearsal, approved incident/change owner, verified backup, T307/T406 merged, and a maintenance window.

1. Stop and disable Gist. Confirm legacy services are also inactive.
2. Create a cold safety backup of the current failed state in a distinct directory; do not overwrite the selected restore backup.
3. Verify selected backup checksum and expiry/hold status.
4. Stage restored files on the same filesystem as the destination:

```bash
RESTORE_STAGE="$(dirname "$DATABASE_FILE")/.restore-$BACKUP_ID"
install -d -m 700 "$RESTORE_STAGE"
cp --preserve=mode,timestamps -- "$BACKUP_DIR"/mastra.db* "$RESTORE_STAGE/"
(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
chmod 600 "$RESTORE_STAGE"/mastra.db*
```

5. Move the current database and sidecars into the safety-backup location. Move staged files into place. Same-filesystem rename is required; never write over the active path in place.
6. Set final ownership/mode and verify `MASTRA_DATABASE_URL` still names that absolute file.
7. **Required after every restore:** run the integrated retention/deletion sweep and storage trace prune, then apply T406 validation. A backup can resurrect purged DMs, removed-channel content, deleted messages, stale embeddings, and expired traces. If these commands/evidence are unavailable or fail, keep Gist stopped and escalate to security/technical owner.
8. Start one Gist service and run T406 post-restore checks.
9. Confirm one PID, legacy units inactive, storage writable, reconnect stable, and no privacy/duplicate-response failure.
10. Keep selected backup and failed-state safety backup through incident closure, subject to approved retention/hold handling.

Any checksum, ownership, retention, storage, vector, or privacy failure triggers [rollback](./rollback.md). Do not serve from a restore that has not passed purge reconciliation.

## Restore rehearsal evidence

Fill only with sanitized results after T307/T406 merge:

```text
Rehearsal UTC: PENDING
Operator/reviewer: PENDING
Environment: isolated non-production (confirmation PENDING)
Source backup ID/digest verified: PENDING
T307 report/backup reference: PENDING
Restore copy/start/restart: PENDING
Integrated retention/deletion/trace-prune commands/result: PENDING
Message/vector aggregate reconciliation: PENDING
Retrieval/privacy/live-ingestion checks: PENDING
Cleanup result: PENDING
Overall restore rehearsal: PENDING
```
