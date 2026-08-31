/**
 * Dual idempotency: delivery identity and content identity.
 *
 * Contract: docs/architecture/contracts/slack-event.md §3 — both keys are
 * required, and they prevent different failures. Delivery dedup alone permits
 * duplicate records; content dedup alone permits duplicate replies.
 */

import { describe, expect, it } from 'vitest';

import {
  CONTENT_KEY_PREFIX,
  DELIVERY_KEY_PREFIX,
  contentClaimKey,
  createInMemoryLedger,
  deduplicate,
  deliveryClaimKey,
  isSkip,
  normalize,
} from '../../../src/ingestion/events/index.js';
import type {
  IdempotencyLedger,
  NormalizedEvent,
} from '../../../src/ingestion/events/index.js';
import {
  SYNTHETIC,
  appMessage,
  botMessage,
  channelMessage,
  deleteEvent,
  editEvent,
  envelope,
  gistMessage,
  kiloMessage,
  makeContext,
} from './helpers.js';

function normalized(
  raw: Record<string, unknown>,
  eventId?: string,
): NormalizedEvent {
  const payload = eventId === undefined ? envelope(raw) : envelope(raw, { event_id: eventId });
  const result = normalize(payload, makeContext());
  if (isSkip(result)) throw new Error(`expected an event, got skip:${result.skip}`);
  return result;
}

