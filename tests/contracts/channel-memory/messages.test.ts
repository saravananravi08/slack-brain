/**
 * message-record.md §3, §4, §5 — the stored record, Gist's own outgoing
 * messages, and idempotency (CM-FR-008…011, CM-NFR-001, CM-INV-05/06).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, byName, loadFixture } from './helpers.js';
import {
  channelBoundaryId,
  messageKey,
  threadId,
  threadRootTs,
  type ChannelSenderClass,
} from './reference-rules.js';

const fixture = loadFixture('messages.v1.json');
const records = asArray(fixture.records, 'records');
const idempotency = asArray(fixture.idempotency, 'idempotency');
const rootEncodings = asRecord(fixture.thread_root_encodings, 'thread_root_encodings');

const RECORD_FIELDS = [
  'contract_version',
  'message_key',
  'boundary_id',
  'thread_id',
  'workspace_id',
  'channel_id',
  'message_ts',
  'thread_root_ts',
  'is_thread_reply',
  'sender',
  'sent_at',
  'edited_at',
  'text',
  'files',
  'links',
  'capture_source',
  'ingested_at',
  'enrollment_epoch',
] as const;

function record(name: string): Record<string, unknown> {
  return byName(records, name).record as Record<string, unknown>;
}

describe('channel message record (CM-FR-009)', () => {
  it.each(records.map((entry) => entry.name as string))('%s carries every field', (name) => {
    const value = record(name);
    for (const field of RECORD_FIELDS) {
      expect(value, `${name} is missing ${field}`).toHaveProperty(field);
    }
  });

  it.each(records.map((entry) => entry.name as string))('%s derives its identity fields', (name) => {
    const value = record(name);
    const workspace = value.workspace_id as string;
    const channel = value.channel_id as string;

    expect(value.message_key).toBe(messageKey(workspace, channel, value.message_ts as string));
    expect(value.boundary_id).toBe(channelBoundaryId(workspace, channel));
    expect(value.thread_id).toBe(
      threadId(channelBoundaryId(workspace, channel), value.thread_root_ts as string),
    );
  });

  it.each(records.map((entry) => entry.name as string))('%s derives is_thread_reply', (name) => {
    const value = record(name);
    expect(value.is_thread_reply).toBe(value.thread_root_ts !== value.message_ts);
  });

  it('keeps file and link metadata content-free and always an array', () => {
    for (const entry of records) {
      const value = entry.record as Record<string, unknown>;
      expect(Array.isArray(value.files)).toBe(true);
      expect(Array.isArray(value.links)).toBe(true);
      for (const file of value.files as Record<string, unknown>[]) {
        expect(Object.keys(file).sort()).toEqual(['file_id', 'mimetype', 'name', 'size_bytes']);
        // Metadata only: no bytes, no content, no fetched body.
        expect(file).not.toHaveProperty('content');
        expect(file).not.toHaveProperty('bytes');
      }
      for (const link of value.links as Record<string, unknown>[]) {
        expect(Object.keys(link).sort()).toEqual(['domain', 'url']);
        expect(link).not.toHaveProperty('page_content');
      }
    }
  });
});

describe('coverage of the corpus', () => {
  it('spans both channels', () => {
    const channels = new Set(records.map((entry) => (entry.record as Record<string, unknown>).channel_id));
    expect(channels).toEqual(new Set(['C0CHANTESTA', 'C0CHANTESTB']));
  });

  it('spans every stored sender class', () => {
    const classes = new Set(
      records.map((entry) => {
        const sender = (entry.record as Record<string, unknown>).sender as Record<string, unknown>;
        return sender.sender_class as ChannelSenderClass;
      }),
    );
    for (const senderClass of ['human', 'gist', 'kilo', 'bot', 'app']) {
      expect([...classes], `no stored record for ${senderClass}`).toContain(senderClass);
    }
    // system is classified but never stored (capture-policy.md §3 rule 5).
    expect([...classes]).not.toContain('system');
  });

  it('contains roots and thread replies (CM-FR-008)', () => {
    const flags = records.map((entry) => (entry.record as Record<string, unknown>).is_thread_reply);
    expect(flags).toContain(true);
    expect(flags).toContain(false);
  });
});

describe('thread root encodings (identity.md §3)', () => {
  it('collapses both Slack encodings to one thread', () => {
    const a = asRecord(rootEncodings.encoding_a_absent, 'encoding_a_absent');
    const b = asRecord(rootEncodings.encoding_b_self_referential, 'encoding_b_self_referential');

    const rootA = threadRootTs(a.message_ts as string, a.thread_ts as string | null);
    const rootB = threadRootTs(b.message_ts as string, b.thread_ts as string | null);

    expect(rootA).toBe(rootB);
    expect(rootA).toBe(rootEncodings.expect_thread_root_ts);
    expect(threadId('ch:T0CHANTEST:C0CHANTESTA', rootA)).toBe(rootEncodings.expect_thread_id);
    expect(rootEncodings.expect_is_thread_reply).toBe(false);
  });
});

describe('idempotency and convergence (CM-FR-011, CM-NFR-001)', () => {
  it('stops a Slack retry at delivery dedup, before storage', () => {
    const testCase = byName(idempotency, 'slack_retry_same_envelope');
    const deliveries = asArray(testCase.deliveries, 'deliveries');
    expect(deliveries[0]?.event_id).toBe(deliveries[1]?.event_id);
    expect(testCase.expect_capture_results).toEqual(['captured', 'duplicate_delivery']);
    expect(testCase.expect_upsert_calls).toBe(1);
    expect(testCase.expect_record_count).toBe(1);
  });

  it('converges two envelopes describing one message on message_key', () => {
    // Delivery dedup alone cannot catch this: two different event_ids, one
    // message. Content dedup is what keeps the record count at one.
    const testCase = byName(idempotency, 'same_message_different_envelope');
    const deliveries = asArray(testCase.deliveries, 'deliveries');
    expect(deliveries[0]?.event_id).not.toBe(deliveries[1]?.event_id);
    expect(deliveries[0]?.message_ts).toBe(deliveries[1]?.message_ts);
    expect(testCase.expect_upsert_results).toEqual(['inserted', 'unchanged']);
    expect(testCase.expect_record_count).toBe(1);
  });

  it('survives a restart mid-burst, so delivery dedup must be durable', () => {
    const testCase = byName(idempotency, 'restart_mid_burst_redelivery');
    const deliveries = asArray(testCase.deliveries, 'deliveries');
    expect(deliveries[1]?.restart).toBe(true);
    expect(testCase.expect_capture_results).toEqual(['captured', 'duplicate_delivery']);
    expect(testCase.expect_record_count).toBe(1);
  });

  it('keeps the precision pair as two distinct messages (CM-INV-06)', () => {
    const testCase = byName(idempotency, 'timestamp_precision_pair_are_distinct_messages');
    const a = asRecord(testCase.a, 'a');
    const b = asRecord(testCase.b, 'b');

    expect(a.message_ts).not.toBe(b.message_ts);
    expect(a.expect_message_key).not.toBe(b.expect_message_key);
    expect(messageKey('T0CHANTEST', 'C0CHANTESTA', a.message_ts as string)).toBe(
      a.expect_message_key,
    );
    expect(messageKey('T0CHANTEST', 'C0CHANTESTA', b.message_ts as string)).toBe(
      b.expect_message_key,
    );
    // The float round-trip that would merge them:
    expect(Number(a.message_ts)).toBe(Number(b.message_ts));
    expect(testCase.expect_record_count).toBe(2);
  });
});

describe("Gist's own outgoing messages (CM-FR-010)", () => {
  it('persists directly rather than waiting for a Slack echo', () => {
    const outgoing = record('channel_a_gist_outgoing');
    expect(outgoing.capture_source).toBe('outgoing_self');
    const sender = outgoing.sender as Record<string, unknown>;
    expect(sender.sender_class).toBe('gist');
    expect(sender.is_gist_self).toBe(true);
  });

  it('converges with a later echo on one record', () => {
    const testCase = byName(idempotency, 'outgoing_self_then_echo');
    const writes = asArray(testCase.writes, 'writes');
    expect(writes[0]?.message_ts).toBe(writes[1]?.message_ts);
    expect(testCase.expect_upsert_results).toEqual(['inserted', 'unchanged']);
    expect(testCase.expect_record_count).toBe(1);
  });

  it('keeps capture_source out of identity', () => {
    // Two write paths, one key. capture_source records which path won the
    // race; it must never split the record in two.
    const testCase = byName(idempotency, 'outgoing_self_then_echo');
    expect(testCase.expect_capture_source).toBe('outgoing_self');
    const outgoing = record('channel_a_gist_outgoing');
    expect(outgoing.message_key).not.toContain('outgoing_self');
  });
});
