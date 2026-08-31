/**
 * message-record.md §1, §2 — canonical sender metadata for every sender class
 * (CM-FR-007, CM-FR-009).
 */

import { describe, expect, it } from 'vitest';

import { asArray, byName, loadFixture } from './helpers.js';
import {
  classifySender,
  resolveSenderId,
  responseDenyForSenderClass,
  type ChannelSenderClass,
  type RawSenderShape,
  type SenderConfig,
} from './reference-rules.js';

const fixture = loadFixture('senders.v1.json');
const config = fixture.config as unknown as SenderConfig;
const cases = asArray(fixture.cases, 'cases');
const traps = asArray(fixture.ordering_traps, 'ordering_traps');
const malformed = asArray(fixture.malformed, 'malformed');

const ALL_CLASSES: readonly ChannelSenderClass[] = [
  'human',
  'gist',
  'kilo',
  'bot',
  'app',
  'system',
];

const SENDER_FIELDS = [
  'sender_class',
  'sender_id',
  'sender_display_name',
  'bot_id',
  'app_id',
  'username',
  'is_gist_self',
  'is_external',
  'is_guest',
] as const;

describe('sender class coverage', () => {
  it('covers every class in the union', () => {
    const covered = cases.map(
      (testCase) => (testCase.expect_sender as Record<string, unknown>).sender_class,
    );
    for (const senderClass of ALL_CLASSES) {
      expect(covered, `no fixture for sender class ${senderClass}`).toContain(senderClass);
    }
  });

  it.each(cases.map((c) => c.name as string))('%s resolves its class', (name) => {
    const testCase = byName(cases, name);
    const expected = testCase.expect_sender as Record<string, unknown>;
    expect(classifySender(testCase.raw as unknown as RawSenderShape, config)).toBe(
      expected.sender_class,
    );
  });

  it.each(cases.map((c) => c.name as string))('%s carries complete metadata', (name) => {
    const expected = byName(cases, name).expect_sender as Record<string, unknown>;
    for (const field of SENDER_FIELDS) {
      expect(expected, `${name} is missing ${field}`).toHaveProperty(field);
    }
  });

  it.each(cases.map((c) => c.name as string))('%s resolves sender_id by ID, never by name', (name) => {
    const testCase = byName(cases, name);
    const expected = testCase.expect_sender as Record<string, unknown>;
    const raw = testCase.raw as unknown as RawSenderShape;
    expect(resolveSenderId(raw)).toBe(expected.sender_id);
    // A display name is never an identity, even when it is the only label.
    expect(expected.sender_id).not.toBe(expected.sender_display_name);
  });
});

describe('canonical sender carries no eligibility (message-record.md §2)', () => {
  it.each(cases.map((c) => c.name as string))('%s exposes no response decision', (name) => {
    const expected = byName(cases, name).expect_sender as Record<string, unknown>;
    for (const forbidden of [
      'respond_allowed',
      'response_eligible',
      'can_reply',
      'is_response_trigger',
      'capture',
    ]) {
      expect(expected, `${name} leaks eligibility via ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });
});

describe('resolution order (first match wins)', () => {
  it.each(traps.map((t) => t.name as string))('%s', (name) => {
    const trap = byName(traps, name);
    const resolved = classifySender(trap.raw as unknown as RawSenderShape, config);
    expect(resolved).toBe(trap.expect_sender_class);
    expect(resolved).not.toBe(trap.must_not_be);
  });

  it('classifies a Gist self-message as gist even though it looks like a bot', () => {
    // The shortest loop is Gist replying to itself, so rule 1 must beat rule 4
    // regardless of bot_id, app_id, or subtype.
    const trap = byName(traps, 'gist_beats_generic_bot');
    const raw = trap.raw as unknown as RawSenderShape;
    expect(raw.bot_id).not.toBeNull();
    expect(raw.subtype).toBe('bot_message');
    expect(classifySender(raw, config)).toBe('gist');
  });
});

describe('capture and response per class (CM-FR-007, CM-FR-013)', () => {
  it.each(cases.map((c) => c.name as string))('%s captures per contract', (name) => {
    const testCase = byName(cases, name);
    const senderClass = (testCase.expect_sender as Record<string, unknown>)
      .sender_class as ChannelSenderClass;
    // Every class except system lifecycle noise is captured. Sender class is
    // never a capture filter (D014).
    expect(testCase.expect_captured).toBe(senderClass !== 'system');
  });

  it.each(cases.map((c) => c.name as string))('%s response eligibility matches its class', (name) => {
    const testCase = byName(cases, name);
    const senderClass = (testCase.expect_sender as Record<string, unknown>)
      .sender_class as ChannelSenderClass;
    const deny = responseDenyForSenderClass(senderClass);

    expect(testCase.expect_response_eligible_if_addressed).toBe(deny === null);
    if (deny !== null) {
      expect(testCase.expect_response_deny_reason).toBe(deny);
    }
  });

  it('grants response eligibility to exactly one class', () => {
    const eligible = cases.filter((testCase) => testCase.expect_response_eligible_if_addressed);
    expect(eligible).toHaveLength(1);
    expect((eligible[0]?.expect_sender as Record<string, unknown>).sender_class).toBe('human');
  });
});

describe('malformed sender', () => {
  it('denies rather than guessing an identity', () => {
    const testCase = byName(malformed, 'no_identifier_at_all');
    expect(resolveSenderId(testCase.raw as unknown as RawSenderShape)).toBeNull();
    expect(testCase.expect_capture_deny_reason).toBe('malformed_event');
    expect(testCase.expect_response_eligible_if_addressed).toBe(false);
    expect(testCase.expect_outbound_actions).toEqual([]);
  });
});