/** Ledger that records the order in which keys were claimed. */
function recordingLedger(): IdempotencyLedger & { readonly claims: string[] } {
  const claims: string[] = [];
  const seen = new Set<string>();
  return {
    claims,
    claim: (key: string) => {
      claims.push(key);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

describe('delivery identity (FR-SLK-008, AC-06)', () => {
  it('lets a first delivery through', async () => {
    const ledger = createInMemoryLedger();
    const decision = await deduplicate(normalized(channelMessage()), ledger);

    expect(decision.outcome).toBe('first_delivery');
    expect(decision.skip).toBeNull();
  });

  it('skips a retry of the same envelope', async () => {
    const ledger = createInMemoryLedger();
    const event = normalized(channelMessage(), 'Ev0SYNTHRETRY');

    const first = await deduplicate(event, ledger);
    const retry = await deduplicate(event, ledger);

    expect(first.outcome).toBe('first_delivery');
    expect(retry.outcome).toBe('duplicate_delivery');
    expect(retry.skip).toBe('duplicate_delivery');
  });

  it('normalizes a retry to the same keys', async () => {
    // A Slack retry carries the same envelope and the same message, so both
    // identities must be byte-identical across deliveries.
    const first = normalized(channelMessage(), 'Ev0SYNTHRETRY');
    const retry = normalized(channelMessage(), 'Ev0SYNTHRETRY');

    expect(deliveryClaimKey(retry)).toBe(deliveryClaimKey(first));
    expect(contentClaimKey(retry)).toBe(contentClaimKey(first));
  });

  it('preserves retry keys for every captureable sender class', async () => {
    const senders = [
      channelMessage(),
      gistMessage(),
      kiloMessage(),
      botMessage(),
      appMessage(),
    ];

    for (const raw of senders) {
      const ledger = createInMemoryLedger();
      const first = normalized(raw, 'Ev0SYNTHALLSEND');
      const retry = normalized(raw, 'Ev0SYNTHALLSEND');
      expect(deliveryClaimKey(retry)).toBe(deliveryClaimKey(first));
      expect(contentClaimKey(retry)).toBe(contentClaimKey(first));
      expect((await deduplicate(first, ledger)).outcome).toBe('first_delivery');
      expect((await deduplicate(retry, ledger)).outcome).toBe('duplicate_delivery');
    }
  });

  it('stops before claiming the content key on a duplicate delivery', async () => {
    // Order matters: if a retry claimed the content key first, a racing
    // original delivery would look like a duplicate record.
    const ledger = recordingLedger();
    const event = normalized(channelMessage(), 'Ev0SYNTHRETRY');

    await deduplicate(event, ledger);
    ledger.claims.length = 0;
    await deduplicate(event, ledger);

    expect(ledger.claims).toEqual([deliveryClaimKey(event)]);
    expect(ledger.claims.some((key) => key.startsWith(CONTENT_KEY_PREFIX))).toBe(false);
  });
});

describe('content identity (INV-10, FR-MEM-007, AC-14)', () => {
  it('skips a second envelope describing the same message', async () => {
    // Two different `event_id`s, one message. Delivery dedup alone would let
    // this create a second record.
    const ledger = createInMemoryLedger();
    const first = normalized(channelMessage(), 'Ev0SYNTHAAAA');
    const second = normalized(channelMessage(), 'Ev0SYNTHBBBB');

    expect((await deduplicate(first, ledger)).outcome).toBe('first_delivery');

    const decision = await deduplicate(second, ledger);
    expect(decision.outcome).toBe('duplicate_content');
    expect(decision.skip).toBe('duplicate_delivery');
    expect(decision.message_key).toBe(
      `${SYNTHETIC.workspace}/${SYNTHETIC.channel}/${SYNTHETIC.ambientTs}`,
    );
  });

  it('treats two different messages as two messages', async () => {
    const ledger = createInMemoryLedger();
    const first = normalized(channelMessage());
    const second = normalized(channelMessage({ ts: SYNTHETIC.replyTs, event_ts: SYNTHETIC.replyTs }));

    expect((await deduplicate(first, ledger)).outcome).toBe('first_delivery');
    expect((await deduplicate(second, ledger)).outcome).toBe('first_delivery');
  });

  it('keeps the timestamp precision pair apart', async () => {
    // The pair is equal as floats. A content key built by parsing the ts would
    // collapse two distinct messages into one record.
    const ledger = createInMemoryLedger();
    const long = normalized(
      channelMessage({ ts: SYNTHETIC.precisionLong, event_ts: SYNTHETIC.precisionLong }),
    );
    const short = normalized(
      channelMessage({ ts: SYNTHETIC.precisionShort, event_ts: SYNTHETIC.precisionShort }),
    );

    expect(contentClaimKey(long)).not.toBe(contentClaimKey(short));
    expect((await deduplicate(long, ledger)).outcome).toBe('first_delivery');
    expect((await deduplicate(short, ledger)).outcome).toBe('first_delivery');
  });

  it('uses the workspace/channel/ts triple from the identity contract', () => {
    const event = normalized(channelMessage());
    expect(contentClaimKey(event)).toBe(
      `${CONTENT_KEY_PREFIX}${SYNTHETIC.workspace}/${SYNTHETIC.channel}/${SYNTHETIC.ambientTs}`,
    );
  });
});

describe('mutations are delivery-deduped only', () => {
  it('lets a second, genuine edit of the same message through', async () => {
    // Two edits share a messageKey by design. Content-deduping them would drop
    // the second edit and leave text the author had already replaced.
    const ledger = createInMemoryLedger();
    const firstEdit = normalized(editEvent(), 'Ev0SYNTHED01');
    const secondEdit = normalized(
      editEvent({
        ts: '1735690100.000100',
        event_ts: '1735690100.000100',
        message: {
          type: 'message',
          user: SYNTHETIC.user,
          text: 'rollout window moved to Thursday',
          ts: SYNTHETIC.ambientTs,
        },
      }),
      'Ev0SYNTHED02',
    );

    expect(firstEdit.message_ts).toBe(secondEdit.message_ts);
    expect((await deduplicate(firstEdit, ledger)).outcome).toBe('first_delivery');
    expect((await deduplicate(secondEdit, ledger)).outcome).toBe('first_delivery');
  });

  it('skips a replayed mutation envelope', async () => {
    // The SDK deduplicates nothing for mutations (spike §6), so this is the
    // only layer catching a replay before T404's own idempotency.
    const ledger = createInMemoryLedger();
    const remove = normalized(deleteEvent(), 'Ev0SYNTHDEL01');

    expect((await deduplicate(remove, ledger)).outcome).toBe('first_delivery');
    expect((await deduplicate(remove, ledger)).outcome).toBe('duplicate_delivery');
  });

  it('never claims a content key for a mutation', async () => {
    const ledger = recordingLedger();
    await deduplicate(normalized(editEvent()), ledger);

    expect(ledger.claims.every((key) => key.startsWith(DELIVERY_KEY_PREFIX))).toBe(true);
  });

  it('does not let an edit consume the content claim of its own message', async () => {
    // The original ambient message must still be storable after its edit
    // arrives first — otherwise a late original is silently dropped.
    const ledger = createInMemoryLedger();
    await deduplicate(normalized(editEvent(), 'Ev0SYNTHED03'), ledger);

    const original = normalized(channelMessage(), 'Ev0SYNTHORIG');
    expect((await deduplicate(original, ledger)).outcome).toBe('first_delivery');
  });
});

describe('keys are namespaced and deterministic', () => {
  it('separates delivery keys from content keys', () => {
    const event = normalized(channelMessage(), 'Ev0SYNTHKEY1');
    expect(deliveryClaimKey(event)).toBe(`${DELIVERY_KEY_PREFIX}Ev0SYNTHKEY1`);
    expect(contentClaimKey(event).startsWith(CONTENT_KEY_PREFIX)).toBe(true);
    expect(deliveryClaimKey(event)).not.toBe(contentClaimKey(event));
  });

  it('produces the same keys on every call', () => {
    const event = normalized(channelMessage());
    expect(deliveryClaimKey(event)).toBe(deliveryClaimKey(event));
    expect(contentClaimKey(event)).toBe(contentClaimKey(event));
  });

  it('carries no message text in either key', () => {
    // INV-12 — keys reach logs and the state store; message bodies must not.
    const event = normalized(channelMessage({ text: 'confidential rollout detail' }));
    expect(deliveryClaimKey(event)).not.toContain('confidential');
    expect(contentClaimKey(event)).not.toContain('confidential');
  });
});

describe('the in-memory ledger is a reference implementation only', () => {
  it('does not survive being replaced, which is what AC-13 restarts', async () => {
    const event = normalized(channelMessage(), 'Ev0SYNTHRESTART');

    const before = createInMemoryLedger();
    expect((await deduplicate(event, before)).outcome).toBe('first_delivery');

    // A new ledger stands in for a restarted process: the durable store this
    // port abstracts is T403/T405's, and an in-memory set is not it.
    const after = createInMemoryLedger();
    expect((await deduplicate(event, after)).outcome).toBe('first_delivery');
  });

  it('supports an async ledger', async () => {
    const seen = new Set<string>();
    const asyncLedger: IdempotencyLedger = {
      claim: async (key: string) => {
        await Promise.resolve();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    };

    const event = normalized(channelMessage(), 'Ev0SYNTHASYNC');
    expect((await deduplicate(event, asyncLedger)).outcome).toBe('first_delivery');
    expect((await deduplicate(event, asyncLedger)).outcome).toBe('duplicate_delivery');
  });
});
