import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  compareArchiveMessageTimestamps,
  mapArchiveMessage,
  mapArchiveMessages,
} from '../../../src/migration/mapping/archive-message.js';
import type {
  ArchiveImportContext,
  ArchiveSourceMessage,
} from '../../../src/migration/mapping/types.js';

interface FixtureCase {
  readonly name: string;
  readonly rows: readonly ArchiveSourceMessage[];
}

interface SourceFixture {
  readonly context: ArchiveImportContext;
  readonly cases: readonly FixtureCase[];
}

interface ExpectedCase {
  readonly name: string;
  readonly expect: Record<string, any>;
}

interface ExpectedFixture {
  readonly cases: readonly ExpectedCase[];
}

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(
      new URL(`../../fixtures/migration/${name}`, import.meta.url),
      'utf8',
    ),
  ) as T;
}

const source = await fixture<SourceFixture>('source-records.v1.json');
const expected = await fixture<ExpectedFixture>('normalized-records.v1.json');

function sourceCase(name: string): FixtureCase {
  const found = source.cases.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Missing source fixture case: ${name}`);
  return found;
}

function expectedCase(name: string): ExpectedCase {
  const found = expected.cases.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Missing expected fixture case: ${name}`);
  return found;
}

function row(overrides: Partial<ArchiveSourceMessage> = {}): ArchiveSourceMessage {
  return {
    ...sourceCase('root_message').rows[0] as ArchiveSourceMessage,
    source_ref: 'synthetic:classification',
    ...overrides,
  };
}

describe('archive message contract fixtures', () => {
  it.each(source.cases.map(({ name }) => name))('maps %s', (name) => {
    const result = mapArchiveMessages(sourceCase(name).rows, source.context);
    const fixtureExpectation = expectedCase(name).expect;

    if (fixtureExpectation.outcome === 'write') {
      expect(result.records).toHaveLength(fixtureExpectation.records.length);
      expect(result.records).toEqual(
        expect.arrayContaining(fixtureExpectation.records),
      );
      expect(result.failures).toEqual([]);
      expect(result.skipped).toHaveLength(fixtureExpectation.skipped?.count ?? 0);
      if (fixtureExpectation.skipped !== undefined) {
        expect(result.skipped.every(
          ({ reason }) => reason === fixtureExpectation.skipped.reason,
        )).toBe(true);
      }
      expect(result.warnings.map(({ reason }) => reason)).toEqual(
        fixtureExpectation.warnings ?? [],
      );
      return;
    }

    expect(result.records).toEqual([]);
    if (fixtureExpectation.outcome === 'skip') {
      expect(result.failures).toEqual([]);
      expect(result.skipped).toEqual([expect.objectContaining({
        reason: fixtureExpectation.reason,
      })]);
      return;
    }

    expect(result.skipped).toEqual([]);
    expect(result.failures).toHaveLength(fixtureExpectation.failed_rows);
    expect(result.failures.every(
      ({ reason }) => reason === fixtureExpectation.reason,
    )).toBe(true);
  });

  it('is independent of input order and source references for normalized records', () => {
    const rows = [
      ...sourceCase('timestamp_precision_pair').rows,
      ...sourceCase('exact_duplicate_delivery').rows,
    ];
    const reversed = [...rows].reverse().map((candidate, index) => ({
      ...candidate,
      source_ref: `synthetic:renamed-${index}`,
    }));

    expect(mapArchiveMessages(reversed, source.context).records).toEqual(
      mapArchiveMessages(rows, source.context).records,
    );
  });

  it('uses integer timestamp ordering with verbatim precision as final tie-breaker', () => {
    expect(compareArchiveMessageTimestamps(
      '1735690080.000100',
      '1735690080.0002',
    )).toBeLessThan(0);
    expect(compareArchiveMessageTimestamps(
      '1735690080.0002',
      '1735690080.000200',
    )).toBeLessThan(0);
    expect(() => compareArchiveMessageTimestamps('invalid', '1735690080.000200'))
      .toThrow(TypeError);
  });
});

describe('fixed classification order', () => {
  it.each([
    {
      name: 'unapproved before malformed JSON',
      input: row({ channel_id: 'C0UNAPPROV9', raw_json: '{' }),
      outcome: 'skip',
      reason: 'unapproved_channel',
    },
    {
      name: 'malformed JSON before bot indicators',
      input: row({ user_id: 'B0SYNTH001', raw_json: '{' }),
      outcome: 'failure',
      reason: 'malformed_raw_json',
    },
    {
      name: 'app indicator before system subtype',
      input: row({ raw_json: '{"app_id":"A0SYNTH001","subtype":"channel_join"}' }),
      outcome: 'skip',
      reason: 'bot_message',
    },
    {
      name: 'system subtype before empty text',
      input: row({ text: ' ', raw_json: '{"subtype":"message_deleted"}' }),
      outcome: 'skip',
      reason: 'system_subtype',
    },
    {
      name: 'file metadata distinguishes file-only empty text',
      input: row({ text: ' ', raw_json: '{"files":[{"id":"F0SYNTH001"}]}' }),
      outcome: 'skip',
      reason: 'file_only',
    },
    {
      name: 'empty text before missing sender',
      input: row({ text: ' ', user_id: null, user_name: null, user: null }),
      outcome: 'skip',
      reason: 'empty_text',
    },
    {
      name: 'missing sender before invalid timestamp',
      input: row({ ts: 'invalid', user_id: null, user_name: null, user: null }),
      outcome: 'skip',
      reason: 'missing_sender',
    },
    {
      name: 'invalid root timestamp',
      input: row({ ts: 'invalid' }),
      outcome: 'failure',
      reason: 'invalid_timestamp',
    },
    {
      name: 'invalid thread timestamp',
      input: row({ thread_ts: 'invalid' }),
      outcome: 'failure',
      reason: 'invalid_thread_timestamp',
    },
    {
      name: 'invalid edit timestamp',
      input: row({ raw_json: '{"edited":{"ts":"invalid"}}' }),
      outcome: 'failure',
      reason: 'invalid_edit_timestamp',
    },
  ])('$name', ({ input, outcome, reason }) => {
    expect(mapArchiveMessage(input, source.context)).toMatchObject({ outcome, reason });
  });

  it('uses trimmed display, real, cache, then archived sender names', () => {
    expect(mapArchiveMessage(row({
      user: {
        id: 'U0MEMBER01',
        display_name: ' ',
        real_name: ' ',
        name: ' synthetic-cache ',
      },
      user_name: ' Synthetic Archive ',
    }), source.context)).toMatchObject({
      outcome: 'write',
      record: { sender_name: 'synthetic-cache' },
    });
  });
});
