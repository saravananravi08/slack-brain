/**
 * Normalized live Slack event types.
 *
 * Contract: docs/architecture/contracts/slack-event.md §1, §2, §4, §5.
 * Spike: docs/spikes/slack-event-support.md §6, §7 — what the pinned adapter
 * actually hands over, and what it does not.
 *
 * Slack SDK types stop at the channel adapter. Everything below this file
 * speaks these shapes, so authorization, memory, and retrieval have no Slack
 * coupling and are testable with plain objects.
 */

/** Slack message shape. Response permission is decided separately. */
export type EventClass = 'addressed' | 'ambient' | 'mutation';

/** slack-event.md §5. Carries no message content. */
export type SkipReason =
  | 'bot_message'
  | 'app_message'
  | 'system_subtype'
  | 'own_message'
  | 'empty_text'
  | 'unapproved_channel'
  | 'unapproved_workspace'
  | 'external_user'
  | 'guest_user'
  | 'malformed_event'
  | 'duplicate_delivery';

/**
 * The subset of `SkipReason` this module can produce.
 *
 * `unapproved_*`, `external_user`, and `guest_user` are **authorization's**
 * (slack-event.md §5): the normalizer has no policy knowledge and never
 * decides them. Keeping the split in the type stops that from eroding.
 */
export type NormalizerSkipReason = Exclude<
  SkipReason,
  'unapproved_channel' | 'unapproved_workspace' | 'external_user' | 'guest_user'
>;

export type SenderType = 'human' | 'bot' | 'app' | 'system';
export type ChannelSenderClass = 'human' | 'gist' | 'kilo' | 'bot' | 'app' | 'system';
export type ConversationType = 'channel' | 'dm';

export interface FileRef {
  readonly file_id: string;
  readonly name: string;
  readonly mimetype: string;
  readonly size_bytes: number;
}

export interface LinkRef {
  readonly url: string;
  readonly domain: string;
}

/** message-record.md §2. Eligibility deliberately does not live here. */
export interface CanonicalSender {
  readonly sender_class: ChannelSenderClass;
  readonly sender_id: string;
  readonly sender_display_name: string;
  readonly bot_id: string | null;
  readonly app_id: string | null;
  readonly username: string | null;
  readonly is_gist_self: boolean;
  readonly is_external: boolean;
  readonly is_guest: boolean;
}

/** capture-policy.md §4 rules 1–3. Null means authorization must continue. */
export type ResponsePrecheckDenyReason =
  | 'self_authored'
  | 'non_human_sender'
  | 'not_addressed';

/** slack-event.md §4 plus channel-memory mutations.md §2. */
export interface MutationDetail {
  readonly kind: 'edit' | 'delete';
  /** `message_ts` of the message being changed. */
  readonly target_ts: string;
  readonly edited_at: string;
  /** Present iff `kind === 'edit'`. */
  readonly new_text?: string;
  readonly new_files?: readonly FileRef[];
  readonly new_links?: readonly LinkRef[];
}

/** slack-event.md §2. */
export interface NormalizedEvent {
  readonly contract_version: string;
  readonly class: EventClass;

  readonly workspace_id: string;
  readonly channel_id: string;
  /** Slack ts, verbatim string — never parsed to a float. */
  readonly message_ts: string;
  /** Slack envelope event ID, for delivery dedup. */
  readonly event_id: string;

  readonly conversation_type: ConversationType;
  /** Null for a root message; both Slack root encodings converge here. */
  readonly thread_ts: string | null;
  /** Original Slack thread identity; equals `message_ts` for roots. */
  readonly thread_root_ts: string;
  readonly is_thread_reply: boolean;
  readonly sender_id: string;
  readonly sender_type: SenderType;
  readonly sender_class: ChannelSenderClass;
  readonly sender: CanonicalSender;
  readonly sender_is_external: boolean;
  readonly sender_is_guest: boolean;
  /**
   * Not in slack-event.md §2, and not derivable from a Slack message event.
   *
   * D006 rule 5 requires the deactivated-user denial and T203's guard takes it
   * as a **required** field, because an optional one would default to "not
   * deactivated" — the fail-open direction. It is carried here so an
   * `AuthorizationEvent` can be built from a `NormalizedEvent` without a
   * second lookup. Flagged for the integrator: either slack-event.md gains the
   * field or T004 amends the contract.
   */
  readonly sender_is_deactivated: boolean;

  /** RFC 3339 UTC, derived from `message_ts`. */
  readonly sent_at: string;
  /** Never logged (INV-12). Channel messages may be empty. */
  readonly text: string;
  readonly files: readonly FileRef[];
  readonly links: readonly LinkRef[];
  /** Syntactic addressing only. It is never response permission. */
  readonly addressed_to_gist: boolean;

  /** Present iff `class === 'mutation'`. */
  readonly mutation?: MutationDetail;
}

export interface SkipResult {
  readonly skip: NormalizerSkipReason;
}

export type NormalizationResult = NormalizedEvent | SkipResult;

export function isSkip(result: NormalizationResult): result is SkipResult {
  return 'skip' in result;
}

/**
 * Sender attributes that a Slack message event does not carry.
 *
 * T401 §7.1 measured this: the adapter's parsed author is
 * `{userId, userName, fullName, email?, isBot, isSystem, isMe}`, and its cached
 * user record holds only `{avatarUrl, displayName, email, isBot, realName}`.
 * External, guest, and deactivated come from `users.info` and nowhere else.
 *
 * They are an **input** to normalization rather than something it invents,
 * because the only alternative — defaulting them to `false` — would hand
 * T203's guard a Slack Connect user wearing a full member's clothes.
 */
export interface SenderAttributes {
  readonly sender_type: SenderType;
  readonly is_external: boolean;
  readonly is_guest: boolean;
  readonly is_deactivated: boolean;
  /** Optional here; persistence may resolve it at write time. */
  readonly display_name?: string;
}

/**
 * Everything normalization needs that is not in the raw event.
 *
 * All of it is configuration or already-resolved fact. None of it is read
 * here: the caller supplies it, which is what keeps `normalize` pure and
 * every test case a plain object.
 */
export interface NormalizationContext {
  /** Gist's own Slack user ID, for self-detection and mention detection. */
  readonly bot_user_id: string;
  /** Gist's Slack bot ID (`B…`), when known. Also used for self-detection. */
  readonly bot_id?: string;
  /** Configured Kilo IDs. Classification never uses display names or text. */
  readonly kilo_bot_id?: string;
  readonly kilo_app_id?: string;
  /**
   * Resolved workspace attributes. Required for humans; automation identities
   * are classified from configured/raw IDs and remain response-ineligible.
   */
  readonly sender_attributes?: SenderAttributes;
  /**
   * Whether Gist is subscribed to this thread.
   *
   * The one piece of stored state classification depends on, so it is passed
   * in: slack-event.md §1 requires classification to be a pure function of the
   * event. T401 §5 is why it matters — a subscribed thread turns an ordinary
   * message into addressed traffic.
   */
  readonly subscribed_thread?: boolean;
  /** Slack envelope event ID, when the caller captured it separately. */
  readonly delivery_event_id?: string;
}
