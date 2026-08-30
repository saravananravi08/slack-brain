/**
 * Live Slack event normalization and idempotency (T402).
 *
 * Contract: docs/architecture/contracts/slack-event.md.
 * Spike: docs/spikes/slack-event-support.md.
 *
 * The pipeline T405 composes is: raw Slack event → `normalize` → authorize
 * (T203) → `deduplicate` → persist (T403) or mutate (T404). Nothing in this
 * module touches storage, the model, or the Slack API.
 */

export { EVENT_CONTRACT_VERSION, normalize, normalizeThreadTs, sentAtFrom } from './normalize.js';

export {
  CONTENT_KEY_PREFIX,
  DELIVERY_KEY_PREFIX,
  contentClaimKey,
  createInMemoryLedger,
  deduplicate,
  deliveryClaimKey,
} from './dedupe.js';
export type {
  DeduplicationDecision,
  DeduplicationOutcome,
  DeliveryKey,
  IdempotencyLedger,
  MessageKey,
} from './dedupe.js';

export {
  BOT_SUBTYPES,
  CONTENT_BEARING_SUBTYPES,
  DELETE_SUBTYPE,
  EDIT_SUBTYPE,
  SYSTEM_SUBTYPES,
} from './subtypes.js';

export { isSkip } from './types.js';
export type {
  ConversationType,
  EventClass,
  MutationDetail,
  NormalizationContext,
  NormalizationResult,
  NormalizedEvent,
  NormalizerSkipReason,
  SenderAttributes,
  SenderType,
  SkipReason,
  SkipResult,
} from './types.js';
