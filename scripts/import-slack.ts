import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LibSQLVector } from '@mastra/libsql';

import {
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../src/mastra/memory/gist-memory.js';
import { createMastraStorage } from '../src/mastra/storage/index.js';
import {
  ARCHIVE_IMPORT_CONTRACT_VERSION,
  ArchiveImportError,
  MastraMemoryWriter,
  readArchiveImportCheckpoint,
  runArchiveImport,
  validateArchiveImportRequest,
  type ArchiveImportMode,
  type RunArchiveImportOptions,
} from '../src/migration/index.js';
import { ArchiveSourceError } from '../src/migration/source/index.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

interface ImportCliOptions {
  readonly run: RunArchiveImportOptions;
  readonly sourceBackupConfirmed: boolean;
  readonly destinationBackupConfirmed: boolean;
  readonly fullConfirmation?: string;
}

function positiveInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`Invalid ${option}`);
  }
  return parsed;
}

function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new TypeError(`Missing ${option}`);
  return value;
}

function channelAliases(values: readonly string[]): {
  channelIds: string[];
  aliases: Record<string, string>;
} {
  const channelIds: string[] = [];
  const aliases: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator < 1 || separator === value.length - 1) {
      throw new TypeError('Invalid --channel');
    }
    const channelId = value.slice(0, separator);
    if (Object.hasOwn(aliases, channelId)) throw new TypeError('Duplicate --channel');
    channelIds.push(channelId);
    aliases[channelId] = value.slice(separator + 1);
  }
  return { channelIds, aliases };
}

function defaultStatePath(runId: string, suffix: string): string {
  const configured = process.env.XDG_STATE_HOME?.trim();
  const stateHome = configured && isAbsolute(configured)
    ? configured
    : join(homedir(), '.local', 'state');
  return join(stateHome, 'slack-brain', 'archive-import', `${runId}-${suffix}.json`);
}

export function parseArchiveImportCli(
  args: readonly string[],
  now = new Date().toISOString(),
): ImportCliOptions {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      source: { type: 'string' },
      destination: { type: 'string' },
      'import-run-id': { type: 'string' },
      'source-snapshot-id': { type: 'string' },
      'workspace-id': { type: 'string' },
      channel: { type: 'string', multiple: true, default: [] },
      'known-bot-id': { type: 'string', multiple: true, default: [] },
      sample: { type: 'string' },
      'full-import': { type: 'boolean', default: false },
      'confirm-full-import': { type: 'string' },
      'source-backup-confirmed': { type: 'boolean', default: false },
      'destination-backup-confirmed': { type: 'boolean', default: false },
      checkpoint: { type: 'string' },
      report: { type: 'string' },
      resume: { type: 'boolean', default: false },
      'page-size': { type: 'string' },
    },
  });

  const sourcePath = required(values.source, '--source');
  const destinationPath = required(values.destination, '--destination');
  const importRunId = required(values['import-run-id'], '--import-run-id');
  const sourceSnapshotId = required(values['source-snapshot-id'], '--source-snapshot-id');
  const workspaceId = required(values['workspace-id'], '--workspace-id');
  const parsedChannels = channelAliases(values.channel);
  const sampleLimit = positiveInteger(values.sample, '--sample');
  const pageSize = positiveInteger(values['page-size'], '--page-size');
  if (values['full-import'] && sampleLimit !== undefined) {
    throw new TypeError('--sample and --full-import are mutually exclusive');
  }

  const mode: ArchiveImportMode = values['full-import']
    ? 'full'
    : sampleLimit === undefined
      ? 'dry-run'
      : 'sample';
  if (mode !== 'dry-run' && !values['source-backup-confirmed']) {
    throw new TypeError('Sample/full import requires --source-backup-confirmed');
  }
  if (mode === 'full') {
    if (!values['destination-backup-confirmed']) {
      throw new TypeError('Full import requires --destination-backup-confirmed');
    }
    if (values['confirm-full-import'] !== `IMPORT ${importRunId}`) {
      throw new TypeError('Full import confirmation does not match');
    }
  }

  const checkpointPath = values.checkpoint
    ?? defaultStatePath(importRunId, 'checkpoint');
  const reportPath = values.report ?? defaultStatePath(importRunId, 'report');
  const startedAt = values.resume
    ? readArchiveImportCheckpoint(checkpointPath).started_at
    : now;

  return {
    run: {
      sourcePath,
      destinationPath,
      repositoryRoot: REPOSITORY_ROOT,
      context: {
        contract_version: ARCHIVE_IMPORT_CONTRACT_VERSION,
        import_run_id: importRunId,
        source_snapshot_id: sourceSnapshotId,
        workspace_id: workspaceId,
        approved_channel_ids: parsedChannels.channelIds,
        channel_aliases: parsedChannels.aliases,
        known_bot_sender_ids: values['known-bot-id'],
        started_at: startedAt,
      },
      mode,
      ...(sampleLimit === undefined ? {} : { sampleLimit }),
      ...(pageSize === undefined ? {} : { pageSize }),
      checkpointPath,
      reportPath,
      resume: values.resume,
    },
    sourceBackupConfirmed: values['source-backup-confirmed'],
    destinationBackupConfirmed: values['destination-backup-confirmed'],
    ...(values['confirm-full-import'] === undefined
      ? {}
      : { fullConfirmation: values['confirm-full-import'] }),
  };
}

