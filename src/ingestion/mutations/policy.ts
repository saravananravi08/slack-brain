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

/** D004 eligibility only. Deletion itself always goes through deleteMessages. */
export function retentionMessageKeys(
  messages: readonly MastraDBMessage[],
  policy: RetentionPolicy,
): readonly MessageKey[] {
  const now = Date.parse(policy.now);
  if (Number.isNaN(now)) throw new TypeError('Retention policy now must be RFC 3339.');

  const keys = new Set<MessageKey>();
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
    if (!validDate(removedAt)) continue;
    if (now - Date.parse(removedAt) >= REMOVED_CHANNEL_GRACE_MS) {
      keys.add(message.id as MessageKey);
    }
  }
  return [...keys];
}
