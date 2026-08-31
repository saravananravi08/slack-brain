/**
 * capture-policy.md — capture eligibility separated from response eligibility
 * (CM-FR-012, CM-FR-013, CM-NFR-006, CM-INV-08, CM-INV-09).
 *
 * This is the suite that has to fail if someone ever wires the two decisions
 * together, so the separation assertions run over the whole matrix rather than
 * over a sampled row.
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, byName, loadFixture } from './helpers.js';
import { responseDenyForSenderClass, type ChannelSenderClass } from './reference-rules.js';

const fixture = loadFixture('capture-policy.v1.json');
const matrix = asArray(fixture.matrix, 'matrix');
const separation = asRecord(fixture.separation_assertions, 'separation_assertions');

const CAPTURE_DENY_REASONS = [
  'channel_not_enrolled',
  'before_capture_floor',
  'unapproved_workspace',
  'not_a_channel',
  'system_subtype',
  'malformed_event',
  'duplicate_delivery',
] as const;

describe('capture decision shape', () => {
  it.each(matrix.map((row) => row.name as string))('%s pairs capture with a valid reason', (name) => {
    const row = byName(matrix, name);
    if (row.expect_capture === true) {
      expect(row.expect_capture_reason).toBeNull();
      expect(row.expect_boundary_id).toMatch(/^ch:/);
    } else {
      expect(CAPTURE_DENY_REASONS).toContain(row.expect_capture_reason);
      expect(row.expect_boundary_id).toBeNull();
    }
  });

  it('names exactly one boundary per captured row (CM-INV-01)', () => {
    for (const row of matrix.filter((candidate) => candidate.expect_capture === true)) {
      expect(typeof row.expect_boundary_id).toBe('string');
      expect(Array.isArray(row.expect_boundary_id)).toBe(false);
    }
  });

  it('exercises every capture deny reason', () => {
    const used = new Set(
      matrix
        .filter((row) => row.expect_capture === false)
        .map((row) => row.expect_capture_reason as string),
    );
    for (const reason of CAPTURE_DENY_REASONS) {
      expect([...used], `no fixture exercises ${reason}`).toContain(reason);
    }
  });
});

describe('capture takes no sender-class input (D014, CM-FR-007)', () => {
  const enrolledChannelRows = matrix.filter(
    (row) =>
      row.expect_capture === true ||
      // rows denied for a reason unrelated to who sent the message
      ['before_capture_floor', 'channel_not_enrolled', 'unapproved_workspace'].includes(
        row.expect_capture_reason as string,
      ),
  );

  it('captures every sender class that reaches an enrolled channel', () => {
    const capturedClasses = new Set(
      enrolledChannelRows
        .filter((row) => row.expect_capture === true)
        .map((row) => row.sender_class as string),
    );
    for (const senderClass of ['human', 'gist', 'kilo', 'bot', 'app']) {
      expect([...capturedClasses], `${senderClass} is not captured`).toContain(senderClass);
    }
  });

  it('denies capture only for reasons that are not about the sender', () => {
    // If a capture denial ever cites who sent the message, the v1 skip has
    // come back and D014 is broken.
    for (const row of matrix.filter((candidate) => candidate.expect_capture === false)) {
      expect(row.expect_capture_reason).not.toBe('non_human_sender');
      expect(row.expect_capture_reason).not.toBe('self_authored');
      expect(row.expect_capture_reason).not.toBe('bot_or_app_sender');
    }
  });

  it('captures an attachment-only message that the v1 empty_text skip would drop', () => {
    const withFile = byName(matrix, 'empty_text_with_file_is_captured');
    const withoutFile = byName(matrix, 'empty_text_no_attachment_is_still_captured');
    expect(withFile.expect_capture).toBe(true);
    expect(withoutFile.expect_capture).toBe(true);
    expect(withFile.expect_capture_reason).toBeNull();
  });
});

describe('CM-INV-08 — capture never implies response', () => {
  const nonHumanClasses = separation.no_non_human_class_may_respond as string[];

  it.each(matrix.map((row) => row.name as string))('%s never lets a non-human respond', (name) => {
    const row = byName(matrix, name);
    if (row.sender_class !== null && nonHumanClasses.includes(row.sender_class as string)) {
      expect(row.expect_respond_allowed).toBe(false);
      expect(row.expect_response_reason).toBe(
        responseDenyForSenderClass(row.sender_class as ChannelSenderClass),
      );
    }
  });

  it('denies a self-authored message even when it addresses Gist', () => {
    // The tightest loop available: Gist mentioning Gist. self_authored must
    // deny first, before any policy evaluation.
    const row = byName(matrix, 'gist_self_addressed_channel_a');
    expect(row.addressed_to_gist).toBe(true);
    expect(row.expect_capture).toBe(true);
    expect(row.expect_respond_allowed).toBe(false);
    expect(row.expect_response_reason).toBe('self_authored');
  });

  it('denies a bot that addresses Gist, so bot-to-bot cannot start', () => {
    for (const name of ['kilo_addressed_channel_a', 'other_bot_addressed_channel_b']) {
      const row = byName(matrix, name);
      expect(row.addressed_to_gist).toBe(true);
      expect(row.expect_capture).toBe(true);
      expect(row.expect_respond_allowed).toBe(false);
      expect(row.expect_response_reason).toBe('non_human_sender');
    }
  });

  it('allows a response only for an addressed human', () => {
    for (const row of matrix.filter((candidate) => candidate.expect_respond_allowed === true)) {
      expect(row.sender_class).toBe('human');
      expect(row.addressed_to_gist).toBe(true);
      expect(row.expect_response_reason).toBeNull();
    }
  });

  it('keeps eligibility fields out of the capture decision', () => {
    // The fixture states which fields a CaptureDecision may not carry; the
    // contract states it in the type. Both have to say the same thing.
    for (const field of separation.capture_decision_forbidden_fields as string[]) {
      expect(['addressed_to_gist', 'sender_class', 'respond_allowed', 'scope', 'policy']).toContain(
        field,
      );
    }
    expect(separation.response_decision_forbidden_inputs).toContain('CaptureDecision');
  });
});

describe('CM-INV-09 — the capture path is silent (CM-FR-012)', () => {
  it.each(matrix.map((row) => row.name as string))('%s emits no outbound action', (name) => {
    expect(byName(matrix, name).expect_outbound_actions_from_capture).toEqual([]);
  });

  it('asserts silence over every row, including bot and app senders', () => {
    expect(separation.expect_every_capture_row_has_zero_outbound_actions).toBe(true);
    const botRows = matrix.filter((row) =>
      ['kilo', 'bot', 'app', 'gist'].includes(row.sender_class as string),
    );
    expect(botRows.length).toBeGreaterThan(0);
    for (const row of botRows) {
      expect(row.expect_outbound_actions_from_capture).toEqual([]);
    }
  });

  it('cannot reach generation from a malformed bot/app event (CM-NFR-006)', () => {
    const row = byName(matrix, 'malformed_bot_event');
    expect(row.expect_capture).toBe(false);
    expect(row.expect_capture_reason).toBe('malformed_event');
    expect(row.expect_respond_allowed).toBe(false);
    expect(row.expect_generation_calls).toBe(0);
    expect(row.expect_outbound_actions_from_capture).toEqual([]);
  });
});

describe('boundary and workspace gating', () => {
  it('rejects a DM conversation — this set has no DM surface', () => {
    const row = byName(matrix, 'dm_conversation_is_out_of_scope');
    expect(row.expect_capture).toBe(false);
    expect(row.expect_capture_reason).toBe('not_a_channel');
  });

  it('rejects an unapproved workspace before anything else', () => {
    const row = byName(matrix, 'wrong_workspace');
    expect(row.expect_capture_reason).toBe('unapproved_workspace');
    expect(row.expect_boundary_id).toBeNull();
  });

  it('covers both channels in the matrix', () => {
    const channels = new Set(matrix.map((row) => row.channel_id as string));
    expect(channels).toContain('C0CHANTESTA');
    expect(channels).toContain('C0CHANTESTB');
  });
});
