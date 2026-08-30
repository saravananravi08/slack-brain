import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  ARCHIVE_IMPORT_CONTRACT_VERSION,
  mapArchiveMessages,
  type ArchiveImportContext,
  type ImportFailureReason,
  type ImportSkipReason,
  type ImportWarning,
  type NormalizedArchiveMessage,
} from './mapping/index.js';
import {
  ArchiveSourceReader,
  type ArchiveSourceCounts,
} from './source/index.js';
import type {
  ArchiveWriterRecord,
  ArchiveWriterResult,
} from './writer/index.js';

export {
  ArchiveSourceError,
  ArchiveSourceReader,
  type ArchiveSourceCounts,
  type ArchiveSourceResult,
} from './source/index.js';
export {
  ARCHIVE_IMPORT_CONTRACT_VERSION,
  mapArchiveMessage,
  mapArchiveMessages,
  type ArchiveImportContext,
  type ImportFailureReason,
  type ImportSkipReason,
  type ImportWarning,
  type NormalizedArchiveMessage,
} from './mapping/index.js';
export {
  MastraMemoryWriter,
  type ArchiveWriterRecord,
  type ArchiveWriterResult,
} from './writer/index.js';

export type ArchiveImportMode = 'dry-run' | 'sample' | 'full';
export type ArchiveImportStatus = 'succeeded' | 'partial' | 'failed';

export type ArchiveImportErrorCode =
  | 'INVALID_CONTEXT'
  | 'INVALID_OPTIONS'
  | 'UNSAFE_PATH'
  | 'SOURCE_DESTINATION_COLLISION'
  | 'CHECKPOINT_MISSING'
  | 'CHECKPOINT_INVALID'
  | 'CHECKPOINT_MISMATCH'
  | 'CHECKPOINT_COMPLETED';

export class ArchiveImportError extends Error {
  constructor(readonly code: ArchiveImportErrorCode) {
    super(code);
    this.name = 'ArchiveImportError';
  }
}

export interface ArchiveImportWriter {
  write(records: readonly ArchiveWriterRecord[]): Promise<ArchiveWriterResult>;
}

export interface ArchiveImportCheckpoint {
  readonly contract_version: typeof ARCHIVE_IMPORT_CONTRACT_VERSION;
  readonly checkpoint_version: 1;
  readonly import_run_id: string;
  readonly source_snapshot_id: string;
  readonly started_at: string;
  readonly mode: ArchiveImportMode;
  readonly sample_limit: number | null;
  readonly fingerprint: `sha256:${string}`;
  readonly state: 'prepared' | 'writing' | 'completed';
}

export interface ArchiveImportInventoryItem {
  readonly channel_alias: string;
  readonly channel_ref: `sha256:${string}`;
  readonly min_message_ts: string | null;
  readonly max_message_ts: string | null;
  readonly source_message_count: number;
  readonly logical_thread_count: number;
  readonly malformed_timestamp_count: number;
}

export interface ArchiveImportFailure {
  readonly record_ref: `sha256:${string}`;
  readonly stage: 'read' | 'map' | 'deduplicate' | 'write';
  readonly reason: ImportFailureReason;
  readonly retryable: boolean;
}

export interface ArchiveImportReport {
  readonly contract_version: typeof ARCHIVE_IMPORT_CONTRACT_VERSION;
  readonly report_version: 1;
  readonly import_run_id: string;
  readonly source_snapshot_id: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly status: ArchiveImportStatus;
  readonly inventory: readonly ArchiveImportInventoryItem[];
  readonly counts: {
    readonly source_rows_seen: number;
    readonly normalized_records: number;
    readonly skipped_by_reason: Partial<Record<ImportSkipReason, number>>;
    readonly failed_by_reason: Partial<Record<ImportFailureReason, number>>;
    readonly warnings_by_reason: Partial<Record<ImportWarning, number>>;
    readonly writer: ArchiveWriterResult['writer'];
    readonly embeddings: ArchiveWriterResult['embeddings'];
  };
  readonly failures: readonly ArchiveImportFailure[];
  readonly reconciliation: {
    readonly source_rows_balanced: boolean;
    readonly normalized_rows_balanced: boolean;
    readonly destination_count_before: number;
    readonly destination_count_after: number;
  };
}

export interface RunArchiveImportOptions {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly repositoryRoot?: string;
  readonly context: ArchiveImportContext;
  readonly mode?: ArchiveImportMode;
  readonly sampleLimit?: number;
  readonly pageSize?: number;
  readonly reportPath?: string;
  readonly checkpointPath?: string;
  readonly resume?: boolean;
  readonly writer?: ArchiveImportWriter;
  readonly countDestination?: () => Promise<number>;
  readonly now?: () => string;
}

