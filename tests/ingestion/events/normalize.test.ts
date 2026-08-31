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
  responsePrecheckDenyReason,
  sentAtFrom,
} from '../../../src/ingestion/events/index.js';
import type {
  NormalizedEvent,
  NormalizationResult,
} from '../../../src/ingestion/events/types.js';
import {
  FULL_MEMBER,
  SYNTHETIC,
  appMessage,
  botMessage,
  channelMessage,
  deleteEvent,
  directMessage,
  editEvent,
  envelope,
  gistMessage,
  kiloMessage,
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

interface SenderContractFixture {
  contract_version: string;
  config: {
    gist_bot_user_id: string;
    kilo_bot_id: string;
    kilo_app_id: string;
  };
  cases: Array<{
    name: string;
    raw: Record<string, unknown>;
    expect_sender: Record<string, unknown>;
    expect_captured: boolean;
    expect_capture_deny_reason?: string;
  }>;
}

function loadJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  ) as T;
}

const fixture = loadJson<Fixture>(
  '../../../docs/architecture/contracts/fixtures/slack-events.v1.json',
);
const senderFixture = loadJson<SenderContractFixture>(
  '../../contracts/channel-memory/fixtures/senders.v1.json',
);

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

describe('all channel sender classes (message-record.md §1–2)', () => {
  for (const testCase of senderFixture.cases) {
    it(`normalizes frozen sender fixture: ${testCase.name}`, () => {
      const expected = testCase.expect_sender;
      const senderClass = String(expected.sender_class);
      const senderType =
        senderClass === 'human' || senderClass === 'app' || senderClass === 'system'
          ? senderClass
          : 'bot';
      const result = normalize(
        envelope(channelMessage(testCase.raw)),
        makeContext({
          bot_user_id: senderFixture.config.gist_bot_user_id,
          kilo_bot_id: senderFixture.config.kilo_bot_id,
          kilo_app_id: senderFixture.config.kilo_app_id,
          sender_attributes: {
            sender_type: senderType,
            is_external: Boolean(expected.is_external),
            is_guest: Boolean(expected.is_guest),
            is_deactivated: false,
            display_name: String(expected.sender_display_name),
          },
        }),
      );

      if (!testCase.expect_captured) {
        expect(result).toEqual({ skip: testCase.expect_capture_deny_reason });
        return;
      }

      const event = expectEvent(result);
      expect(event.sender).toEqual(expected);
      expect(event.sender_class).toBe(expected.sender_class);
      expect(event.sender.sender_id).toBe(event.sender_id);
      expect(event.sender).not.toHaveProperty('respond_allowed');
    });
  }

  it('uses user, then bot_id, then app_id for sender identity', () => {
    const bot = expectEvent(
      normalize(
        envelope(botMessage({ user: undefined, username: 'synthetic-hook' })),
        makeContext({ sender_attributes: undefined }),
      ),
    );
    const app = expectEvent(
      normalize(envelope(appMessage()), makeContext({ sender_attributes: undefined })),
    );
    expect(bot.sender_id).toBe(SYNTHETIC.otherBotId);
    expect(bot.sender.username).toBe('synthetic-hook');
    expect(app.sender_id).toBe(SYNTHETIC.appId);
  });

  it('applies Gist and Kilo ordering before generic bot/app rules', () => {
    const gist = expectEvent(normalize(envelope(gistMessage()), makeContext()));
    const kilo = expectEvent(
      normalize(
        envelope(kiloMessage({ user: undefined, bot_id: undefined })),
        makeContext(),
      ),
    );
    expect(gist.sender_class).toBe('gist');
    expect(kilo.sender_class).toBe('kilo');
  });

  it('rejects a sender with no user, bot, or app identity', () => {
    const result = normalize(
      envelope(channelMessage({ user: undefined, username: 'not-an-identity' })),
      makeContext(),
    );
    expect(result).toEqual({ skip: 'malformed_event' });
  });
});

describe('capture and response stay separate (capture-policy.md)', () => {
  it('preserves syntactic addressing for a bot but denies response precheck', () => {
    const event = expectEvent(
      normalize(
        envelope(botMessage({ text: `<@${SYNTHETIC.botUserId}> deploy complete` })),
        makeContext(),
      ),
    );
    expect(event.addressed_to_gist).toBe(true);
    expect(event.class).toBe('addressed');
    expect(responsePrecheckDenyReason(event)).toBe('non_human_sender');
  });

  it('denies self-authored traffic before addressing', () => {
    const event = expectEvent(
      normalize(
        envelope(gistMessage({ text: `<@${SYNTHETIC.botUserId}> synthetic self mention` })),
        makeContext(),
      ),
    );
    expect(event.addressed_to_gist).toBe(true);
    expect(responsePrecheckDenyReason(event)).toBe('self_authored');
  });

  it('returns no early denial only for addressed human traffic', () => {
    const addressed = expectEvent(normalize(envelope(mentionMessage()), makeContext()));
    const ambient = expectEvent(normalize(envelope(channelMessage()), makeContext()));
    expect(responsePrecheckDenyReason(addressed)).toBeNull();
    expect(responsePrecheckDenyReason(ambient)).toBe('not_addressed');
  });

  it('retains v1 non-human skips for DMs', () => {
    const bot = normalize(
      envelope(
        directMessage({
          ...botMessage(),
          channel: SYNTHETIC.dmConversation,
          channel_type: 'im',
        }),
      ),
      makeContext(),
    );
    const gist = normalize(
      envelope(
        directMessage({
          ...gistMessage(),
          channel: SYNTHETIC.dmConversation,
          channel_type: 'im',
        }),
      ),
      makeContext(),
    );
    expect(bot).toEqual({ skip: 'bot_message' });
    expect(gist).toEqual({ skip: 'own_message' });
  });
});

