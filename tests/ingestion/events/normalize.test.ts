/**
 * Normalization against the frozen event contract.
 *
 * Drives docs/architecture/contracts/fixtures/slack-events.v1.json —
 * classification, both thread-root encodings, the timestamp precision pair,
 * mutations, and every skip reason the normalizer owns.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EVENT_CONTRACT_VERSION,
  isSkip,
  normalize,
  normalizeThreadTs,
  sentAtFrom,
} from '../../../src/ingestion/events/index.js';
import type {
  NormalizedEvent,
  NormalizationResult,
} from '../../../src/ingestion/events/types.js';
import {
  FULL_MEMBER,
  SYNTHETIC,
  channelMessage,
  deleteEvent,
  directMessage,
  editEvent,
  envelope,
  makeContext,
  mentionMessage,
} from './helpers.js';

interface Fixture {
  contract_version: string;
  classification: Array<{
    name: string;
    expect_class: string;
    event: Record<string, unknown>;
  }>;
  thread_root_encodings: {
    encoding_a_absent: { message_ts: string; thread_ts: string | null };
    encoding_b_self_referential: { message_ts: string; thread_ts: string | null };
    expect_same_thread_root_ts: string;
  };
  timestamp_precision_pair: { a: string; b: string };
  skips: Array<Record<string, unknown>>;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../docs/architecture/contracts/fixtures/slack-events.v1.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as Fixture;

function expectEvent(result: NormalizationResult): NormalizedEvent {
  if (isSkip(result)) {
    throw new Error(`expected a normalized event, got skip:${result.skip}`);
  }
  return result;
}

it('implements the frozen contract version', () => {
  expect(fixture.contract_version).toBe('1.0.0');
  expect(EVENT_CONTRACT_VERSION).toBe('1.0.0');
});

describe('classification (slack-event.md §1)', () => {
  it('classifies a DM as addressed', () => {
    const event = expectEvent(normalize(envelope(directMessage()), makeContext()));
    expect(event.class).toBe('addressed');
    expect(event.addressed_to_gist).toBe(true);
    expect(event.conversation_type).toBe('dm');
  });

  it('classifies a channel mention as addressed', () => {
    const event = expectEvent(normalize(envelope(mentionMessage()), makeContext()));
    expect(event.class).toBe('addressed');
    expect(event.addressed_to_gist).toBe(true);
  });

  it('classifies the message copy of a mention as addressed too', () => {
    // Slack delivers a channel mention as both `app_mention` and `message`.
    // Classifying on event type alone would make whichever copy wins the
    // dedupe race look ambient (spike §3).
    const event = expectEvent(
      normalize(
        envelope(channelMessage({ text: `<@${SYNTHETIC.botUserId}> what changed?` })),
        makeContext(),
      ),
    );
    expect(event.class).toBe('addressed');
  });

  it('classifies an ordinary channel message as ambient', () => {
    const event = expectEvent(normalize(envelope(channelMessage()), makeContext()));
    expect(event.class).toBe('ambient');
    expect(event.addressed_to_gist).toBe(false);
  });

  it('classifies a message in a subscribed thread as addressed', () => {
    // T401 §5 — subscription, not content, is what makes a follow-up
    // addressed. The caller supplies the subscription fact.
    const event = expectEvent(
      normalize(envelope(channelMessage()), makeContext({ subscribed_thread: true })),
    );
    expect(event.class).toBe('addressed');
  });

  it('classifies an edit and a delete as mutations', () => {
    const edit = expectEvent(normalize(envelope(editEvent()), makeContext()));
    const remove = expectEvent(normalize(envelope(deleteEvent()), makeContext()));
    expect(edit.class).toBe('mutation');
    expect(remove.class).toBe('mutation');
    expect(edit.addressed_to_gist).toBe(false);
    expect(remove.addressed_to_gist).toBe(false);
  });

  it('does not let a subscription turn a mutation into addressed traffic', () => {
    const event = expectEvent(
      normalize(envelope(editEvent()), makeContext({ subscribed_thread: true })),
    );
    expect(event.class).toBe('mutation');
  });

  it('reproduces every classification case in the contract fixture', () => {
    for (const testCase of fixture.classification) {
      const expected = testCase.event;
      const isDm = expected.conversation_type === 'dm';
      const raw = envelope(
        {
          type: 'message',
          channel: expected.channel_id,
          channel_type: isDm ? 'im' : 'channel',
          user: expected.sender_id,
          text:
            expected.addressed_to_gist === true && !isDm
              ? `<@${SYNTHETIC.botUserId}> ${String(expected.text)}`
              : String(expected.text),
          ts: expected.message_ts,
          event_ts: expected.message_ts,
          team: expected.workspace_id,
          ...(expected.thread_ts === null ? {} : { thread_ts: expected.thread_ts }),
        },
        { event_id: expected.event_id },
      );

      const actual = expectEvent(normalize(raw, makeContext()));

      expect(actual.class, testCase.name).toBe(testCase.expect_class);
      expect(actual.workspace_id, testCase.name).toBe(expected.workspace_id);
      expect(actual.channel_id, testCase.name).toBe(expected.channel_id);
      expect(actual.message_ts, testCase.name).toBe(expected.message_ts);
      expect(actual.event_id, testCase.name).toBe(expected.event_id);
      expect(actual.conversation_type, testCase.name).toBe(expected.conversation_type);
      expect(actual.thread_ts, testCase.name).toBe(expected.thread_ts);
      expect(actual.sender_id, testCase.name).toBe(expected.sender_id);
      expect(actual.sender_type, testCase.name).toBe(expected.sender_type);
      expect(actual.sender_is_external, testCase.name).toBe(expected.sender_is_external);
      expect(actual.sender_is_guest, testCase.name).toBe(expected.sender_is_guest);
      expect(actual.sent_at, testCase.name).toBe(expected.sent_at);
      expect(actual.addressed_to_gist, testCase.name).toBe(expected.addressed_to_gist);
    }
  });
});

describe('identity fields (slack-event.md §2)', () => {
  it('derives sent_at from message_ts without a float round-trip', () => {
    expect(sentAtFrom('1735689600.000100')).toBe('2025-01-01T00:00:00.000Z');
    expect(sentAtFrom('1735689700.000100')).toBe('2025-01-01T00:01:40.000Z');
    expect(sentAtFrom('1735689800.000100')).toBe('2025-01-01T00:03:20.000Z');
    expect(sentAtFrom('not-a-timestamp')).toBeNull();
  });

  it('collapses both Slack root encodings to null', () => {
    const { encoding_a_absent, encoding_b_self_referential, expect_same_thread_root_ts } =
      fixture.thread_root_encodings;

    expect(
      normalizeThreadTs(encoding_a_absent.thread_ts, encoding_a_absent.message_ts),
    ).toBeNull();
    expect(
      normalizeThreadTs(
        encoding_b_self_referential.thread_ts,
        encoding_b_self_referential.message_ts,
      ),
    ).toBeNull();

    const absent = expectEvent(
      normalize(
        envelope(channelMessage({ ts: expect_same_thread_root_ts })),
        makeContext(),
      ),
    );
    const selfReferential = expectEvent(
      normalize(
        envelope(
          channelMessage({
            ts: expect_same_thread_root_ts,
            thread_ts: expect_same_thread_root_ts,
          }),
        ),
        makeContext(),
      ),
    );

    expect(absent.thread_ts).toBeNull();
    expect(selfReferential.thread_ts).toBeNull();
    expect(absent.message_ts).toBe(selfReferential.message_ts);
  });

  it('keeps a genuine reply thread_ts', () => {
    const event = expectEvent(
      normalize(
        envelope(channelMessage({ ts: SYNTHETIC.replyTs, thread_ts: SYNTHETIC.rootTs })),
        makeContext(),
      ),
    );
    expect(event.thread_ts).toBe(SYNTHETIC.rootTs);
  });

  it('keeps the timestamp precision pair distinct', () => {
    const { a, b } = fixture.timestamp_precision_pair;
    const first = expectEvent(
      normalize(envelope(channelMessage({ ts: a, event_ts: a })), makeContext()),
    );
    const second = expectEvent(
      normalize(envelope(channelMessage({ ts: b, event_ts: b })), makeContext()),
    );

    expect(first.message_ts).toBe(a);
    expect(second.message_ts).toBe(b);
    expect(first.message_ts).not.toBe(second.message_ts);
    // The pair is equal as floats, which is exactly why the string is kept.
    expect(Number(a)).toBe(Number(b));
  });

  it('resolves the conversation type from the channel ID when channel_type is absent', () => {
    const dm = expectEvent(
      normalize(
        envelope(channelMessage({ channel: SYNTHETIC.dmConversation, channel_type: undefined })),
        makeContext(),
      ),
    );
    const privateChannel = expectEvent(
      normalize(
        envelope(channelMessage({ channel: SYNTHETIC.privateChannel, channel_type: undefined })),
        makeContext(),
      ),
    );

    expect(dm.conversation_type).toBe('dm');
    expect(privateChannel.conversation_type).toBe('channel');
  });

  it('takes the workspace from the envelope when the inner event omits it', () => {
    const event = expectEvent(
      normalize(envelope(channelMessage({ team: undefined })), makeContext()),
    );
    expect(event.workspace_id).toBe(SYNTHETIC.workspace);
  });
});

describe('mutations (slack-event.md §4, D005)', () => {
  it('addresses an edit at the message it changes, not at the edit event', () => {
    const event = expectEvent(normalize(envelope(editEvent()), makeContext()));

    expect(event.message_ts).toBe(SYNTHETIC.ambientTs);
    expect(event.mutation?.kind).toBe('edit');
    expect(event.mutation?.target_ts).toBe(SYNTHETIC.ambientTs);
    expect(event.mutation?.new_text).toBe('rollout window moved to Wednesday 09:00-11:00 UTC');
    expect(event.text).toBe('rollout window moved to Wednesday 09:00-11:00 UTC');
    expect(event.mutation?.edited_at).toBe(sentAtFrom(SYNTHETIC.mutationTs));
  });

  it('carries no text on a delete, and no new_text', () => {
    // slack-event.md §4 — tombstones hold no message text. Ever.
    const event = expectEvent(normalize(envelope(deleteEvent()), makeContext()));

    expect(event.mutation?.kind).toBe('delete');
    expect(event.mutation?.target_ts).toBe(SYNTHETIC.ambientTs);
    expect(event.mutation?.new_text).toBeUndefined();
    expect(event.text).toBe('');
    expect(JSON.stringify(event)).not.toContain('rollout window is Tuesday');
  });

  it('does not skip a delete for empty text', () => {
    const result = normalize(envelope(deleteEvent()), makeContext());
    expect(isSkip(result)).toBe(false);
  });

  it('takes the sender of a delete from the previous message', () => {
    const event = expectEvent(normalize(envelope(deleteEvent()), makeContext()));
    expect(event.sender_id).toBe(SYNTHETIC.user);
  });

  it('recovers the delete target from previous_message when deleted_ts is absent', () => {
    const event = expectEvent(
      normalize(envelope(deleteEvent({ deleted_ts: undefined })), makeContext()),
    );
    expect(event.mutation?.target_ts).toBe(SYNTHETIC.ambientTs);
  });

  it('skips a mutation whose target cannot be identified', () => {
    const result = normalize(
      envelope(deleteEvent({ deleted_ts: undefined, previous_message: undefined })),
      makeContext(),
    );
    expect(result).toEqual({ skip: 'malformed_event' });
  });

  it('skips an edit from Gist itself', () => {
    // A streamed reply renders through post-and-edit; re-ingesting those would
    // feed Gist its own output.
    const result = normalize(
      envelope(
        editEvent({
          message: {
            type: 'message',
            user: SYNTHETIC.botUserId,
            text: 'edited reply',
            ts: SYNTHETIC.ambientTs,
          },
        }),
      ),
      makeContext(),
    );
    expect(result).toEqual({ skip: 'own_message' });
  });
});

describe('skips the normalizer owns (slack-event.md §5)', () => {
  const cases: ReadonlyArray<{
    label: string;
    raw: Record<string, unknown>;
    expected: string;
  }> = [
    {
      label: 'bot message by bot_id',
      raw: channelMessage({ user: undefined, bot_id: SYNTHETIC.otherBotId }),
      expected: 'bot_message',
    },
    {
      label: 'bot message by subtype',
      raw: channelMessage({ subtype: 'bot_message' }),
      expected: 'bot_message',
    },
    {
      label: 'app message by subtype',
      raw: channelMessage({ subtype: 'app_message' }),
      expected: 'app_message',
    },
    {
      label: 'app message by app_id',
      raw: channelMessage({ user: undefined, app_id: 'A0SYNTHAPP' }),
      expected: 'app_message',
    },
    {
      label: 'own message by user id',
      raw: channelMessage({ user: SYNTHETIC.botUserId }),
      expected: 'own_message',
    },
    {
      label: 'own message by bot id',
      raw: channelMessage({ user: undefined, bot_id: SYNTHETIC.botId }),
      expected: 'own_message',
    },
    {
      label: 'slackbot system user',
      raw: channelMessage({ user: 'USLACKBOT' }),
      expected: 'system_subtype',
    },
    {
      label: 'channel join subtype',
      raw: channelMessage({ subtype: 'channel_join' }),
      expected: 'system_subtype',
    },
    {
      label: 'tombstone subtype',
      raw: channelMessage({ subtype: 'tombstone' }),
      expected: 'system_subtype',
    },
    {
      label: 'empty text',
      raw: channelMessage({ text: '' }),
      expected: 'empty_text',
    },
    {
      label: 'whitespace-only text',
      raw: channelMessage({ text: '   \n  ' }),
      expected: 'empty_text',
    },
    {
      label: 'missing channel',
      raw: channelMessage({ channel: undefined }),
      expected: 'malformed_event',
    },
    {
      label: 'missing sender',
      raw: channelMessage({ user: undefined }),
      expected: 'malformed_event',
    },
    {
      label: 'non-timestamp ts',
      raw: channelMessage({ ts: 'yesterday' }),
      expected: 'malformed_event',
    },
    {
      label: 'unknown event type',
      raw: { type: 'reaction_added', channel: SYNTHETIC.channel },
      expected: 'malformed_event',
    },
  ];

  for (const testCase of cases) {
    it(`skips ${testCase.label}`, () => {
      const result = normalize(envelope(testCase.raw), makeContext());
      expect(result).toEqual({ skip: testCase.expected });
    });
  }

  it('never returns an authorization skip reason', () => {
    // slack-event.md §5 — `unapproved_*`, `external_user`, and `guest_user`
    // are produced by the guard, not the normalizer.
    const policyReasons = [
      'unapproved_channel',
      'unapproved_workspace',
      'external_user',
      'guest_user',
    ];

    const inputs = [
      envelope(channelMessage({ channel: 'C0UNAPPROV9' })),
      envelope(channelMessage({ team: SYNTHETIC.otherWorkspace })),
      envelope(channelMessage({ user: 'U0EXTERN01' })),
      envelope(channelMessage({ user: 'U0GUEST001' })),
    ];

    for (const input of inputs) {
      const result = normalize(input, makeContext());
      if (isSkip(result)) expect(policyReasons).not.toContain(result.skip);
    }
  });

  it('normalizes an unapproved channel rather than judging it', () => {
    // The guard needs a normalized event to deny; the normalizer has no
    // policy knowledge and must not pre-empt it.
    const event = expectEvent(
      normalize(envelope(channelMessage({ channel: 'C0UNAPPROV9' })), makeContext()),
    );
    expect(event.channel_id).toBe('C0UNAPPROV9');
  });

  it('keeps content-bearing subtypes', () => {
    for (const subtype of ['file_share', 'me_message', 'thread_broadcast']) {
      const result = normalize(envelope(channelMessage({ subtype })), makeContext());
      expect(isSkip(result), subtype).toBe(false);
    }
  });

  it('covers every skip reason the fixture attributes to the normalizer', () => {
    const normalizerOwned = fixture.skips.filter(
      (entry) => entry.produced_by !== 'authorization',
    );
    const covered = new Set(cases.map((testCase) => testCase.expected));
    covered.add('duplicate_delivery'); // asserted in dedupe.test.ts

    for (const entry of normalizerOwned) {
      expect(covered, String(entry.expect_skip)).toContain(String(entry.expect_skip));
    }
  });
});

describe('sender attributes are supplied, never invented', () => {
  it('rejects the event when attributes were not resolved', () => {
    // T401 §7.1 — external / guest / deactivated are not in a Slack message
    // event. Defaulting them to false would present a Slack Connect user to
    // the guard as a full member, so the absence is fail-closed.
    const result = normalize(
      envelope(channelMessage()),
      makeContext({ sender_attributes: undefined }),
    );
    expect(result).toEqual({ skip: 'malformed_event' });
  });

  it('carries the resolved attributes through verbatim', () => {
    const event = expectEvent(
      normalize(
        envelope(channelMessage()),
        makeContext({
          sender_attributes: {
            sender_type: 'human',
            is_external: true,
            is_guest: true,
            is_deactivated: true,
          },
        }),
      ),
    );

    expect(event.sender_is_external).toBe(true);
    expect(event.sender_is_guest).toBe(true);
    expect(event.sender_is_deactivated).toBe(true);
  });

  it('skips when the resolver reports a non-human sender', () => {
    const result = normalize(
      envelope(channelMessage()),
      makeContext({ sender_attributes: { ...FULL_MEMBER, sender_type: 'bot' } }),
    );
    expect(result).toEqual({ skip: 'bot_message' });
  });
});

describe('delivery identity', () => {
  it('takes event_id from the envelope', () => {
    const raw = envelope(channelMessage());
    const event = expectEvent(normalize(raw, makeContext()));
    expect(event.event_id).toBe(raw.event_id);
  });

  it('accepts a delivery id supplied by the caller', () => {
    // The pinned adapter hands a handler the inner event only (spike §6), so a
    // caller working from the Chat SDK passes the captured envelope ID here.
    const event = expectEvent(
      normalize(channelMessage(), makeContext({ delivery_event_id: 'Ev0SYNTHCAP1' })),
    );
    expect(event.event_id).toBe('Ev0SYNTHCAP1');
  });

  it('rejects a bare inner event with no delivery id at all', () => {
    // Fabricating a delivery identity from the message would collapse the two
    // identities slack-event.md §3 keeps apart. The failure is loud and
    // uniform instead: a mis-wired caller skips everything, visibly.
    const result = normalize(channelMessage(), makeContext());
    expect(result).toEqual({ skip: 'malformed_event' });
  });
});

describe('totality and purity', () => {
  it('never throws, whatever it is given', () => {
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      'message',
      [],
      {},
      { type: 'event_callback' },
      { type: 'event_callback', event: null },
      { type: 'message' },
      { type: 'message', channel: 123, ts: {} },
      new Date(),
    ];

    for (const input of garbage) {
      const result = normalize(input, makeContext());
      expect(isSkip(result)).toBe(true);
    }
  });

  it('returns the same result for the same input', () => {
    const raw = envelope(channelMessage());
    expect(normalize(raw, makeContext())).toEqual(normalize(raw, makeContext()));
  });

  it('does not mutate the raw event', () => {
    const raw = envelope(channelMessage());
    const before = JSON.stringify(raw);
    normalize(raw, makeContext());
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('returns a frozen event', () => {
    const event = expectEvent(normalize(envelope(channelMessage()), makeContext()));
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('sets no field from the wall clock', () => {
    // `sent_at` is derived from `message_ts`; a normalizer that reached for
    // Date.now() would produce a different event on every run.
    const raw = envelope(channelMessage());
    const first = expectEvent(normalize(raw, makeContext()));
    const second = expectEvent(normalize(raw, makeContext()));
    expect(first.sent_at).toBe(second.sent_at);
    expect(first.sent_at).toBe(sentAtFrom(SYNTHETIC.ambientTs));
  });
});