function fail(code: ArchiveImportErrorCode): never {
  throw new ArchiveImportError(code);
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function validateContext(context: ArchiveImportContext): void {
  const channels = context.approved_channel_ids;
  const aliases = channels.map((channel) => context.channel_aliases[channel]);
  if (
    context.contract_version !== ARCHIVE_IMPORT_CONTRACT_VERSION
    || !/^[A-Za-z0-9._-]+$/.test(context.import_run_id)
    || !/^[A-Za-z0-9._-]+$/.test(context.source_snapshot_id)
    || !/^T[A-Z0-9]{8,}$/.test(context.workspace_id)
    || channels.length === 0
    || new Set(channels).size !== channels.length
    || channels.some((channel) => !/^[CG][A-Z0-9]{8,}$/.test(channel))
    || aliases.some((alias) =>
      typeof alias !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(alias)
    )
    || new Set(aliases).size !== aliases.length
    || context.known_bot_sender_ids.some((id) => !id.trim() || /[\s/]/.test(id))
    || new Set(context.known_bot_sender_ids).size !== context.known_bot_sender_ids.length
    || !isUtcTimestamp(context.started_at)
  ) {
    fail('INVALID_CONTEXT');
  }
}

function pathInside(path: string, parent: string): boolean {
  const fromParent = relative(resolve(parent), resolve(path));
  return fromParent === ''
    || fromParent !== '..'
      && !fromParent.startsWith(`..${sep}`)
      && !isAbsolute(fromParent);
}

function canonicalPath(path: string): string {
  if (!path.trim() || !isAbsolute(path)) fail('UNSAFE_PATH');
  if (existsSync(path)) return realpathSync(path);

  const missing: string[] = [];
  let ancestor = path;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) fail('UNSAFE_PATH');
    missing.unshift(basename(ancestor));
    ancestor = parent;
  }
  return join(realpathSync(ancestor), ...missing);
}

function validatePaths(options: RunArchiveImportOptions): {
  source: string;
  destination: string;
  report?: string;
  checkpoint?: string;
} {
  const repositoryRoot = realpathSync(options.repositoryRoot ?? process.cwd());
  const source = canonicalPath(options.sourcePath);
  const destination = canonicalPath(options.destinationPath);
  const report = options.reportPath ? canonicalPath(options.reportPath) : undefined;
  const checkpoint = options.checkpointPath
    ? canonicalPath(options.checkpointPath)
    : undefined;

  if (source === destination) fail('SOURCE_DESTINATION_COLLISION');
  for (const path of [source, destination, report, checkpoint]) {
    if (path && pathInside(path, repositoryRoot)) fail('UNSAFE_PATH');
  }
  const paths = [source, destination, report, checkpoint].filter(
    (path): path is string => path !== undefined,
  );
  if (new Set(paths).size !== paths.length) fail('UNSAFE_PATH');
  return { source, destination, ...(report ? { report } : {}), ...(checkpoint ? { checkpoint } : {}) };
}

function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_OPTIONS');
  return value;
}

function validateMode(
  options: RunArchiveImportOptions,
  requireRuntime: boolean,
): {
  mode: ArchiveImportMode;
  sampleLimit?: number;
} {
  const mode = options.mode ?? 'dry-run';
  const sampleLimit = positiveInteger(options.sampleLimit);
  positiveInteger(options.pageSize);
  if (
    !['dry-run', 'sample', 'full'].includes(mode)
    || (mode === 'sample') !== (sampleLimit !== undefined)
    || (requireRuntime && mode !== 'dry-run' && (!options.writer || !options.countDestination))
    || options.resume === true && !options.checkpointPath
  ) {
    fail('INVALID_OPTIONS');
  }
  return { mode, ...(sampleLimit === undefined ? {} : { sampleLimit }) };
}

function secureWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

export function readArchiveImportCheckpoint(path: string): ArchiveImportCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    fail(existsSync(path) ? 'CHECKPOINT_INVALID' : 'CHECKPOINT_MISSING');
  }
  if (value === null || typeof value !== 'object') fail('CHECKPOINT_INVALID');
  const checkpoint = value as Partial<ArchiveImportCheckpoint>;
  if (
    checkpoint.contract_version !== ARCHIVE_IMPORT_CONTRACT_VERSION
    || checkpoint.checkpoint_version !== 1
    || typeof checkpoint.import_run_id !== 'string'
    || !/^[A-Za-z0-9._-]+$/.test(checkpoint.import_run_id)
    || typeof checkpoint.source_snapshot_id !== 'string'
    || !/^[A-Za-z0-9._-]+$/.test(checkpoint.source_snapshot_id)
    || typeof checkpoint.started_at !== 'string'
    || !isUtcTimestamp(checkpoint.started_at)
    || !['dry-run', 'sample', 'full'].includes(checkpoint.mode ?? '')
    || checkpoint.mode === 'sample'
      && (!Number.isSafeInteger(checkpoint.sample_limit) || checkpoint.sample_limit! < 1)
    || checkpoint.mode !== 'sample' && checkpoint.sample_limit !== null
    || typeof checkpoint.fingerprint !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(checkpoint.fingerprint)
    || !['prepared', 'writing', 'completed'].includes(checkpoint.state ?? '')
  ) {
    fail('CHECKPOINT_INVALID');
  }
  return checkpoint as ArchiveImportCheckpoint;
}

