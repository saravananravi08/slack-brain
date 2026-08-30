import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

type JsonRecord = Record<string, any>;

async function fixture(name: string): Promise<JsonRecord> {
  return JSON.parse(
    await readFile(new URL(name, import.meta.url), 'utf8'),
  ) as JsonRecord;
}

const source = await fixture('./source-records.v1.json');
const normalized = await fixture('./normalized-records.v1.json');
const reports = await fixture('./audit-reports.v1.json');

function caseByName(collection: JsonRecord, name: string): JsonRecord {
  const found = collection.cases.find((candidate: JsonRecord) => candidate.name === name);
  expect(found, `Missing fixture case: ${name}`).toBeDefined();
  return found as JsonRecord;
}

function sum(values: JsonRecord): number {
  return Object.values(values).reduce<number>((total, value) => total + Number(value), 0);
}

function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]);
}

describe('archive import contract fixtures', () => {
  it('pins one synthetic immutable contract version', () => {
    for (const document of [source, normalized, reports]) {
      expect(document.contract_version).toBe('1.0.0');
      expect(document.synthetic).toBe(true);
    }
  });

  it('covers every required source edge case with an expected outcome', () => {
    const required = [
      'root_message',
      'thread_reply',
      'self_referential_root',
      'edited_message',
      'bot_message',
      'missing_user_cache_with_row_name_fallback',
      'missing_unresolvable_sender',
      'timestamp_precision_pair',
      'exact_duplicate_delivery',
      'conflicting_duplicate_content',
      'invalid_timestamp',
    ];
    const sourceNames = new Set(source.cases.map(({ name }: JsonRecord) => name));
    const expectedNames = new Set(normalized.cases.map(({ name }: JsonRecord) => name));

    expect(sourceNames).toEqual(expectedNames);
    for (const name of required) expect(sourceNames.has(name), name).toBe(true);
  });

  it('uses the exact legacy source row shape', () => {
    const requiredFields = [
      'source_ref', 'ts', 'channel_id', 'user_id', 'user_name', 'text',
      'thread_ts', 'reply_count', 'date', 'is_thread_reply', 'raw_json', 'user',
    ];

    for (const testCase of source.cases) {
      for (const row of testCase.rows) {
        expect(Object.keys(row).sort(), testCase.name).toEqual([...requiredFields].sort());
      }
    }
  });

  it('maps roots, replies, sender fallback, and edits deterministically', () => {
    const root = caseByName(normalized, 'root_message').expect.records[0];
    const reply = caseByName(normalized, 'thread_reply').expect.records[0];
    const selfRoot = caseByName(normalized, 'self_referential_root').expect.records[0];
    const edited = caseByName(normalized, 'edited_message').expect;
    const fallback = caseByName(
      normalized,
      'missing_user_cache_with_row_name_fallback',
    ).expect;

    expect(root.thread_id).toBe(`ch:T0SYNTH01:C0APPROVED1#${root.message_ts}`);
    expect(reply.thread_id).toBe(root.thread_id);
    expect(selfRoot.thread_id).toBe(
      `ch:T0SYNTH01:C0APPROVED1#${selfRoot.message_ts}`,
    );
    expect(edited.records[0].edited_at).toBe('2025-01-01T00:04:00.000Z');
    expect(edited.writer.embedding_action).toBe('replace_current_text_only');
    expect(fallback.records[0].sender_name).toBe('Synthetic Archived Member');
    expect(fallback.warnings).toContain('user_cache_miss_fallback');
  });

  it('keeps content and delivery identities separate and preserves timestamp strings', () => {
    for (const testCase of normalized.cases) {
      for (const record of testCase.expect.records ?? []) {
        expect(record.message_key).toBe(
          `T0SYNTH01/C0APPROVED1/${record.message_ts}`,
        );
        expect(record.delivery_key).toBe(
          `import:synthetic-run-001:${record.message_key}`,
        );
        expect(record.boundary_id).toBe('ch:T0SYNTH01:C0APPROVED1');
        expect(record.conversation_type).toBe('channel');
        expect(record.source).toBe('import');
      }
    }

    const precision = caseByName(normalized, 'timestamp_precision_pair').expect.records;
    expect(precision[0].message_key).not.toBe(precision[1].message_key);
    expect(precision[0].sent_at).toBe(precision[1].sent_at);
  });

  it('pins exclusion and conflict behavior', () => {
    expect(caseByName(normalized, 'bot_message').expect).toMatchObject({
      outcome: 'skip', reason: 'bot_message', records: [],
    });
    expect(caseByName(normalized, 'missing_unresolvable_sender').expect).toMatchObject({
      outcome: 'skip', reason: 'missing_sender', records: [],
    });
    expect(caseByName(normalized, 'exact_duplicate_delivery').expect).toMatchObject({
      outcome: 'write', skipped: { reason: 'duplicate_exact', count: 1 },
    });
    expect(caseByName(normalized, 'conflicting_duplicate_content').expect).toMatchObject({
      outcome: 'failure', reason: 'duplicate_conflict', failed_rows: 2,
      records: [], writer_touched: false,
    });
  });

  it('reconciles every audit report exactly', () => {
    for (const { name, report } of reports.reports) {
      const mappingFailures = sum(report.counts.failed_by_reason)
        - Number(report.counts.failed_by_reason.writer_failed ?? 0);
      expect(report.counts.source_rows_seen, name).toBe(
        report.counts.normalized_records
          + sum(report.counts.skipped_by_reason)
          + mappingFailures,
      );
      expect(report.counts.normalized_records, name).toBe(
        sum(report.counts.writer),
      );
      expect(report.counts.writer.failed, name).toBe(
        report.counts.failed_by_reason.writer_failed ?? 0,
      );
      expect(
        report.reconciliation.destination_count_after
          - report.reconciliation.destination_count_before,
        name,
      ).toBe(report.counts.writer.inserted);
      expect(report.reconciliation).toMatchObject({
        source_rows_balanced: true,
        normalized_rows_balanced: true,
      });
    }
  });

  it('makes an unchanged rerun converge without new rows or embeddings', () => {
    const first = reports.reports.find(({ name }: JsonRecord) => name === 'clean_first_run').report;
    const rerun = reports.reports.find(
      ({ name }: JsonRecord) => name === 'clean_rerun_is_idempotent',
    ).report;

    expect(rerun.inventory).toEqual(first.inventory);
    expect(rerun.counts.writer).toEqual({ inserted: 0, updated: 0, unchanged: 7, failed: 0 });
    expect(rerun.counts.embeddings).toEqual({ written: 0, unchanged: 7, failed: 0 });
    expect(rerun.reconciliation.destination_count_after).toBe(
      first.reconciliation.destination_count_after,
    );
  });

  it('keeps audit reports content-free and fixtures obviously synthetic', () => {
    const forbiddenReportFields = [
      'text', 'raw_json', 'sender_id', 'sender_name', 'channel_id',
      'workspace_id', 'source_path', 'embedding', 'trace',
    ];
    const reportFields = keys(reports);
    for (const field of forbiddenReportFields) {
      expect(reportFields, `Forbidden audit report field: ${field}`).not.toContain(field);
    }

    const fixtureText = JSON.stringify([source, normalized, reports]);
    expect(fixtureText).not.toMatch(/xox[baprs]-/i);
    const slackLikeIds = fixtureText.match(/\b[TCUDB][A-Z0-9]{8,}\b/g) ?? [];
    expect(slackLikeIds.length).toBeGreaterThan(0);
    for (const id of slackLikeIds) {
      expect(id, `Non-synthetic Slack-like ID: ${id}`).toMatch(
        /(SYNTH|APPROVED|UNAPPROV|MEMBER|MISSING)/,
      );
    }
  });
});
