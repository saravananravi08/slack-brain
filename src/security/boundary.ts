/**
 * Read-only inspection of boundary identifiers.
 *
 * This module **parses** identifiers; it never composes one. Composing a
 * `BoundaryId` outside T202's `resource-policy.ts` is forbidden by
 * identity.md §4 — that rule exists because a dropped `ch:` / `dm:` prefix is
 * exactly how cross-boundary leaks happen. The guard therefore receives
 * identities and membership boundaries already composed, and only checks that
 * what it received agrees with the event in front of it.
 */

import type { BoundaryId, ConversationType } from './types.js';

export interface ParsedBoundary {
  readonly kind: ConversationType;
  readonly workspaceId: string;
  /** Channel ID for a `ch:` boundary, human user ID for a `dm:` boundary. */
  readonly resourceKey: string;
}

const PREFIX_FOR: Readonly<Record<ConversationType, string>> = {
  channel: 'ch',
  dm: 'dm',
};

/**
 * Parse `ch:<workspace>:<channel>` or `dm:<workspace>:<user>`.
 *
 * Returns null for anything else, including a bare unprefixed Slack ID
 * (identity.md §4 "forbidden: using a bare channel or user ID as a
 * BoundaryId"). Exactly three non-empty segments are required, so a value
 * carrying an extra separator is rejected rather than silently truncated.
 */
export function parseBoundaryId(value: unknown): ParsedBoundary | null {
  if (typeof value !== 'string') return null;

  const segments = value.split(':');
  if (segments.length !== 3) return null;

  const [prefix, workspaceId, resourceKey] = segments;
  if (workspaceId === undefined || resourceKey === undefined) return null;
  if (workspaceId === '' || resourceKey === '') return null;

  if (prefix === PREFIX_FOR.channel) {
    return { kind: 'channel', workspaceId, resourceKey };
  }
  if (prefix === PREFIX_FOR.dm) {
    return { kind: 'dm', workspaceId, resourceKey };
  }
  return null;
}

export function isChannelBoundary(value: BoundaryId): boolean {
  return parseBoundaryId(value)?.kind === 'channel';
}

export function isDirectMessageBoundary(value: BoundaryId): boolean {
  return parseBoundaryId(value)?.kind === 'dm';
}
