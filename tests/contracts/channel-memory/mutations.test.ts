/**
 * mutations.md — edit replacement on original identity, and the accepted
 * delete-ignore policy (CM-FR-015…019, D015).
 *
 * The delete cases pin an accepted product risk. If they start failing, the
 * behavior changed without a decision; if someone wants them to fail, that
 * needs a new approved decision first (mutations.md §4.1).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, byName, loadFixture } from './helpers.js';
import { editWins, messageKey } from './reference-rules.js';

const fixture = loadFixture('mutations.v1.json');
const edits = asArray(fixture.edits, 'edits');
const deletes = asArray(fixture.deletes, 'deletes');

/**
 * Both arrays mix mutation cases with the follow-on scenarios they set up (a
 * late original arriving after an inserted edit; a redelivery after an ignored
 * delete). Only the former carry a `mutation` envelope.
 */
const editMutations = edits.filter((entry) => entry.mutation !== undefined);
const deleteMutations = deletes.filter((entry) => entry.mutation !== undefined);
const risk = asRecord(fixture.accepted_risk, 'accepted_risk');

const PRESERVED_FIELDS = [
  'message_key',
  'boundary_id',
  'thread_id',
  'thread_root_ts',
  'is_thread_reply',
  'sender_id',
  'sender_class',
  'sender_display_name',
  'sent_at',
  'message_ts',
  'capture_source',
  'enrollment_epoch',
] as const;

describe('edit identity (CM-FR-015)', () => {
  it.each(editMutations.map((entry) => entry.name as string))(
    '%s keys on the original message',
    (name) => {
    const testCase = byName(edits, name);
    const mutation = asRecord(testCase.mutation, 'mutation');
    const expected = messageKey(
      mutation.workspace_id as string,
      mutation.channel_id as string,
      mutation.target_ts as string,
    );

    if (testCase.expect_message_key !== undefined) {
      expect(testCase.expect_message_key).toBe(expected);
    }
    // Identity is the ORIGINAL message's ts. The mutation envelope carries no
    // competing timestamp field that could be mistaken for one.
    expect(mutation).not.toHaveProperty('message_ts');
    expect(mutation).toHaveProperty('target_ts');
    },
  );

  it('replaces content under the original key rather than inserting a second row', () => {
    const testCase = byName(edits, 'edit_stored_message');
    expect(testCase.expect_result).toBe('updated');
    expect(testCase.expect_message_key).toBe('T0CHANTEST/C0CHANTESTA/1767603700.000100');
  });
});

describe('edit fidelity (CM-FR-016)', () => {
  it('changes only text and edited_at', () => {
    const testCase = byName(edits, 'edit_stored_message');
    expect(testCase.expect_changed_fields).toEqual(['text', 'edited_at']);
  });

  it('preserves sender, channel, thread, and sent time', () => {
    const preserved = asRecord(
      byName(edits, 'edit_stored_message').expect_preserved_fields,
      'expect_preserved_fields',
    );
    for (const field of PRESERVED_FIELDS) {
      expect(preserved, `edit must preserve ${field}`).toHaveProperty(field);
    }
  });

  it('keeps an edited bot message a bot message, and still response-ineligible', () => {
    // Slack re-states the whole message in message_changed. Treating that as a
    // fresh capture is how an edited message drifts to the wrong author.
    const testCase = byName(edits, 'edit_preserves_sender_for_bot_message');
    const preserved = asRecord(testCase.expect_preserved_fields, 'expect_preserved_fields');
    expect(preserved.sender_class).toBe('bot');
    expect(preserved.sender_id).toBe('U0OTHRBOT01');
    expect(testCase.expect_respond_allowed).toBe(false);
    expect(testCase.expect_response_reason).toBe('non_human_sender');
  });
});

describe('embedding and derived context (CM-FR-017)', () => {
  it('replaces the stale embedding', () => {
    const testCase = byName(edits, 'edit_stored_message');
    expect(testCase.expect_embedding_replaced).toBe(true);
    expect(testCase.expect_stale_embedding_survives).toBe(false);
  });

  it('emits the derived-invalidation signal P07 consumes (CM-FR-026)', () => {
    const invalidation = asRecord(
      byName(edits, 'edit_stored_message').expect_derived_invalidation,
      'expect_derived_invalidation',
    );
    for (const field of ['boundary_id', 'message_key', 'invalidated_at', 'targets']) {
      expect(invalidation).toHaveProperty(field);
    }
    expect(invalidation.targets).toEqual(['summary', 'observations']);
  });

  it('does not re-embed when nothing changed', () => {
    expect(byName(edits, 'replayed_edit_is_idempotent').expect_embedding_replaced).toBe(false);
  });
});

