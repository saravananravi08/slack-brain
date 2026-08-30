/**
 * The live Slack event normalizer.
 *
 * Contract: docs/architecture/contracts/slack-event.md.
 * Spike: docs/spikes/slack-event-support.md §6 (envelope shapes, identity),
 * §7 (what the adapter does not carry).
 *
 * Properties this module holds to, all asserted by test:
 *
 *  - **Total.** Any input, including malformed or unknown-shape events,
 *    returns a value. It never throws: a Slack schema surprise must not take
 *    down the socket handler.
 *  - **Pure.** No I/O, no storage, no randomness, and no clock — `sent_at` is
 *    derived arithmetically from `message_ts`, never from `Date.now()`.
 *  - **No policy.** `unapproved_*`, `external_user`, and `guest_user` are
 *    authorization's skip reasons (slack-event.md §5). Nothing here decides
 *    them, and the return type cannot express them.
 */

import {
  BOT_SUBTYPES,
  DELETE_SUBTYPE,
  EDIT_SUBTYPE,
  SYSTEM_SUBTYPES,
} from './subtypes.js';
import type {
  ConversationType,
  EventClass,
  MutationDetail,
  NormalizationContext,
  NormalizationResult,
  NormalizedEvent,
  NormalizerSkipReason,
  SenderType,
} from './types.js';

export const EVENT_CONTRACT_VERSION = '1.0.0';

/** Slack's own user ID for system-authored messages. */
const SLACK_SYSTEM_USER_ID = 'USLACKBOT';

const MESSAGE_TS = /^\d+\.\d+$/;

