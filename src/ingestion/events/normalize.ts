/**
 * The live Slack event normalizer.
 *
 * Contracts: docs/architecture/contracts/slack-event.md plus the channel-only
 * supersessions in docs/architecture/channel-memory/{message-record,capture-policy}.md.
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

import { DELETE_SUBTYPE, EDIT_SUBTYPE, SYSTEM_SUBTYPES } from './subtypes.js';
import type {
  CanonicalSender,
  ChannelSenderClass,
  ConversationType,
  EventClass,
  FileRef,
  LinkRef,
  MutationDetail,
  NormalizationContext,
  NormalizationResult,
  NormalizedEvent,
  NormalizerSkipReason,
  ResponsePrecheckDenyReason,
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

const EMPTY_FILES: readonly FileRef[] = Object.freeze([]);
const EMPTY_LINKS: readonly LinkRef[] = Object.freeze([]);

function filesOf(value: unknown): readonly FileRef[] | null {
  if (value === undefined || value === null) return EMPTY_FILES;
  if (!Array.isArray(value)) return null;

  const files: FileRef[] = [];
  for (const candidate of value) {
    const file = asRecord(candidate);
    if (file === null) return null;
    const fileId = str(file.id) ?? str(file.file_id);
    const name = str(file.name);
    const mimetype = str(file.mimetype);
    const size = file.size ?? file.size_bytes;
    if (
      fileId === null ||
      name === null ||
      mimetype === null ||
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      return null;
    }
    files.push(Object.freeze({ file_id: fileId, name, mimetype, size_bytes: size }));
  }
  return files.length === 0 ? EMPTY_FILES : Object.freeze(files);
}

function linkRef(urlValue: unknown, domainValue?: unknown): LinkRef | null {
  const url = str(urlValue);
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const suppliedDomain = domainValue === undefined ? null : str(domainValue);
    const domain = suppliedDomain ?? parsed.hostname;
    if (domain === '' || domain !== parsed.hostname) return null;
    return Object.freeze({ url, domain });
  } catch {
    return null;
  }
}

function linksOf(event: Record<string, unknown>): readonly LinkRef[] | null {
  const links: LinkRef[] = [];
  const explicit = event.links;
  if (explicit !== undefined && explicit !== null) {
    if (!Array.isArray(explicit)) return null;
    for (const candidate of explicit) {
      const raw = asRecord(candidate);
      if (raw === null) return null;
      const link = linkRef(raw.url, raw.domain);
      if (link === null) return null;
      links.push(link);
    }
  }

  const attachments = event.attachments;
  if (attachments !== undefined && attachments !== null) {
    if (!Array.isArray(attachments)) return null;
    for (const candidate of attachments) {
      const attachment = asRecord(candidate);
      if (attachment === null) return null;
      const url = attachment.original_url ?? attachment.title_link ?? attachment.from_url;
      if (url === undefined || url === null) continue;
      const link = linkRef(url);
      if (link === null) return null;
      links.push(link);
    }
  }

  if (links.length === 0) return EMPTY_LINKS;
  const unique = new Map(links.map((link) => [link.url, link]));
  return Object.freeze([...unique.values()]);
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

/** message-record.md §2 — deterministic, configured-ID classification. */
function senderClassOf(
  event: Record<string, unknown>,
  context: NormalizationContext,
): ChannelSenderClass {
  const user = str(event.user) ?? str(event.bot_user_id);
  const botId = str(event.bot_id);
  const appId = str(event.app_id);
  const subtype = str(event.subtype);

  if (
    user === context.bot_user_id ||
    (botId !== null && context.bot_id !== undefined && botId === context.bot_id)
  ) {
    return 'gist';
  }
  if (
    (botId !== null && context.kilo_bot_id !== undefined && botId === context.kilo_bot_id) ||
    (appId !== null && context.kilo_app_id !== undefined && appId === context.kilo_app_id)
  ) {
    return 'kilo';
  }
  if (user === SLACK_SYSTEM_USER_ID || (subtype !== null && SYSTEM_SUBTYPES.has(subtype))) {
    return 'system';
  }
  if (botId !== null || subtype === 'bot_message') return 'bot';
  if (appId !== null || subtype === 'app_message') return 'app';

  const resolvedType = context.sender_attributes?.sender_type;
  if (resolvedType === 'bot' || resolvedType === 'app' || resolvedType === 'system') {
    return resolvedType;
  }
  return 'human';
}

function senderTypeFor(senderClass: ChannelSenderClass): SenderType {
  if (senderClass === 'human' || senderClass === 'app' || senderClass === 'system') {
    return senderClass;
  }
  return 'bot';
}