describe('idempotency and ordering (CM-FR-018)', () => {
  it('treats a replayed edit as unchanged', () => {
    const first = asRecord(byName(edits, 'edit_stored_message').mutation, 'mutation');
    const replay = byName(edits, 'replayed_edit_is_idempotent');
    const replayMutation = asRecord(replay.mutation, 'mutation');

    expect(replayMutation.edited_at).toBe(first.edited_at);
    expect(editWins(first.edited_at as string, replayMutation.edited_at as string)).toBe(false);
    expect(replay.expect_result).toBe('unchanged');
    expect(replay.expect_record_count).toBe(1);
  });

  it('does not let an older edit overwrite a newer one', () => {
    const applied = asRecord(byName(edits, 'edit_stored_message').mutation, 'mutation');
    const older = byName(edits, 'out_of_order_older_edit_does_not_regress');
    const olderMutation = asRecord(older.mutation, 'mutation');

    expect(editWins(applied.edited_at as string, olderMutation.edited_at as string)).toBe(false);
    expect(older.expect_result).toBe('unchanged');
    expect(older.expect_text_unchanged).toBe(true);
    expect(older.expect_edited_at).toBe(applied.edited_at);
  });

  it('applies a newer edit to an unedited record', () => {
    const mutation = asRecord(byName(edits, 'edit_stored_message').mutation, 'mutation');
    expect(editWins(null, mutation.edited_at as string)).toBe(true);
  });
});

describe('edits with no stored target (mutations.md §3.4)', () => {
  it('inserts when the target is at or after the capture floor', () => {
    const testCase = byName(edits, 'edit_for_unstored_target_inserts');
    expect(testCase.target_record).toBeNull();
    expect(testCase.expect_result).toBe('inserted');
    expect(testCase.expect_capture_source).toBe('live_event');
    expect(testCase.expect_record_count).toBe(1);
  });

  it('does not let a late original regress the inserted text', () => {
    const late = byName(edits, 'late_original_does_not_regress_inserted_edit');
    const inserted = asRecord(
      byName(edits, 'edit_for_unstored_target_inserts').mutation,
      'mutation',
    );
    expect(late.expect_result).toBe('unchanged');
    expect(late.expect_text).toBe(inserted.new_text);
    expect(late.expect_record_count).toBe(1);
  });

  it('ignores an edit below the capture floor rather than backfilling', () => {
    const testCase = byName(edits, 'edit_below_capture_floor_is_ignored');
    expect(testCase.expect_result).toBe('ignored');
    expect(testCase.expect_record_count).toBe(0);
  });

  it('denies an unenrolled-channel mutation before any storage lookup', () => {
    // Ordering matters: a mutation that reaches storage first can be used to
    // probe what Gist holds (authorization.md §6).
    const testCase = byName(edits, 'edit_in_unenrolled_channel_is_denied_before_lookup');
    expect(testCase.expect_result).toBe('ignored');
    expect(testCase.expect_storage_lookups).toBe(0);
  });
});

describe('delete-ignore (CM-FR-019, D015) — accepted risk, pinned by test', () => {
  it.each(deleteMutations.map((entry) => entry.name as string))('%s returns ignored', (name) => {
    expect(byName(deletes, name).expect_result).toBe('ignored');
  });

  it('leaves the record, embedding, summary, and observations untouched', () => {
    const testCase = byName(deletes, 'delete_is_ignored');
    expect(testCase.expect_record_unchanged).toBe(true);
    expect(testCase.expect_embedding_unchanged).toBe(true);
    expect(testCase.expect_summary_unchanged).toBe(true);
    expect(testCase.expect_observations_unchanged).toBe(true);
  });

  it('calls no delete primitive anywhere in the delete path', () => {
    for (const entry of deletes) {
      if (entry.expect_delete_primitive_calls !== undefined) {
        expect(entry.expect_delete_primitive_calls).toBe(0);
      }
    }
  });

  it('writes no tombstone', () => {
    // The v1 tombstone existed to suppress redelivery after a hard delete.
    // Nothing is deleted here, so a tombstone would only suppress a legitimate
    // redelivery of a message Gist still holds (mutations.md §4).
    expect(byName(deletes, 'delete_is_ignored').expect_tombstone_written).toBe(false);
  });

  it('does not suppress a later redelivery of the "deleted" message', () => {
    const testCase = byName(deletes, 'delete_then_redelivery_is_not_suppressed');
    expect(testCase.expect_suppressed).toBe(false);
    expect(testCase.expect_upsert_result).toBe('unchanged');
    expect(testCase.expect_record_count).toBe(1);
  });

  it('succeeds for a message that was never stored', () => {
    const testCase = byName(deletes, 'delete_for_unstored_message_is_success');
    expect(testCase.expect_error).toBe(false);
  });

  it('records the risk as an accepted, temporary, reversible decision', () => {
    expect(risk.requirement).toBe('CM-FR-019');
    expect(risk.decision).toBe('D015');
    expect(risk.temporary).toBe(true);
    expect(risk.phases).toEqual(['P06', 'P07']);
    expect(risk.statement).toContain('remains recallable');
    expect(risk.reversal_requires).toContain('new approved decision');
    expect(asArray(risk.remaining_mitigations, 'remaining_mitigations').length).toBeGreaterThan(0);
  });
});
