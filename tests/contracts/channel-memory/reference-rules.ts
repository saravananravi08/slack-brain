/**
 * Reference evaluators for the frozen channel-memory contract rules.
 *
 * These are NOT the runtime implementation. T602–T605 implement the runtime in
 * `src/`; this module is the executable statement of what the contract says,
 * so the fixtures can be checked for internal consistency and so a downstream
 * implementation has an unambiguous oracle to compare against.
 *
 * Everything here is pure and total: no I/O, no clock, no throw on hostile
 * input.
 */

export type ChannelSenderClass = 'human' | 'gist' | 'kilo' | 'bot' | 'app' | 'system';

export interface RawSenderShape {
  readonly user: string | null;
  readonly bot_id: string | null;
  readonly app_id: string | null;
  readonly subtype: string | null;
  readonly username: string | null;
}

export interface SenderConfig {
  readonly gist_bot_user_id: string;
  readonly kilo_bot_id: string;
  readonly kilo_app_id: string;
}

/** enrollment.md §3 — channel lifecycle subtypes, mirroring SYSTEM_SUBTYPES. */
const SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
]);

/**
 * enrollment.md §3 — ordering comparison for Slack timestamps that never
 * converts to a float.
 *
 * Seconds compare numerically; the fractional part compares as an integer
 * after right-padding both sides to six digits, so `.0002` and `.000200`
 * order equal. Ordering equality is deliberately NOT identity equality:
 * `messageKey` uses the verbatim string (CM-INV-06).
 */
export function compareMessageTs(a: string, b: string): number {
  const [aSecRaw = '', aFracRaw = ''] = a.split('.');
  const [bSecRaw = '', bFracRaw = ''] = b.split('.');

  const aSec = Number.parseInt(aSecRaw, 10);
  const bSec = Number.parseInt(bSecRaw, 10);
  if (Number.isNaN(aSec) || Number.isNaN(bSec)) return Number.NaN;
  if (aSec !== bSec) return aSec < bSec ? -1 : 1;

  const aFrac = aFracRaw.padEnd(6, '0');
  const bFrac = bFracRaw.padEnd(6, '0');
  if (aFrac === bFrac) return 0;
  return aFrac < bFrac ? -1 : 1;
}

/** slack-event.md §3 — content identity. Uses the verbatim ts, never padded. */
export function messageKey(workspaceId: string, channelId: string, messageTs: string): string {
  return `${workspaceId}/${channelId}/${messageTs}`;
}

/** identity.md §2 — the `ch:` prefix is structural and never stripped. */
export function channelBoundaryId(workspaceId: string, channelId: string): string {
  return `ch:${workspaceId}:${channelId}`;
}

/** identity.md §3 — both Slack root encodings collapse to one root. */
export function threadRootTs(messageTs: string, threadTs: string | null): string {
  return threadTs === null || threadTs === messageTs ? messageTs : threadTs;
}

export function threadId(boundaryId: string, rootTs: string): string {
  return `${boundaryId}#${rootTs}`;
}

/**
 * message-record.md §2 — deterministic, first match wins. Gist before Kilo
 * before generic bot/app, and never a display-name heuristic.
 */
export function classifySender(raw: RawSenderShape, config: SenderConfig): ChannelSenderClass {
  if (raw.user !== null && raw.user === config.gist_bot_user_id) return 'gist';
  if (
    (raw.bot_id !== null && raw.bot_id === config.kilo_bot_id) ||
    (raw.app_id !== null && raw.app_id === config.kilo_app_id)
  ) {
    return 'kilo';
  }
  if (raw.subtype !== null && SYSTEM_SUBTYPES.has(raw.subtype)) return 'system';
  if (raw.bot_id !== null || raw.subtype === 'bot_message') return 'bot';
  if (raw.app_id !== null) return 'app';
  return 'human';
}

/**
 * message-record.md §2 — user, then bot, then app. `null` means the event is
 * malformed; a display name is never an identity.
 */
export function resolveSenderId(raw: RawSenderShape): string | null {
  return raw.user ?? raw.bot_id ?? raw.app_id ?? null;
}

/** mutations.md §3.3 — apply-if-newer. A tie means the same edit. */
export function editWins(storedEditedAt: string | null, incomingEditedAt: string): boolean {
  return storedEditedAt === null || incomingEditedAt > storedEditedAt;
}

/** enrollment.md §3 — inclusive at the floor. */
export function withinCaptureFloor(captureFloorTs: string, messageTs: string): boolean {
  return compareMessageTs(messageTs, captureFloorTs) >= 0;
}

/** capture-policy.md §4 rules 1–2 — response eligibility by sender class alone. */
export function responseDenyForSenderClass(
  senderClass: ChannelSenderClass,
): 'self_authored' | 'non_human_sender' | null {
  if (senderClass === 'gist') return 'self_authored';
  if (senderClass !== 'human') return 'non_human_sender';
  return null;
}