function skip(reason: NormalizerSkipReason): NormalizationResult {
  return Object.freeze({ skip: reason });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Unwrap a Slack `event_callback` envelope, or accept a bare inner event.
 *
 * The envelope is the only place `event_id` exists. T401 §6 measured that the
 * pinned adapter hands the handler `message.raw` — the *inner* event — so a
 * caller working from the Chat SDK handler must pass the envelope ID through
 * `context.delivery_event_id`. Without either, the event cannot carry the
 * delivery identity the contract requires, and it is rejected rather than
 * given a fabricated one.
 */
function unwrap(raw: unknown): {
  event: Record<string, unknown>;
  envelopeEventId: string | null;
  envelopeTeamId: string | null;
} | null {
  const record = asRecord(raw);
  if (record === null) return null;

  if (record.type === 'event_callback') {
    const inner = asRecord(record.event);
    if (inner === null) return null;
    return {
      event: inner,
      envelopeEventId: str(record.event_id),
      envelopeTeamId: str(record.team_id),
    };
  }

  return {
    event: record,
    envelopeEventId: str(record.event_id),
    envelopeTeamId: str(record.team_id),
  };
}

/**
 * RFC 3339 UTC from a Slack ts, without a float round-trip.
 *
 * The seconds and the fractional part are parsed separately: `Number(ts)` on
 * the whole string is exactly the precision loss slack-event.md §2 warns
 * about, and it would make `sent_at` disagree with `message_ts` for
 * high-precision timestamps.
 */
export function sentAtFrom(messageTs: string): string | null {
  if (!MESSAGE_TS.test(messageTs)) return null;

  const [secondsPart, fractionPart = ''] = messageTs.split('.');
  if (secondsPart === undefined) return null;

  const seconds = Number(secondsPart);
  if (!Number.isSafeInteger(seconds)) return null;

  const micros = Number(fractionPart.slice(0, 6).padEnd(6, '0'));
  if (!Number.isFinite(micros)) return null;

  const epochMs = seconds * 1000 + Math.floor(micros / 1000);
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Collapse both Slack root encodings to `null` (slack-event.md §2,
 * identity.md §3).
 *
 * `thread_ts` absent and `thread_ts === message_ts` are the same root. Failing
 * this splits one conversation across two memory threads, which surfaces as
 * "Gist forgot the earlier part of this thread" and is invisible to any test
 * that only exercises one encoding.
 */
export function normalizeThreadTs(
  threadTs: string | null | undefined,
  messageTs: string,
): string | null {
  if (threadTs === null || threadTs === undefined || threadTs === '') return null;
  return threadTs === messageTs ? null : threadTs;
}

function conversationTypeOf(event: Record<string, unknown>): ConversationType | null {
  const channelType = str(event.channel_type);
  if (channelType === 'im') return 'dm';
  if (channelType === 'channel' || channelType === 'group' || channelType === 'private_channel') {
    return 'channel';
  }

  // Fall back to Slack's ID prefixes when `channel_type` is absent, which is
  // the case for `app_mention` and for archive-sourced records.
  const channelId = str(event.channel);
  if (channelId === null) return null;
  if (channelId.startsWith('D')) return 'dm';
  if (channelId.startsWith('C') || channelId.startsWith('G')) return 'channel';
  return null;
}

/**
 * Sender type from the event alone.
 *
 * `bot` and `app` are not cleanly separable in Slack's payloads — an app
 * posting through its bot user carries both `bot_id` and `app_id`. The split
 * only selects between two skip reasons that have the same consequence, so it
 * is decided by the narrower signal and documented rather than guessed at
 * length.
 */
function senderTypeOf(event: Record<string, unknown>): SenderType {
  const user = str(event.user);
  if (user === SLACK_SYSTEM_USER_ID) return 'system';

  const subtype = str(event.subtype);
  if (subtype === 'bot_message') return 'bot';
  if (subtype === 'app_message') return 'app';

  if (str(event.bot_id) !== null) return 'bot';
  if (str(event.app_id) !== null) return 'app';
  return 'human';
}

function isSelf(event: Record<string, unknown>, context: NormalizationContext): boolean {
  const user = str(event.user);
  if (user !== null && user === context.bot_user_id) return true;

  const botId = str(event.bot_id);
  return botId !== null && context.bot_id !== undefined && botId === context.bot_id;
}

/**
 * Does the text address Gist?
 *
 * Text-based, matching what the pinned SDK does (T401 §3): Slack delivers a
 * channel mention as both `app_mention` and `message`, and the `message` copy
 * is addressed traffic too. Checking only the event type would classify the
 * copy that wins the dedupe race as ambient.
 */
function mentionsGist(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

function classify(
  event: Record<string, unknown>,
  context: NormalizationContext,
  conversationType: ConversationType,
  text: string,
): EventClass {
  const subtype = str(event.subtype);
  if (subtype === EDIT_SUBTYPE || subtype === DELETE_SUBTYPE) return 'mutation';

  // A DM to Gist is always addressed: there is nobody else in the room.
  if (conversationType === 'dm') return 'addressed';
  if (event.type === 'app_mention') return 'addressed';
  if (mentionsGist(text, context.bot_user_id)) return 'addressed';
  // T401 §5 — subscription, not content, is what makes a follow-up addressed.
  if (context.subscribed_thread === true) return 'addressed';

  return 'ambient';
}

interface MutationParts {
  readonly detail: MutationDetail;
  /** The message the mutation targets; identity resolves against this. */
  readonly targetTs: string;
  readonly text: string;
  readonly senderId: string | null;
  readonly threadTs: string | null;
}

/**
 * Pull the mutation out of a `message_changed` / `message_deleted` event.
 *
 * `message_ts` for a mutation is the **target** message's ts, not the mutation
 * event's own ts, so `messageKey` addresses the record T404 has to update or
 * delete. The mutation event's ts becomes `edited_at`.
 */
function mutationPartsOf(
  event: Record<string, unknown>,
  kind: 'edit' | 'delete',
): MutationParts | null {
  const inner = asRecord(event.message);
  const previous = asRecord(event.previous_message);

  const eventTs = str(event.event_ts) ?? str(event.ts);
  if (eventTs === null) return null;
  const editedAt = sentAtFrom(eventTs);
  if (editedAt === null) return null;

  if (kind === 'edit') {
    if (inner === null) return null;
    const targetTs = str(inner.ts);
    if (targetTs === null || !MESSAGE_TS.test(targetTs)) return null;
    const newText = typeof inner.text === 'string' ? inner.text : '';
    return {
      detail: { kind, target_ts: targetTs, edited_at: editedAt, new_text: newText },
      targetTs,
      text: newText,
      senderId: str(inner.user) ?? str(previous?.user),
      threadTs: normalizeThreadTs(str(inner.thread_ts), targetTs),
    };
  }

  const targetTs = str(event.deleted_ts) ?? str(previous?.ts);
  if (targetTs === null || !MESSAGE_TS.test(targetTs)) return null;
  return {
    detail: { kind, target_ts: targetTs, edited_at: editedAt },
    targetTs,
    // A delete carries no body, and a tombstone must never hold text
    // (slack-event.md §4). The pre-edit snapshot is deliberately not copied in.
    text: '',
    senderId: str(previous?.user),
    threadTs: normalizeThreadTs(str(previous?.thread_ts), targetTs),
  };
}

/**
 * Normalize one raw Slack event.
 *
 * Accepts either a full `event_callback` envelope or a bare inner event; the
 * envelope form is preferred because it is the only one carrying `event_id`.
 */
export function normalize(
  raw: unknown,
  context: NormalizationContext,
): NormalizationResult {
  const unwrapped = unwrap(raw);
  if (unwrapped === null) return skip('malformed_event');

  const { event, envelopeEventId, envelopeTeamId } = unwrapped;

  if (event.type !== 'message' && event.type !== 'app_mention') {
    // Unknown event types return a skip rather than a partially populated
    // event (slack-event.md §6).
    return skip('malformed_event');
  }

  const subtype = str(event.subtype);
  const isMutation = subtype === EDIT_SUBTYPE || subtype === DELETE_SUBTYPE;

  if (subtype !== null && !isMutation) {
    if (SYSTEM_SUBTYPES.has(subtype)) return skip('system_subtype');
    if (BOT_SUBTYPES.has(subtype)) {
      return skip(subtype === 'app_message' ? 'app_message' : 'bot_message');
    }
  }

  // Self before bot: a message Gist wrote is `own_message`, which is a
  // different count from another bot's traffic (fixtures/slack-events.v1.json).
  const mutationCarrier = isMutation
    ? (asRecord(event.message) ?? asRecord(event.previous_message) ?? event)
    : event;
  if (isSelf(mutationCarrier, context) || isSelf(event, context)) {
    return skip('own_message');
  }

  const senderTypeFromEvent = senderTypeOf(mutationCarrier);
  if (senderTypeFromEvent === 'bot') return skip('bot_message');
  if (senderTypeFromEvent === 'app') return skip('app_message');
  if (senderTypeFromEvent === 'system') return skip('system_subtype');

  const workspaceId = str(event.team) ?? str(event.team_id) ?? envelopeTeamId;
  const channelId = str(event.channel);
  if (workspaceId === null || channelId === null) return skip('malformed_event');

  const conversationType = conversationTypeOf(event);
  if (conversationType === null) return skip('malformed_event');

  const eventId = context.delivery_event_id ?? envelopeEventId;
  if (eventId === null) {
    // slack-event.md §3 requires a delivery identity distinct from the content
    // identity. Fabricating one from the message would collapse the two, so a
    // caller that has not captured the envelope ID gets a loud, uniform
    // failure rather than a silently weakened dedupe.
    return skip('malformed_event');
  }

  const mutation = isMutation
    ? mutationPartsOf(event, subtype === EDIT_SUBTYPE ? 'edit' : 'delete')
    : null;
  if (isMutation && mutation === null) return skip('malformed_event');

  const messageTs = mutation?.targetTs ?? str(event.ts);
  if (messageTs === null || !MESSAGE_TS.test(messageTs)) return skip('malformed_event');

  const senderId = mutation !== null ? mutation.senderId : str(event.user);
  if (senderId === null) return skip('malformed_event');

  const text = mutation !== null ? mutation.text : (typeof event.text === 'string' ? event.text : '');
  // Empty text is only meaningful for a delete; anything else is noise with no
  // content to store (slack-event.md §5).
  if (text.trim() === '' && mutation?.detail.kind !== 'delete') return skip('empty_text');

  const sentAt = sentAtFrom(messageTs);
  if (sentAt === null) return skip('malformed_event');

  const attributes = context.sender_attributes;
  if (attributes === undefined) {
    // T401 §7.1 — external, guest, and deactivated are not in the event. The
    // only alternative to rejecting here is defaulting them to `false`, which
    // would present a Slack Connect user to T203's guard as a full member.
    return skip('malformed_event');
  }

  // The resolver is the authority on sender type; the event-shape check above
  // is only the cheap first pass. A sender the resolver calls non-human is
  // skipped here rather than emitted as a normalized event that authorization
  // would deny a step later.
  if (attributes.sender_type === 'bot') return skip('bot_message');
  if (attributes.sender_type === 'app') return skip('app_message');
  if (attributes.sender_type === 'system') return skip('system_subtype');

  const threadTs =
    mutation !== null ? mutation.threadTs : normalizeThreadTs(str(event.thread_ts), messageTs);

  const eventClass = classify(event, context, conversationType, text);

  const normalized: NormalizedEvent = {
    contract_version: EVENT_CONTRACT_VERSION,
    class: eventClass,
    workspace_id: workspaceId,
    channel_id: channelId,
    message_ts: messageTs,
    event_id: eventId,
    conversation_type: conversationType,
    thread_ts: threadTs,
    sender_id: senderId,
    sender_type: attributes.sender_type,
    sender_is_external: attributes.is_external,
    sender_is_guest: attributes.is_guest,
    sender_is_deactivated: attributes.is_deactivated,
    sent_at: sentAt,
    text,
    addressed_to_gist: eventClass === 'addressed',
    ...(mutation === null ? {} : { mutation: Object.freeze(mutation.detail) }),
  };

  return Object.freeze(normalized);
}