function checkpointFingerprint(
  context: ArchiveImportContext,
  paths: { source: string; destination: string },
  mode: ArchiveImportMode,
  sampleLimit: number | undefined,
): `sha256:${string}` {
  const channels = [...context.approved_channel_ids].sort();
  return sha256(JSON.stringify({
    context: {
      ...context,
      approved_channel_ids: channels,
      channel_aliases: channels.map((channel) => [channel, context.channel_aliases[channel]]),
      known_bot_sender_ids: [...context.known_bot_sender_ids].sort(),
    },
    source: paths.source,
    destination: paths.destination,
    mode,
    sample_limit: sampleLimit ?? null,
  }));
}

function checkpointFor(
  context: ArchiveImportContext,
  fingerprint: `sha256:${string}`,
  mode: ArchiveImportMode,
  sampleLimit: number | undefined,
  state: ArchiveImportCheckpoint['state'],
): ArchiveImportCheckpoint {
  return {
    contract_version: ARCHIVE_IMPORT_CONTRACT_VERSION,
    checkpoint_version: 1,
    import_run_id: context.import_run_id,
    source_snapshot_id: context.source_snapshot_id,
    started_at: context.started_at,
    mode,
    sample_limit: sampleLimit ?? null,
    fingerprint,
    state,
  };
}

function increment<T extends string>(counts: Partial<Record<T, number>>, reason: T): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function sum(counts: Readonly<Record<string, number | undefined>>): number {
  return Object.values(counts).reduce<number>(
    (total, value) => total + (value ?? 0),
    0,
  );
}

function inventory(
  counts: ArchiveSourceCounts,
  context: ArchiveImportContext,
): ArchiveImportInventoryItem[] {
  return counts.channels.map((channel) => ({
    channel_alias: context.channel_aliases[channel.channel_id]!,
    channel_ref: sha256(`${context.workspace_id}/${channel.channel_id}`),
    min_message_ts: channel.min_message_ts,
    max_message_ts: channel.max_message_ts,
    source_message_count: channel.message_count,
    logical_thread_count: channel.logical_thread_count,
    malformed_timestamp_count: channel.malformed_timestamp_count,
  }));
}

function writerRecords(
  records: readonly NormalizedArchiveMessage[],
  ingestedAt: string,
): ArchiveWriterRecord[] {
  return records.map((record) => ({
    delivery_key: record.delivery_key,
    message: { ...record, ingested_at: ingestedAt },
  }));
}

function dryRunWriterResult(count: number): ArchiveWriterResult {
  return {
    accepted: count,
    rejected: 0,
    writer: { inserted: 0, updated: 0, unchanged: count, failed: 0 },
    embeddings: { written: 0, unchanged: count, failed: 0 },
    failures: [],
  };
}

/** Validate context, mode, and paths before constructing destination dependencies. */
export function validateArchiveImportRequest(options: RunArchiveImportOptions): void {
  validateContext(options.context);
  validatePaths(options);
  validateMode(options, false);
}

