/**
 * Design review F-06 — the import path must not carry its own copy of D001,
 * and must not compose identifiers by hand.
 *
 * These assert that archive mapping goes through `authorize()` and through
 * `resource-policy.ts`, so the allowlist has exactly one implementation and
 * the import path gains the ID-shape validation the live path already had.
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  mapArchiveMessage,
  type ArchiveImportContext,
  type ArchiveSourceMessage,
} from '../../../src/migration/mapping/index.js';
import {
  IDENTITY_CONTRACT_VERSION,
  messageKey,
  resolveIdentity,
} from '../../../src/mastra/memory/resource-policy.js';

interface SourceFixture {
  readonly context: ArchiveImportContext;
  readonly cases: ReadonlyArray<{ name: string; rows: readonly ArchiveSourceMessage[] }>;
}

const source = JSON.parse(
  await readFile(
    new URL('../../fixtures/migration/source-records.v1.json', import.meta.url),
    'utf8',
  ),
) as SourceFixture;

const context = source.context;

function row(overrides: Partial<ArchiveSourceMessage> = {}): ArchiveSourceMessage {
  const root = source.cases.find((entry) => entry.name === 'root_message');
  if (!root) throw new Error('Missing root_message fixture case.');
  return { ...(root.rows[0] as ArchiveSourceMessage), ...overrides };
}

describe('D001 is decided by the shared guard', () => {
  it('accepts a row in an approved channel', () => {
    const result = mapArchiveMessage(row(), context);
    expect(result.outcome).toBe('write');
  });

  it('skips a row in an unapproved channel', () => {
    const result = mapArchiveMessage(row({ channel_id: 'C0UNAPPROV9' }), context);
    expect(result).toMatchObject({ outcome: 'skip', reason: 'unapproved_channel' });
  });

  it('skips every channel absent from the approved list, not just known ones', () => {
    for (const channelId of ['C0UNAPPROV9', 'C0OTHERCH1', 'G0PRIVATE01']) {
      expect(mapArchiveMessage(row({ channel_id: channelId }), context)).toMatchObject({
        outcome: 'skip',
        reason: 'unapproved_channel',
      });
    }
  });

  it('reports an unapproved channel as unapproved even when the row is also malformed', () => {
    // Precedence is preserved: the allowlist answer does not depend on the row
    // being well formed enough to build an identity from.
    const result = mapArchiveMessage(
      row({ channel_id: 'C0UNAPPROV9', ts: 'not-a-timestamp' }),
      context,
    );
    expect(result).toMatchObject({ outcome: 'skip', reason: 'unapproved_channel' });
  });
});

describe('identity comes from resource-policy, not from string concatenation', () => {
  it('matches resolveIdentity and messageKey exactly', () => {
    const candidate = row();
    const result = mapArchiveMessage(candidate, context);
    if (result.outcome !== 'write') throw new Error(`expected write, got ${result.outcome}`);

    const identity = resolveIdentity({
      contract_version: IDENTITY_CONTRACT_VERSION,
      workspace_id: context.workspace_id,
      channel_id: candidate.channel_id,
      conversation_type: 'channel',
      message_ts: candidate.ts,
      thread_ts: candidate.thread_ts === candidate.ts ? null : candidate.thread_ts,
      sender_id: candidate.user_id ?? '',
    });

    expect(result.record.boundary_id).toBe(identity.boundary_id);
    expect(result.record.thread_id).toBe(identity.thread_id);
    expect(result.record.message_key).toBe(
      messageKey({
        workspace_id: context.workspace_id,
        channel_id: candidate.channel_id,
        message_ts: candidate.ts,
      }),
    );
  });

  it('refuses a malformed identifier the plain allowlist check would have accepted', () => {
    // The behavioural difference F-06 buys: a channel ID that is *in* the
    // approved list but does not match the contract's ID shape used to be
    // concatenated into a boundary unchecked. `resolve-policy` now rejects it.
    const malformed = 'c0lowercase';
    const result = mapArchiveMessage(
      row({ channel_id: malformed }),
      { ...context, approved_channel_ids: [...context.approved_channel_ids, malformed] },
    );

    expect(result).toMatchObject({ outcome: 'failure', reason: 'invalid_identity' });
  });

  it('collapses both thread-root encodings onto one thread (identity.md §3)', () => {
    const absent = mapArchiveMessage(row({ thread_ts: null }), context);
    const selfReferential = mapArchiveMessage(
      row({ thread_ts: row().ts, is_thread_reply: 0 }),
      context,
    );

    if (absent.outcome !== 'write' || selfReferential.outcome !== 'write') {
      throw new Error('expected both encodings to map');
    }
    expect(selfReferential.record.thread_id).toBe(absent.record.thread_id);
  });

  it('never emits a bare or mis-prefixed boundary', () => {
    const result = mapArchiveMessage(row(), context);
    if (result.outcome !== 'write') throw new Error('expected write');
    expect(result.record.boundary_id.startsWith('ch:')).toBe(true);
    expect(result.record.thread_id.startsWith(`${result.record.boundary_id}#`)).toBe(true);
  });
});

describe('module hygiene', () => {
  it('composes no boundary identifier by hand', async () => {
    const directory = fileURLToPath(
      new URL('../../../src/migration/mapping/', import.meta.url),
    );
    const names = (await readdir(directory)).filter((name) => name.endsWith('.ts'));
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const text = await readFile(`${directory}${name}`, 'utf8');
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(`${name}: ${code}`).not.toMatch(/`ch:\$\{/);
      expect(`${name}: ${code}`).not.toMatch(/`dm:\$\{/);
    }
  });
});
