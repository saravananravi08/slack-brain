import type { CollectionSchema } from '@mastra/core/storage';
import { FactoryStorageDomain, UniqueViolationError } from '@mastra/core/storage';

import type { IdempotencyLedger } from '../../ingestion/events/index.js';

const COLLECTION = 'gist_channel_dedup_claims';
const DOMAIN = 'channel-delivery-dedup';

const CLAIM_SCHEMA = {
  name: COLLECTION,
  columns: {
    claim_key: { type: 'text', primaryKey: true },
    claimed_at: { type: 'timestamp' },
    expires_at: { type: 'timestamp', nullable: true },
  },
  indexes: [{
    name: 'gist_channel_dedup_expires_at_idx',
    columns: ['expires_at'],
  }],
} as const satisfies CollectionSchema;

interface ClaimRow extends Record<string, unknown> {
  claim_key: string;
  claimed_at: Date;
  expires_at: Date | null;
}

/** Durable atomic claims for Slack delivery and message-content dedup keys. */
export class DurableChannelDedupLedger extends FactoryStorageDomain
  implements IdempotencyLedger {
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    super(DOMAIN);
    this.#now = now;
  }

  override async init(): Promise<void> {
    await this.ensureCollections([CLAIM_SCHEMA]);
  }

  override async dangerouslyClearAll(): Promise<void> {
    await this.ensureReady();
    await this.ops.deleteMany(COLLECTION, {});
  }

  async claim(key: string, ttlMs?: number): Promise<boolean> {
    if (key.trim() === '') throw new TypeError('Dedup claim key must be non-empty.');
    if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)) {
      throw new TypeError('Dedup claim TTL must be a positive integer.');
    }

    await this.ensureReady();
    const claimedAt = this.#now();
    const expiresAt = ttlMs === undefined
      ? null
      : new Date(claimedAt.getTime() + ttlMs);

    try {
      await this.ops.insertOne<ClaimRow>(COLLECTION, {
        claim_key: key,
        claimed_at: claimedAt,
        expires_at: expiresAt,
      });
      return true;
    } catch (error) {
      if (!(error instanceof UniqueViolationError)) throw error;
    }

    let claimed = false;
    const row = await this.ops.updateAtomic<ClaimRow>(
      COLLECTION,
      { claim_key: key },
      (current) => {
        if (current.expires_at === null || current.expires_at.getTime() > claimedAt.getTime()) {
          return null;
        }
        claimed = true;
        return {
          claimed_at: claimedAt,
          expires_at: expiresAt,
        };
      },
    );
    if (!row) throw new Error('Durable dedup claim disappeared during update.');
    return claimed;
  }
}