/** Compose source reader, pure mapper, writer, checkpoint, and sanitized report. */
export async function runArchiveImport(
  options: RunArchiveImportOptions,
): Promise<ArchiveImportReport> {
  validateContext(options.context);
  const paths = validatePaths(options);
  const { mode, sampleLimit } = validateMode(options, true);
  const fingerprint = checkpointFingerprint(options.context, paths, mode, sampleLimit);
  const checkpoint = checkpointFor(
    options.context,
    fingerprint,
    mode,
    sampleLimit,
    'prepared',
  );

  if (options.resume) {
    const existing = readArchiveImportCheckpoint(paths.checkpoint!);
    if (existing.state === 'completed') fail('CHECKPOINT_COMPLETED');
    if (existing.fingerprint !== fingerprint) fail('CHECKPOINT_MISMATCH');
  } else if (paths.checkpoint && existsSync(paths.checkpoint)) {
    fail('CHECKPOINT_MISMATCH');
  }
  if (paths.checkpoint) secureWriteJson(paths.checkpoint, checkpoint);

  const reader = ArchiveSourceReader.open(paths.source);
  try {
    const sourceCounts = reader.counts(options.context.approved_channel_ids);
    const validRows = [];
    const readFailures: ArchiveImportFailure[] = [];
    let sourceRowsSeen = 0;

    const readPageSize = mode === 'sample'
      ? Math.min(options.pageSize ?? sampleLimit!, sampleLimit!)
      : options.pageSize;
    const sourceResults = reader.readMessages({
      approvedChannelIds: options.context.approved_channel_ids,
      ...(readPageSize === undefined ? {} : { pageSize: readPageSize }),
    });
    while (mode !== 'sample' || sourceRowsSeen < sampleLimit!) {
      const next = sourceResults.next();
      if (next.done) break;
      const result = next.value;
      sourceRowsSeen += 1;
      if (result.ok) validRows.push(result.value);
      else {
        readFailures.push({
          record_ref: sha256(result.source_ref),
          stage: 'read',
          reason: result.reason,
          retryable: false,
        });
      }
    }

    const mapped = mapArchiveMessages(validRows, options.context);
    const skippedByReason: Partial<Record<ImportSkipReason, number>> = {};
    const failedByReason: Partial<Record<ImportFailureReason, number>> = {};
    const warningsByReason: Partial<Record<ImportWarning, number>> = {};
    for (const item of mapped.skipped) increment(skippedByReason, item.reason);
    for (const item of mapped.warnings) increment(warningsByReason, item.reason);

    const failures: ArchiveImportFailure[] = [...readFailures];
    for (const failure of readFailures) increment(failedByReason, failure.reason);
    for (const failure of mapped.failures) {
      increment(failedByReason, failure.reason);
      failures.push({
        record_ref: sha256(failure.source_ref),
        stage: failure.reason === 'duplicate_conflict' ? 'deduplicate' : 'map',
        reason: failure.reason,
        retryable: false,
      });
    }

    let destinationBefore = 0;
    let destinationAfter = 0;
    let writerResult: ArchiveWriterResult;
    if (mode === 'dry-run') {
      writerResult = dryRunWriterResult(mapped.records.length);
    } else {
      destinationBefore = await options.countDestination!();
      if (paths.checkpoint) {
        secureWriteJson(paths.checkpoint, { ...checkpoint, state: 'writing' });
      }
      writerResult = await options.writer!.write(
        writerRecords(mapped.records, options.context.started_at),
      );
      destinationAfter = await options.countDestination!();
      for (const failure of writerResult.failures) {
        increment(failedByReason, failure.reason);
        const record = mapped.records[failure.record_index];
        failures.push({
          record_ref: sha256(record?.message_key ?? `writer:${failure.record_index}`),
          stage: 'write',
          reason: failure.reason,
          retryable: failure.retryable,
        });
      }
    }

    const mappingFailureCount = sum(failedByReason) - (failedByReason.writer_failed ?? 0);
    const sourceRowsBalanced = sourceRowsSeen
      === mapped.records.length + sum(skippedByReason) + mappingFailureCount;
    const normalizedRowsBalanced = mapped.records.length
      === writerResult.writer.inserted
        + writerResult.writer.updated
        + writerResult.writer.unchanged
        + writerResult.writer.failed
      && writerResult.writer.failed === (failedByReason.writer_failed ?? 0);
    const destinationBalanced = destinationAfter - destinationBefore
      === writerResult.writer.inserted;
    const hasFailures = sum(failedByReason) > 0;
    const reconciled = sourceRowsBalanced && normalizedRowsBalanced && destinationBalanced;
    const status: ArchiveImportStatus = mode !== 'full'
      ? 'partial'
      : !hasFailures && reconciled
        ? 'succeeded'
        : 'failed';
    const completedAt = (options.now ?? (() => new Date().toISOString()))();
    if (!isUtcTimestamp(completedAt)) fail('INVALID_OPTIONS');

    const report: ArchiveImportReport = {
      contract_version: ARCHIVE_IMPORT_CONTRACT_VERSION,
      report_version: 1,
      import_run_id: options.context.import_run_id,
      source_snapshot_id: options.context.source_snapshot_id,
      started_at: options.context.started_at,
      completed_at: completedAt,
      status,
      inventory: inventory(sourceCounts, options.context),
      counts: {
        source_rows_seen: sourceRowsSeen,
        normalized_records: mapped.records.length,
        skipped_by_reason: skippedByReason,
        failed_by_reason: failedByReason,
        warnings_by_reason: warningsByReason,
        writer: writerResult.writer,
        embeddings: writerResult.embeddings,
      },
      failures,
      reconciliation: {
        source_rows_balanced: sourceRowsBalanced,
        normalized_rows_balanced: normalizedRowsBalanced,
        destination_count_before: destinationBefore,
        destination_count_after: destinationAfter,
      },
    };

    if (paths.report) secureWriteJson(paths.report, report);
    if (paths.checkpoint && writerResult.writer.failed === 0) {
      secureWriteJson(paths.checkpoint, { ...checkpoint, state: 'completed' });
    }
    return report;
  } finally {
    reader.close();
  }
}