describe('file and link metadata (CM-FR-009)', () => {
  it('normalizes attachment-only messages and freezes metadata', () => {
    const event = expectEvent(
      normalize(
        envelope(
          appMessage({
            text: '',
            files: [
              { id: 'F0SYNTH001', name: 'build.txt', mimetype: 'text/plain', size: 2048 },
            ],
            links: [
              { url: 'https://build.example.invalid/412', domain: 'build.example.invalid' },
            ],
          }),
        ),
        makeContext(),
      ),
    );
    expect(event.text).toBe('');
    expect(event.files).toEqual([
      { file_id: 'F0SYNTH001', name: 'build.txt', mimetype: 'text/plain', size_bytes: 2048 },
    ]);
    expect(event.links).toEqual([
      { url: 'https://build.example.invalid/412', domain: 'build.example.invalid' },
    ]);
    expect(Object.isFrozen(event.files)).toBe(true);
    expect(Object.isFrozen(event.files[0])).toBe(true);
  });

  it('extracts link metadata from Slack attachments without fetching content', () => {
    const event = expectEvent(
      normalize(
        envelope(
          channelMessage({
            attachments: [{ original_url: 'https://status.example.invalid/build/412' }],
          }),
        ),
        makeContext(),
      ),
    );
    expect(event.links).toEqual([
      { url: 'https://status.example.invalid/build/412', domain: 'status.example.invalid' },
    ]);
  });

  it('rejects malformed file or link metadata', () => {
    const malformedFile = normalize(
      envelope(channelMessage({ files: [{ id: 'F0SYNTH001', name: 'missing-fields' }] })),
      makeContext(),
    );
    const malformedLink = normalize(
      envelope(channelMessage({ links: [{ url: 'not-a-url', domain: 'example.invalid' }] })),
      makeContext(),
    );
    expect(malformedFile).toEqual({ skip: 'malformed_event' });
    expect(malformedLink).toEqual({ skip: 'malformed_event' });
  });

  it('captures wholly empty channel messages to preserve sequence', () => {
    const event = expectEvent(normalize(envelope(channelMessage({ text: '' })), makeContext()));
    expect(event.text).toBe('');
    expect(event.files).toEqual([]);
    expect(event.links).toEqual([]);
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
    expect(absent.thread_root_ts).toBe(expect_same_thread_root_ts);
    expect(selfReferential.thread_root_ts).toBe(expect_same_thread_root_ts);
    expect(absent.is_thread_reply).toBe(false);
    expect(selfReferential.is_thread_reply).toBe(false);
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
    expect(event.thread_root_ts).toBe(SYNTHETIC.rootTs);
    expect(event.is_thread_reply).toBe(true);
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

  it('normalizes replacement file/link metadata on edits', () => {
    const event = expectEvent(
      normalize(
        envelope(
          editEvent({
            message: {
              type: 'message',
              user: SYNTHETIC.user,
              text: 'replacement metadata',
              ts: SYNTHETIC.ambientTs,
              files: [
                { id: 'F0SYNTH002', name: 'revised.txt', mimetype: 'text/plain', size: 512 },
              ],
              links: [
                { url: 'https://edit.example.invalid/revised', domain: 'edit.example.invalid' },
              ],
            },
          }),
        ),
        makeContext(),
      ),
    );

    expect(event.mutation?.new_files).toEqual(event.files);
    expect(event.mutation?.new_links).toEqual(event.links);
    expect(event.files[0]?.file_id).toBe('F0SYNTH002');
    expect(event.links[0]?.domain).toBe('edit.example.invalid');
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

  it('normalizes an edit from Gist without making it response-eligible', () => {
    const event = expectEvent(
      normalize(
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
      ),
    );
    expect(event.sender_class).toBe('gist');
    expect(event.mutation?.kind).toBe('edit');
    expect(responsePrecheckDenyReason(event)).toBe('self_authored');
  });
});

describe('channel-memory normalization skips', () => {
  const cases: ReadonlyArray<{
    label: string;
    raw: Record<string, unknown>;
    expected: string;
  }> = [
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

  it('preserves non-superseded v1 skip reasons', () => {
    const superseded = new Set(['bot_message', 'app_message', 'own_message', 'empty_text']);
    const normalizerOwned = fixture.skips.filter(
      (entry) =>
        entry.produced_by !== 'authorization' &&
        !superseded.has(String(entry.expect_skip)),
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

  it('uses a resolved non-human type without suppressing channel capture', () => {
    const event = expectEvent(
      normalize(
        envelope(channelMessage()),
        makeContext({ sender_attributes: { ...FULL_MEMBER, sender_type: 'bot' } }),
      ),
    );
    expect(event.sender_class).toBe('bot');
    expect(responsePrecheckDenyReason(event)).toBe('non_human_sender');
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
