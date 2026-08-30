import { AsyncLocalStorage } from 'node:async_hooks';

import type { SlackAdapter } from '@chat-adapter/slack';
import type {
  Message,
  MessageDeletedEvent,
  StateAdapter,
  Thread,
  WebhookOptions,
} from 'chat';

import {
  deduplicate,
  isSkip,
  normalize,
  type IdempotencyLedger,
  type NormalizedEvent,
} from '../../ingestion/events/index.js';
import type {
  AmbientNormalizedEvent,
  AmbientPersistenceInput,
  AmbientPersistenceResult,
} from '../../ingestion/persistence/index.js';
import type {
  CheckOriginalInput,
  HandleMutationInput,
  MutationOutcome,
  OriginalSuppressionOutcome,
} from '../../ingestion/mutations/index.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  authorize,
  type PolicySnapshot,
  type SenderResolver,
} from '../../security/index.js';
import { resolveIdentity } from '../memory/resource-policy.js';
import { createSlackChannel, type GistSlackChannel } from './index.js';
import type { ChannelLogger, SlackChannelOptions } from './types.js';

const DELIVERY_TTL_MS = 24 * 60 * 60 * 1_000;
const CONTENT_TTL_MS = 10 * 60 * 1_000;
const MISSING_DELIVERY_CONTEXT_WARN_INTERVAL_MS = 60_000;

interface SlackDeliveryContext {
  readonly eventId: string;
  readonly externalChannel: boolean;
  readonly rawEvent: Record<string, unknown>;
}

interface DispatchableSlackAdapter {
  processEventPayload(payload: Record<string, unknown>, options?: WebhookOptions): void;
}

export interface AmbientPersister {
  persist(input: AmbientPersistenceInput): Promise<AmbientPersistenceResult>;
}

export interface LiveMutationHandler {
  handle(input: HandleMutationInput): Promise<MutationOutcome>;
  shouldSuppressOriginal(input: CheckOriginalInput): Promise<OriginalSuppressionOutcome>;
}

export interface LiveSlackChannelOptions extends SlackChannelOptions {
  readonly policy: PolicySnapshot;
  readonly resolveSender: SenderResolver;
  readonly ambientPersistence: AmbientPersister;
  readonly mutations: LiveMutationHandler;
}

export interface LiveIngestionHandlers {
  readonly onAmbientMessage: (thread: Thread, message: Message) => Promise<void>;
  readonly onSubscribedMessage: (thread: Thread, message: Message) => Promise<void>;
  readonly onMessageUpdated: (
    thread: Thread,
    message: Message,
    previousMessage?: Message,
  ) => Promise<void>;
  readonly onMessageDeleted: (event: MessageDeletedEvent) => Promise<void>;
}

export interface LiveGistSlackChannel extends GistSlackChannel {
  readonly liveHandlers: LiveIngestionHandlers;
}

const NOOP_LOGGER: ChannelLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown>, ...fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

function senderId(raw: Record<string, unknown>): string | null {
  if (raw.subtype === 'message_changed') {
    const message = asRecord(raw.message);
    const previous = asRecord(raw.previous_message);
    return stringField(message ?? {}, 'user') ?? stringField(previous ?? {}, 'user');
  }
  if (raw.subtype === 'message_deleted') {
    return stringField(asRecord(raw.previous_message) ?? {}, 'user');
  }
  return stringField(raw, 'user');
}

function isIgnorable(message: Message | undefined): boolean {
  if (!message) return false;
  const { isBot, isMe, isSystem } = message.author;
  return isMe || isSystem === true || isBot === true || isBot === 'unknown';
}

function ledgerFor(state: StateAdapter): IdempotencyLedger {
  return {
    claim: (key, ttlMs) => state.setIfNotExists(key, true, ttlMs),
  };
}

function ambientProjection(event: NormalizedEvent): AmbientNormalizedEvent {
  if (event.class === 'mutation') {
    throw new TypeError('Mutation events cannot use message persistence.');
  }
  return {
    ...event,
    contract_version: '1.0.0',
    class: event.class,
  };
}

/**
 * Adds ordinary-message and mutation ingestion to the addressed Slack channel.
 * Silent handlers have no responder or posting dependency: ambient traffic can
 * only normalize, authorize, deduplicate, and write memory.
 */
