import type { MastraDBMessage } from '@mastra/core/agent';

import type { BoundaryId, MessageKey } from '../../mastra/memory/resource-policy.js';
import type { MutationDetail, RetentionPolicy } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const DM_RETENTION_MS = 90 * DAY_MS;
const REMOVED_CHANNEL_GRACE_MS = 30 * DAY_MS;
const SLACK_TIMESTAMP = /^\d+\.\d+$/;

function validDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Pure, total classifier for the frozen mutation contract. */
export function classifyMutation(event: unknown): MutationDetail | null {
  if (typeof event !== 'object' || event === null) return null;
  const candidate = event as { class?: unknown; mutation?: Record<string, unknown> };
  const mutation = candidate.mutation;
  if (candidate.class !== 'mutation' || !mutation) return null;
  if (mutation.kind !== 'edit' && mutation.kind !== 'delete') return null;
  if (typeof mutation.target_ts !== 'string' || !SLACK_TIMESTAMP.test(mutation.target_ts)) {
    return null;
  }
  if (!validDate(mutation.edited_at)) return null;

  if (mutation.kind === 'edit') {
    if (typeof mutation.new_text !== 'string' || mutation.new_text.trim() === '') return null;
    return {
      kind: 'edit',
      target_ts: mutation.target_ts,
      edited_at: mutation.edited_at,
      new_text: mutation.new_text,
    };
  }

  if (mutation.new_text !== undefined) return null;
  return {
    kind: 'delete',
    target_ts: mutation.target_ts,
    edited_at: mutation.edited_at,
  };
}

function boundary(message: MastraDBMessage): BoundaryId | null {
  const value = message.resourceId;
  if (typeof value !== 'string') return null;
  if (value.startsWith('ch:') || value.startsWith('dm:')) return value as BoundaryId;
  return null;
}

function channelId(boundaryId: BoundaryId): string | null {
  if (!boundaryId.startsWith('ch:')) return null;
  const parts = boundaryId.split(':');
  return parts.length === 3 && parts[2] ? parts[2] : null;
}

function messageTime(message: MastraDBMessage): number {
  const sentAt = message.content.metadata?.sent_at;
  return validDate(sentAt) ? Date.parse(sentAt) : message.createdAt.getTime();
}

/**
 * D004 eligibility, plus the de-approved channels whose clock has not started.
 *
 * Deletion itself always goes through `deleteMessages`.
 *
 * A channel that has left the approved list but carries no recorded removal
 * time used to be skipped outright, which turned the 30-day purge into a
 * permanent retention exactly when it mattered: an operator who edits the
 * allowlist without recording a timestamp keeps the content forever, silently
 * (design review F-07).
 *
 * The sweep now treats such a channel as removed **at `policy.now`** — the
 * clock starts rather than never starting — and returns it in
 * `channel_removal_starts` so the caller can persist the timestamp, plus in
 * `unrecorded_channel_removals` so the report shows it. Nothing is purged on
 * this sweep, because no elapsed grace period can be proven retroactively; but
 * the state is now visible on every sweep until it is recorded, so it cannot
 * pass unnoticed.
 */
export interface RetentionPlan {
  readonly keys: readonly MessageKey[];
  /** De-approved channels holding content with no recorded removal time. */
  readonly unrecorded_channel_removals: readonly string[];
  /**
   * Removal times the caller must persist into the policy source. Until it
   * does, the grace period cannot start and these channels reappear on the
   * next sweep.
   */
  readonly channel_removal_starts: Readonly<Record<string, string>>;
}

export function retentionPlan(
  messages: readonly MastraDBMessage[],
  policy: RetentionPolicy,
): RetentionPlan {
  const now = Date.parse(policy.now);
  if (Number.isNaN(now)) throw new TypeError('Retention policy now must be RFC 3339.');

  const keys = new Set<MessageKey>();
  const unrecorded = new Set<string>();

  for (const message of messages) {
    const boundaryId = boundary(message);
    if (!boundaryId) continue;

    if (boundaryId.startsWith('dm:')) {
      if (now - messageTime(message) >= DM_RETENTION_MS) keys.add(message.id as MessageKey);
      continue;
    }

    const id = channelId(boundaryId);
    if (!id || policy.approved_channel_ids.includes(id)) continue;

    const removedAt = policy.channel_removed_at[id];
    if (!validDate(removedAt)) {
      unrecorded.add(id);
      continue;
    }
    if (now - Date.parse(removedAt) >= REMOVED_CHANNEL_GRACE_MS) {
      keys.add(message.id as MessageKey);
    }
  }

  const starts: Record<string, string> = {};
  for (const id of unrecorded) starts[id] = policy.now;

  return {
    keys: [...keys],
    unrecorded_channel_removals: [...unrecorded],
    channel_removal_starts: starts,
  };
}

/** Back-compatible view over {@link retentionPlan}. */
export function retentionMessageKeys(
  messages: readonly MastraDBMessage[],
  policy: RetentionPolicy,
): readonly MessageKey[] {
  return retentionPlan(messages, policy).keys;
}
