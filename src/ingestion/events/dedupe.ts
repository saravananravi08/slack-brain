/**
 * Dual idempotency for live Slack events.
 *
 * Contract: docs/architecture/contracts/slack-event.md §3.
 *
 * > Both are required. Delivery dedup alone permits duplicate records from two
 * > different envelopes describing one message; content dedup alone permits
 * > duplicate replies.
 *
 * The two keys answer different questions and have different consequences:
 *
 * | Key | Identity of | Prevents |
 * |---|---|---|
 * | `deliveryKey` = `event_id` | one Slack *delivery* | a retry producing a second reply (FR-SLK-008, AC-06) |
 * | `messageKey` = `workspace/channel/ts` | one *message* | two envelopes, or live plus archive import, producing two records (INV-10, FR-MEM-007, AC-14) |
 *
 * Both key functions come from T202's `resource-policy.ts` — the single point
 * of truth for identity — rather than being rebuilt here.
 */

import { deliveryKey, messageKey } from '../../mastra/memory/resource-policy.js';
import type { DeliveryKey, MessageKey } from '../../mastra/memory/resource-policy.js';
import type { NormalizedEvent } from './types.js';

export type { DeliveryKey, MessageKey };

/**
 * Durable claim store.
 *
 * `claim` records the key and reports whether *this* caller is the first to
 * hold it — the `setIfNotExists` shape, because a read-then-write would race
 * two deliveries of the same event against each other.
 *
 * The durable implementation belongs to the storage layer (T403/T405). This
 * module owns the keys, the ordering, and the decision.
 */
export interface IdempotencyLedger {
  claim(key: string, ttlMs?: number): Promise<boolean> | boolean;
}

export type DeduplicationOutcome =
  | 'first_delivery'
  | 'duplicate_delivery'
  | 'duplicate_content';

export interface DeduplicationDecision {
  readonly outcome: DeduplicationOutcome;
  /** The contract skip reason, or null when the event should proceed. */
  readonly skip: 'duplicate_delivery' | null;
  readonly delivery_key: DeliveryKey;
  /** Absent for mutations — see `deduplicate`. */
  readonly message_key: MessageKey | null;
}

export const DELIVERY_KEY_PREFIX = 'delivery:';
export const CONTENT_KEY_PREFIX = 'content:';

/**
 * Namespaced so a Slack `event_id` can never collide with a message key, and
 * so an operator reading the store can tell the two apart.
 */
export function deliveryClaimKey(event: NormalizedEvent): string {
  return `${DELIVERY_KEY_PREFIX}${deliveryKey({ event_id: event.event_id })}`;
}

export function contentClaimKey(event: NormalizedEvent): string {
  return `${CONTENT_KEY_PREFIX}${messageKey(event)}`;
}

/**
 * Decide whether this event has already been handled.
 *
 * Delivery is claimed first: a retry of the same envelope must stop before it
 * can consume the content claim, because doing so in the other order would let
 * a retry mark the message as seen and then let the *original* look like a
 * duplicate if the two race.
 *
 * **Mutations are delivery-deduped only.** Two edits of one message share a
 * `messageKey` by design, so applying content dedup would silently drop the
 * second edit — the message would keep text the author had already replaced.
 * Idempotency for the mutation itself is T404's (the SDK provides none at all;
 * see the spike §6), and a replayed mutation is caught here by its `event_id`.
 */
export async function deduplicate(
  event: NormalizedEvent,
  ledger: IdempotencyLedger,
  options?: { readonly deliveryTtlMs?: number; readonly contentTtlMs?: number },
): Promise<DeduplicationDecision> {
  const delivery = deliveryClaimKey(event);
  const firstDelivery = await ledger.claim(delivery, options?.deliveryTtlMs);
  if (!firstDelivery) {
    return Object.freeze({
      outcome: 'duplicate_delivery' as const,
      skip: 'duplicate_delivery' as const,
      delivery_key: event.event_id,
      message_key: null,
    });
  }

  if (event.class === 'mutation') {
    return Object.freeze({
      outcome: 'first_delivery' as const,
      skip: null,
      delivery_key: event.event_id,
      message_key: null,
    });
  }

  const content = contentClaimKey(event);
  const firstContent = await ledger.claim(content, options?.contentTtlMs);
  if (!firstContent) {
    return Object.freeze({
      outcome: 'duplicate_content' as const,
      skip: 'duplicate_delivery' as const,
      delivery_key: event.event_id,
      message_key: messageKey(event),
    });
  }

  return Object.freeze({
    outcome: 'first_delivery' as const,
    skip: null,
    delivery_key: event.event_id,
    message_key: messageKey(event),
  });
}

/**
 * In-memory ledger.
 *
 * A reference implementation for tests and for wiring T405 before its durable
 * store exists. It is explicitly **not** production-safe: AC-13 restarts a
 * process and expects dedup to survive, and an in-memory set does not. The
 * name says so, so nobody reaches for it by accident.
 */
export function createInMemoryLedger(): IdempotencyLedger & { readonly size: () => number } {
  const claimed = new Set<string>();
  return {
    claim: (key: string) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    size: () => claimed.size,
  };
}