export function createLiveSlackChannel(options: LiveSlackChannelOptions): LiveGistSlackChannel {
  const channel = createSlackChannel(options);
  const logger = options.logger ?? NOOP_LOGGER;
  const ledger = ledgerFor(options.state);
  const deliveryContext = new AsyncLocalStorage<SlackDeliveryContext>();
  const dispatch = channel.adapter as unknown as DispatchableSlackAdapter;
  const processEventPayload = dispatch.processEventPayload.bind(channel.adapter);
  let lastMissingDeliveryContextWarnAt: number | null = null;

  function warnMissingDeliveryContext(): void {
    const now = Date.now();
    if (
      lastMissingDeliveryContextWarnAt !== null &&
      now - lastMissingDeliveryContextWarnAt < MISSING_DELIVERY_CONTEXT_WARN_INTERVAL_MS
    ) return;

    lastMissingDeliveryContextWarnAt = now;
    logger.warn('ingestion.delivery_context.missing', {
      reason: 'missing_delivery_context',
    });
  }

  dispatch.processEventPayload = (payload, webhookOptions) => {
    const rawEvent = asRecord(payload.event);
    const eventId = stringField(payload, 'event_id');
    if (payload.type !== 'event_callback' || rawEvent === null || eventId === null) {
      processEventPayload(payload, webhookOptions);
      return;
    }
    const externalChannel =
      payload.is_ext_shared_channel === true ||
      rawEvent.is_ext_shared === true ||
      rawEvent.is_ext_shared_channel === true;
    deliveryContext.run({ eventId, externalChannel, rawEvent }, () => {
      processEventPayload(
        externalChannel && payload.is_ext_shared_channel !== true
          ? { ...payload, is_ext_shared_channel: true }
          : payload,
        webhookOptions,
      );
    });
  };

  async function normalized(subscribedThread: boolean): Promise<NormalizedEvent | null> {
    const delivery = deliveryContext.getStore();
    if (!delivery) {
      warnMissingDeliveryContext();
      return null;
    }

    const botUserId = channel.adapter.botUserId;
    if (!botUserId) {
      logger.warn('ingestion.event.skipped', { reason: 'malformed_event' });
      return null;
    }

    const workspaceId = stringField(delivery.rawEvent, 'team', 'team_id');
    const userId = senderId(delivery.rawEvent);
    if (!workspaceId || !userId) {
      logger.warn('ingestion.event.skipped', { reason: 'malformed_event' });
      return null;
    }

    let attributes;
    try {
      attributes = await options.resolveSender({ workspaceId, senderId: userId });
    } catch {
      attributes = null;
    }
    if (!attributes) {
      logger.info('ingestion.event.skipped', { reason: 'identity_unresolved' });
      return null;
    }

    const result = normalize(delivery.rawEvent, {
      bot_user_id: botUserId,
      delivery_event_id: delivery.eventId,
      subscribed_thread: subscribedThread,
      sender_attributes: {
        sender_type: attributes.senderType,
        is_external: attributes.isExternal || delivery.externalChannel,
        is_guest: attributes.isGuest,
        is_deactivated: attributes.isDeactivated,
      },
    });
    if (isSkip(result)) {
      logger.debug('ingestion.event.skipped', { reason: result.skip });
      return null;
    }
    return result;
  }

  function accept(event: NormalizedEvent) {
    let identity;
    try {
      identity = resolveIdentity(event);
    } catch {
      logger.info('ingestion.event.skipped', { reason: 'identity_unresolved' });
      return null;
    }

    const decision = authorize({
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      gate: 'accept_event',
      event,
      identity,
      policy: options.policy,
    });
    if (!decision.allowed) {
      logger.info('ingestion.event.denied', { reason: decision.reason });
      return null;
    }
    return identity;
  }

  async function ingestMessage(message: Message, subscribedThread: boolean): Promise<void> {
    if (isIgnorable(message)) {
      logger.debug('ingestion.event.skipped', { reason: 'non_human_sender' });
      return;
    }

    try {
      const event = await normalized(subscribedThread);
      if (!event || event.class === 'mutation' || event.conversation_type !== 'channel') return;
      const identity = accept(event);
      if (!identity) return;

      const duplicate = await deduplicate(event, ledger, {
        deliveryTtlMs: DELIVERY_TTL_MS,
        contentTtlMs: CONTENT_TTL_MS,
      });
      if (duplicate.skip) {
        logger.debug('ingestion.event.skipped', { reason: duplicate.skip });
        return;
      }

      const persistenceEvent = ambientProjection(event);
      const suppression = await options.mutations.shouldSuppressOriginal({
        event: persistenceEvent,
        identity,
      });
      if (suppression.status !== 'allowed' || suppression.suppressed) return;

      const result = await options.ambientPersistence.persist({
        event: persistenceEvent,
        sender_name: message.author.fullName,
      });
      if (result.outcome === 'failed') {
        logger.error('ingestion.persistence.failed', { errorClass: 'storage_unavailable' });
      }
    } catch {
      logger.error('ingestion.persistence.failed', { errorClass: 'internal' });
    }
  }

  async function handleMutation(message?: Message): Promise<void> {
    if (isIgnorable(message)) {
      logger.debug('ingestion.event.skipped', { reason: 'non_human_sender' });
      return;
    }

    try {
      const event = await normalized(false);
      if (!event || event.class !== 'mutation') return;
      const identity = accept(event);
      if (!identity) return;

      const duplicate = await deduplicate(event, ledger, {
        deliveryTtlMs: DELIVERY_TTL_MS,
        contentTtlMs: CONTENT_TTL_MS,
      });
      if (duplicate.skip) {
        logger.debug('ingestion.event.skipped', { reason: duplicate.skip });
        return;
      }

      await options.mutations.handle({
        event: { ...event, contract_version: '1.0.0', class: 'mutation' },
        identity,
      });
    } catch {
      logger.error('ingestion.mutation.failed', { errorClass: 'storage_unavailable' });
    }
  }

  const liveHandlers: LiveIngestionHandlers = {
    onAmbientMessage: async (_thread, message) => ingestMessage(message, false),
    onSubscribedMessage: async (_thread, message) => ingestMessage(message, true),
    onMessageUpdated: async (_thread, message) => handleMutation(message),
    onMessageDeleted: async (event) => handleMutation(event.previousMessage),
  };

  channel.bot.onNewMessage(/[\s\S]*/, liveHandlers.onAmbientMessage);
  channel.bot.onSubscribedMessage(liveHandlers.onSubscribedMessage);
  channel.bot.onMessageUpdated(liveHandlers.onMessageUpdated);
  channel.bot.onMessageDeleted(liveHandlers.onMessageDeleted);

  return { ...channel, liveHandlers };
}