function senderOf(
  event: Record<string, unknown>,
  context: NormalizationContext,
): CanonicalSender | null {
  const user = str(event.user) ?? str(event.bot_user_id);
  const botId = str(event.bot_id);
  const appId = str(event.app_id);
  const senderId = user ?? botId ?? appId;
  if (senderId === null) return null;

  const senderClass = senderClassOf(event, context);
  const attributes = context.sender_attributes;
  if (senderClass === 'human' && attributes === undefined) return null;

  const username = str(event.username);
  return Object.freeze({
    sender_class: senderClass,
    sender_id: senderId,
    sender_display_name: attributes?.display_name ?? username ?? senderId,
    bot_id: botId,
    app_id: appId,
    username,
    is_gist_self: senderClass === 'gist',
    is_external: attributes?.is_external ?? false,
    is_guest: attributes?.is_guest ?? false,
  });
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
  readonly files: readonly FileRef[];
  readonly links: readonly LinkRef[];
  readonly carrier: Record<string, unknown>;
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
    const newFiles = filesOf(inner.files);
    const newLinks = linksOf(inner);
    if (newFiles === null || newLinks === null) return null;
    return {
      detail: {
        kind,
        target_ts: targetTs,
        edited_at: editedAt,
        new_text: newText,
        new_files: newFiles,
        new_links: newLinks,
      },
      targetTs,
      text: newText,
      files: newFiles,
      links: newLinks,
      carrier: inner,
      threadTs: normalizeThreadTs(str(inner.thread_ts), targetTs),
    };
  }

  const targetTs = str(event.deleted_ts) ?? str(previous?.ts);
  if (targetTs === null || !MESSAGE_TS.test(targetTs) || previous === null) return null;
  return {
    detail: { kind, target_ts: targetTs, edited_at: editedAt },
    targetTs,
    // D015 accepts this event but T605 ignores it. No prior content is copied.
    text: '',
    files: EMPTY_FILES,
    links: EMPTY_LINKS,
    carrier: previous,
    threadTs: normalizeThreadTs(str(previous.thread_ts), targetTs),
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
    return skip('malformed_event');
  }

  const workspaceId = str(event.team) ?? str(event.team_id) ?? envelopeTeamId;
  const channelId = str(event.channel);
  const conversationType = conversationTypeOf(event);
  const eventId = context.delivery_event_id ?? envelopeEventId;
  if (
    workspaceId === null ||
    channelId === null ||
    conversationType === null ||
    eventId === null
  ) {
    return skip('malformed_event');
  }

  const subtype = str(event.subtype);
  const isMutation = subtype === EDIT_SUBTYPE || subtype === DELETE_SUBTYPE;
  if (subtype !== null && !isMutation && SYSTEM_SUBTYPES.has(subtype)) {
    return skip('system_subtype');
  }

  const mutation = isMutation
    ? mutationPartsOf(event, subtype === EDIT_SUBTYPE ? 'edit' : 'delete')
    : null;
  if (isMutation && mutation === null) return skip('malformed_event');

  const carrier = mutation?.carrier ?? event;
  const sender = senderOf(carrier, context);
  if (sender === null) return skip('malformed_event');
  if (sender.sender_class === 'system') return skip('system_subtype');

  // The channel-memory override is channel-only. DMs retain v1 sender skips.
  if (conversationType === 'dm' && sender.sender_class !== 'human') {
    if (sender.sender_class === 'gist') return skip('own_message');
    if (sender.sender_class === 'app') return skip('app_message');
    return skip('bot_message');
  }

  const messageTs = mutation?.targetTs ?? str(event.ts);
  if (messageTs === null || !MESSAGE_TS.test(messageTs)) return skip('malformed_event');

  const text = mutation?.text ?? (typeof event.text === 'string' ? event.text : '');
  const files = mutation?.files ?? filesOf(event.files);
  const links = mutation?.links ?? linksOf(event);
  if (files === null || links === null) return skip('malformed_event');
  if (conversationType === 'dm' && text.trim() === '' && mutation?.detail.kind !== 'delete') {
    return skip('empty_text');
  }

  const sentAt = sentAtFrom(messageTs);
  if (sentAt === null) return skip('malformed_event');

  const threadTs =
    mutation !== null ? mutation.threadTs : normalizeThreadTs(str(event.thread_ts), messageTs);
  const threadRootTs = threadTs ?? messageTs;
  const eventClass = classify(event, context, conversationType, text);
  const senderType = senderTypeFor(sender.sender_class);

  const normalized: NormalizedEvent = {
    contract_version: EVENT_CONTRACT_VERSION,
    class: eventClass,
    workspace_id: workspaceId,
    channel_id: channelId,
    message_ts: messageTs,
    event_id: eventId,
    conversation_type: conversationType,
    thread_ts: threadTs,
    thread_root_ts: threadRootTs,
    is_thread_reply: threadRootTs !== messageTs,
    sender_id: sender.sender_id,
    sender_type: senderType,
    sender_class: sender.sender_class,
    sender,
    sender_is_external: sender.is_external,
    sender_is_guest: sender.is_guest,
    sender_is_deactivated: context.sender_attributes?.is_deactivated ?? false,
    sent_at: sentAt,
    text,
    files,
    links,
    addressed_to_gist: eventClass === 'addressed',
    ...(mutation === null ? {} : { mutation: Object.freeze(mutation.detail) }),
  };

  return Object.freeze(normalized);
}

/**
 * Early response-policy rules. Null grants nothing; it means v1 authorization
 * must run next. Capture decisions are intentionally not accepted as input.
 */
export function responsePrecheckDenyReason(
  event: NormalizedEvent,
): ResponsePrecheckDenyReason | null {
  if (event.sender_class === 'gist') return 'self_authored';
  if (event.sender_class !== 'human') return 'non_human_sender';
  if (!event.addressed_to_gist || event.class === 'mutation') return 'not_addressed';
  return null;
}
