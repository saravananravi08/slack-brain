# Archive import runbook

Use this command only for the approved D001 channels. It reads the legacy SQLite archive in read-only/immutable mode and writes current message snapshots to Mastra memory. It never imports documents, file-only rows, bots, system messages, or unapproved channels.

## Safety rules

- Run from a clean checkout, but keep source, destination, checkpoint, report, and backups outside the repository.
- Use absolute, distinct paths. The command rejects repository paths and a source/destination collision.
- Never paste source rows, message text, raw JSON, real IDs, database paths, or credentials into Git, tickets, chat, or application logs.
- Stop the bot before sample/full writes. Do not let live ingestion and archive import write the destination concurrently.
- Back up the source before sample/full mode. Back up the destination before full mode.
- Keep source and destination backups until the rollback window closes.
- Do not run `VACUUM`, migrations, checkpoints, or the legacy `getDb()` against the source.

## 1. Prepare

Set private operator values in the shell or an operator-restricted environment file outside Git:

```bash
export OPENAI_API_KEY='<operator-secret>'
export SOURCE_DB='/absolute/operator/path/archive.db'
export DESTINATION_DB='/absolute/operator/path/mastra.db'
export CHECKPOINT='/absolute/operator/path/import-checkpoint.json'
export REPORT='/absolute/operator/path/import-report.json'
```

Use a unique, content-free run ID and source snapshot label. Assign safe aliases to approved channels; aliases appear in reports, real IDs do not.

Back up with an operator-approved method. Example for stopped local files:

```bash
install -m 600 "$SOURCE_DB" '/absolute/operator/backup/archive-before-import.db'
install -m 600 "$DESTINATION_DB" '/absolute/operator/backup/mastra-before-import.db'
```

If the destination does not exist yet, record that fact instead of creating an empty placeholder. Verify source backup digest and authoritative B-03 inventory out of band before any sample/full approval.

## 2. Dry-run first

Dry-run is the default. It opens only the source, performs mapping/reconciliation, writes a sanitized report/checkpoint, and does not open or create the destination.

```bash
npm run import:slack -- \
  --source "$SOURCE_DB" \
  --destination "$DESTINATION_DB" \
  --import-run-id 'archive-dry-001' \
  --source-snapshot-id 'approved-backup-001' \
  --workspace-id '<approved-workspace-id>' \
  --channel '<approved-channel-id>=team-history' \
  --known-bot-id '<known-bot-sender-id>' \
  --checkpoint "$CHECKPOINT" \
  --report "$REPORT"
```

Expected status is `partial` because dry-run intentionally performs no import. Review:

- inventory against the authoritative baseline;
- skip/failure/warning reason counts;
- `source_rows_balanced: true`;
- `normalized_rows_balanced: true`;
- zero writer failures.

Stop on any unexplained inventory difference, failure, or false reconciliation value.

## 3. Bounded sample

Use a new run ID, report, and checkpoint. `--sample N` limits source rows, not normalized records. Source backup confirmation is mandatory.

```bash
npm run import:slack -- \
  --source "$SOURCE_DB" \
  --destination "$DESTINATION_DB" \
  --import-run-id 'archive-sample-001' \
  --source-snapshot-id 'approved-backup-001' \
  --workspace-id '<approved-workspace-id>' \
  --channel '<approved-channel-id>=team-history' \
  --sample 100 \
  --source-backup-confirmed \
  --checkpoint "$CHECKPOINT" \
  --report "$REPORT"
```

A bounded sample reports `partial` by design. Validate destination messages, embeddings, citations, thread grouping, and report equations before proceeding. T306 owns the formal sample quality gate.

## 4. Full import

Stop the bot and back up destination immediately before this step. Full mode requires both backup confirmations and an exact run-ID confirmation phrase.

```bash
npm run import:slack -- \
  --source "$SOURCE_DB" \
  --destination "$DESTINATION_DB" \
  --import-run-id 'archive-full-001' \
  --source-snapshot-id 'approved-backup-001' \
  --workspace-id '<approved-workspace-id>' \
  --channel '<approved-channel-id>=team-history' \
  --source-backup-confirmed \
  --destination-backup-confirmed \
  --full-import \
  --confirm-full-import 'IMPORT archive-full-001' \
  --checkpoint "$CHECKPOINT" \
  --report "$REPORT"
```

Do not approve a full import unless status is `succeeded`, all failure counts are zero, both reconciliation booleans are true, and:

```text
destination_count_after - destination_count_before = writer.inserted
```

## Stop and resume

Interrupt with `Ctrl-C` if required. Do not delete or edit the checkpoint. Resume with the exact same source, destination, context, mode, sample limit, run ID, snapshot ID, aliases, and checkpoint, adding `--resume`:

```bash
# Repeat the original command and append:
--resume
```

Resume replays the source with the same delivery identity. Already completed records resolve as unchanged; pending records continue. A completed checkpoint rejects resume. Start a new run ID for an intentional rerun after completion.

## Rerun and idempotency

For a completed import, use a new run ID, started time, report, and checkpoint while keeping the same source snapshot selection. Unchanged messages and embeddings must report `unchanged`; destination count must not grow.

## Rollback

1. Stop the bot and import command.
2. Preserve failed report/checkpoint for restricted operator review.
3. Close all processes using the destination.
4. Restore the pre-import destination backup atomically using the operator-approved storage procedure. If no destination existed before import, remove the newly created destination and its sidecar files only after confirming all handles are closed.
5. Reopen the restored destination and run the storage/memory verification suite.
6. Keep the immutable source backup; import rollback never changes source.
7. Do not restart the bot until destination count, retrieval, and privacy checks pass.

Reports and checkpoints are mode `0600` and contain hashes, aliases, timestamps, aggregate counts, and reason codes only. Treat them as operator-restricted even though they contain no message content.