async function countImportedMessages(
  storage: ReturnType<typeof createMastraStorage>,
): Promise<number> {
  const store = await storage.getStore('memory');
  if (!store) throw new Error('Memory storage unavailable');
  const threads = await store.listThreads({ perPage: false });
  if (threads.threads.length === 0) return 0;
  const messages = await store.listMessages({
    threadId: threads.threads.map(({ id }) => id),
    perPage: false,
    filter: { metadata: { source: 'import' } },
  });
  return messages.total;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  let memory: ReturnType<typeof createGistMemory> | undefined;
  let storage: ReturnType<typeof createMastraStorage> | undefined;
  try {
    const parsed = parseArchiveImportCli(args);
    validateArchiveImportRequest(parsed.run);
    let run = parsed.run;
    if (run.mode !== 'dry-run') {
      const databaseUrl = pathToFileURL(run.destinationPath).href;
      storage = createMastraStorage({
        databaseUrl,
        repositoryRoot: REPOSITORY_ROOT,
      });
      await storage.init();
      memory = createGistMemory({
        storage,
        databaseUrl,
        embeddingModel: GIST_EMBEDDING_MODEL,
      });
      run = {
        ...run,
        writer: new MastraMemoryWriter({ memory, storage }),
        countDestination: () => countImportedMessages(storage!),
      };
    }

    const report = await runArchiveImport(run);
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      counts: report.counts,
      reconciliation: report.reconciliation,
    })}\n`);
    const failed = Object.values(report.counts.failed_by_reason)
      .some((count) => (count ?? 0) > 0);
    const destinationBalanced = report.reconciliation.destination_count_after
      - report.reconciliation.destination_count_before
      === report.counts.writer.inserted;
    return failed
      || !report.reconciliation.source_rows_balanced
      || !report.reconciliation.normalized_rows_balanced
      || !destinationBalanced
      ? 1
      : 0;
  } catch (error) {
    const code = error instanceof ArchiveImportError || error instanceof ArchiveSourceError
      ? error.code
      : error instanceof TypeError
        ? 'INVALID_OPTIONS'
        : 'UNEXPECTED_FAILURE';
    process.stderr.write(`archive_import_failed:${code}\n`);
    return 1;
  } finally {
    if (memory) {
      await memory.settled().catch(() => undefined);
      if (memory.vector instanceof LibSQLVector) {
        await memory.vector.close().catch(() => undefined);
      }
    }
    await storage?.close().catch(() => undefined);
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (entryUrl === import.meta.url) process.exitCode = await main();
