import { AsyncLocalStorage } from 'node:async_hooks';

import type { SlackAdapter } from '@chat-adapter/slack';
import type {
  Message,
  MessageDeletedEvent,
  SentMessage,
  StateAdapter,
  Thread,
  WebhookOptions,
} from 'chat';

import {
  CHANNEL_MEMORY_CONTRACT_VERSION,
  type ChannelBoundaryId,
  type ChannelEnrollment,
  type MembershipApplyResult,
  type MembershipFact,
} from '../../channel-memory/registry/index.js';
import {
  deduplicate,
  isSkip,
  normalize,
  responsePrecheckDenyReason,
  sentAtFrom,
  type IdempotencyLedger,
  type NormalizedEvent,
} from '../../ingestion/events/index.js';
import type {
  AmbientNormalizedEvent,
  AmbientPersistenceInput,
  AmbientPersistenceResult,
  ChannelMessagePersistenceResult,
  ChannelMessageRecord,
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
import { messageKey, resolveIdentity } from '../memory/resource-policy.js';
import { createSlackChannel, GIST_USER_NAME, type GistSlackChannel } from './index.js';
import type { ProactiveActionEvaluator } from './proactive.js';
import type { ChannelLogger, ChannelRequest, SlackChannelOptions } from './types.js';

const DELIVERY_TTL_MS = 24 * 60 * 60 * 1_000;
const CONTENT_TTL_MS = 10 * 60 * 1_000;
const MISSING_DELIVERY_CONTEXT_WARN_INTERVAL_MS = 60_000;
const SLACK_TS = /^\d+\.\d+$/;

interface SlackDeliveryContext {
  readonly eventId: string;
  readonly externalChannel: boolean;
  readonly rawEvent: Record<string, unknown>;
  readonly workspaceId: string | null;
  capturePromise?: Promise<CaptureRouteResult>;
}

interface CaptureRouteResult {
  readonly responseEligible: boolean;
  readonly trigger?: 'edit_mention' | 'proactive';
}

interface DispatchableSlackAdapter {
  processEventPayload(payload: Record<string, unknown>, options?: WebhookOptions): void;
}

export interface AmbientPersister {
  persist(input: AmbientPersistenceInput): Promise<AmbientPersistenceResult>;
}

export interface ChannelMessagePersister {
  persist(record: ChannelMessageRecord): Promise<ChannelMessagePersistenceResult>;
}

export interface LiveMutationHandler {
  handle(input: HandleMutationInput): Promise<MutationOutcome>;
  shouldSuppressOriginal(input: CheckOriginalInput): Promise<OriginalSuppressionOutcome>;
}

/** T602 surface used by live transport. */
export interface LiveChannelEnrollment {
  applyMembershipFact(fact: MembershipFact): Promise<MembershipApplyResult>;
  captureEligibilityFor(
    boundaryId: ChannelBoundaryId,
    messageTs: string,
  ): Promise<{
    readonly capture: boolean;
    readonly reason: 'channel_not_enrolled' | 'before_capture_floor' | 'malformed_event' | null;
    readonly enrollment_epoch: number | null;
  }>;
  enrollmentFor(boundaryId: ChannelBoundaryId): Promise<ChannelEnrollment | null>;
}

export interface ChannelMemoryMetrics {
  capture(fields: {
    readonly outcome: 'captured' | 'skipped' | 'failed';
    readonly reason: string | null;
    readonly senderClass: NormalizedEvent['sender_class'] | null;
    readonly source: 'live_event' | 'outgoing_self';
  }): void;
  edit(fields: { readonly outcome: MutationOutcome['status'] }): void;
}

const NOOP_METRICS: ChannelMemoryMetrics = {
  capture: () => undefined,
  edit: () => undefined,
};

export interface LiveSlackChannelOptions extends SlackChannelOptions {
  readonly policy: PolicySnapshot;
  /** Membership-authoritative authorizer used only after successful live capture. */
  readonly authorizeCaptured?: SlackChannelOptions['authorize'];
  readonly resolveSender: SenderResolver;
  /** Legacy T405 writer. Used only when P06 ports are absent. */
  readonly ambientPersistence?: AmbientPersister;
  readonly mutations: LiveMutationHandler;
  /** P06 ports must be supplied together. */
  readonly enrollment?: LiveChannelEnrollment;
  readonly channelPersistence?: ChannelMessagePersister;
  /** Required for P06: durable atomic delivery/content claims across restart. */
  readonly idempotencyLedger?: IdempotencyLedger;
  readonly metrics?: ChannelMemoryMetrics;
  readonly proactive?: ProactiveActionEvaluator;
  readonly kiloBotId?: string;
  readonly kiloAppId?: string;
  readonly now?: () => Date;
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
  /** Replay Slack-confirmed positive memberships; safe after restart/reconnect. */
  replayMembership(): Promise<void>;
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

function mentionsGist(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

function isNewHumanMention(
  event: NormalizedEvent,
  raw: Record<string, unknown>,
  botUserId: string,
): boolean {
  const previous = asRecord(raw.previous_message);
  const previousText = previous?.text;
  return event.mutation?.kind === 'edit'
    && event.sender_class === 'human'
    && mentionsGist(event.text, botUserId)
    && typeof previousText === 'string'
    && !mentionsGist(previousText, botUserId);
}

function senderId(raw: Record<string, unknown>): string | null {
  if (raw.subtype === 'message_changed') {
    const message = asRecord(raw.message);
    const previous = asRecord(raw.previous_message);
    return stringField(message ?? {}, 'user', 'bot_user_id', 'bot_id', 'app_id')
      ?? stringField(previous ?? {}, 'user', 'bot_user_id', 'bot_id', 'app_id');
  }
  if (raw.subtype === 'message_deleted') {
    return stringField(
      asRecord(raw.previous_message) ?? {},
      'user',
      'bot_user_id',
      'bot_id',
      'app_id',
    );
  }
  return stringField(raw, 'user', 'bot_user_id', 'bot_id', 'app_id');
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

function observationTs(now: Date): string {
  return `${Math.floor(now.getTime() / 1_000)}.${String(now.getTime() % 1_000).padStart(3, '0')}000`;
}

/**
 * Adds ordinary-message and mutation ingestion to the addressed Slack channel.
 * P06 raw interception is outside Chat's thread lock, so capture cannot be
 * dropped by response concurrency control.
 */
export function createLiveSlackChannel(options: LiveSlackChannelOptions): LiveGistSlackChannel {
  const logger = options.logger ?? NOOP_LOGGER;
  const metrics = options.metrics ?? NOOP_METRICS;
  const now = options.now ?? (() => new Date());
  const deliveryContext = new AsyncLocalStorage<SlackDeliveryContext>();
  const p06Enabled = options.enrollment !== undefined && options.channelPersistence !== undefined;
  if ((options.enrollment === undefined) !== (options.channelPersistence === undefined)) {
    throw new TypeError('enrollment and channelPersistence must be supplied together.');
  }
  if (p06Enabled && !options.idempotencyLedger) {
    throw new TypeError('P06 capture requires a durable idempotencyLedger.');
  }
  const ledger = options.idempotencyLedger ?? ledgerFor(options.state);

  const capturedRequests = new WeakSet<ChannelRequest>();
  const preauthorizedRequests = new WeakSet<ChannelRequest>();
  let channel!: GistSlackChannel;
  channel = createSlackChannel({
    ...options,
    authorize: (request) => {
      if (preauthorizedRequests.delete(request)) return { allowed: true, reason: null };
      return capturedRequests.has(request) && options.authorizeCaptured
        ? options.authorizeCaptured(request)
        : options.authorize(request);
    },
    beforeResponse: async (request) => {
      const capture = deliveryContext.getStore()?.capturePromise;
      if (capture) {
        const result = await capture;
        if (!result.responseEligible) return false;
        if (result.trigger === 'edit_mention' || result.trigger === 'proactive') {
          const decision = await (options.authorizeCaptured ?? options.authorize)(request);
          if (!decision.allowed) return false;
          if (result.trigger === 'proactive') {
            try {
              if (!options.proactive || !await options.proactive.evaluate(request)) return false;
            } catch {
              logger.error('channel.proactive.classification.failed', {
                errorClass: 'model_unavailable',
              });
              return false;
            }
          }
          preauthorizedRequests.add(request);
        }
        capturedRequests.add(request);
      }
      return options.beforeResponse ? options.beforeResponse(request) : true;
    },
    onOutgoingMessage: async (request, message) => {
      if (p06Enabled) await persistOutgoing(request, message);
      await options.onOutgoingMessage?.(request, message);
    },
  });

  const dispatch = channel.adapter as unknown as DispatchableSlackAdapter;
  const processEventPayload = dispatch.processEventPayload.bind(channel.adapter);
  const pending = new Set<Promise<unknown>>();
  const channelQueues = new Map<string, Promise<unknown>>();
  let lastMissingDeliveryContextWarnAt: number | null = null;

  function track<T>(task: Promise<T>): Promise<T> {
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  }

  function enqueueDelivery(context: SlackDeliveryContext): Promise<CaptureRouteResult> {
    const key = stringField(context.rawEvent, 'channel') ?? context.eventId;
    const previous = channelQueues.get(key) ?? Promise.resolve();
    const task = previous.then(() => routeRawDelivery(context));
    const settled = task.then(() => undefined, () => undefined);
    channelQueues.set(key, settled);
    void settled.then(() => {
      if (channelQueues.get(key) === settled) channelQueues.delete(key);
    });
    return task;
  }

  function warnMissingDeliveryContext(): void {
    const timestamp = Date.now();
    if (
      lastMissingDeliveryContextWarnAt !== null &&
      timestamp - lastMissingDeliveryContextWarnAt < MISSING_DELIVERY_CONTEXT_WARN_INTERVAL_MS
    ) return;

    lastMissingDeliveryContextWarnAt = timestamp;
    logger.warn('ingestion.delivery_context.missing', { reason: 'missing_delivery_context' });
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
    const context: SlackDeliveryContext = {
      eventId,
      externalChannel,
      rawEvent,
      workspaceId: stringField(rawEvent, 'team', 'team_id') ?? stringField(payload, 'team_id'),
    };
    if (p06Enabled) {
      context.capturePromise = track(enqueueDelivery(context).catch(() => {
        logger.error('ingestion.persistence.failed', { errorClass: 'internal' });
        return { responseEligible: false };
      }));
      webhookOptions?.waitUntil?.(context.capturePromise);
    }

    deliveryContext.run(context, () => {
      processEventPayload(
        externalChannel && payload.is_ext_shared_channel !== true
          ? { ...payload, is_ext_shared_channel: true }
          : payload,
        webhookOptions,
      );
    });
  };

  async function normalizeDelivery(
    delivery: SlackDeliveryContext,
    subscribedThread?: boolean,
  ): Promise<NormalizedEvent | null> {
    const botUserId = channel.adapter.botUserId;
    if (!botUserId) {
      logger.warn('ingestion.event.skipped', { reason: 'malformed_event' });
      return null;
    }

    const workspaceId = delivery.workspaceId;
    const userId = senderId(delivery.rawEvent);
    if (!workspaceId || !userId) {
      logger.warn('ingestion.event.skipped', { reason: 'malformed_event' });
      return null;
    }

    let attributes = null;
    try {
      attributes = await options.resolveSender({ workspaceId, senderId: userId });
    } catch {
      // Normalization can still classify configured/raw automation identities.
    }

    let subscribed = subscribedThread;
    if (subscribed === undefined) {
      const channelId = stringField(delivery.rawEvent, 'channel');
      const messageTs = stringField(delivery.rawEvent, 'thread_ts', 'ts');
      if (channelId && messageTs) {
        try {
          subscribed = await options.state.isSubscribed(
            channel.adapter.encodeThreadId({ channel: channelId, threadTs: messageTs }),
          );
        } catch {
          subscribed = false;
        }
      }
    }

    const normalizedRaw = stringField(delivery.rawEvent, 'team', 'team_id') || !workspaceId
      ? delivery.rawEvent
      : { ...delivery.rawEvent, team: workspaceId };
    const result = normalize(normalizedRaw, {
      bot_user_id: botUserId,
      delivery_event_id: delivery.eventId,
      subscribed_thread: subscribed === true,
      ...(options.kiloBotId === undefined ? {} : { kilo_bot_id: options.kiloBotId }),
      ...(options.kiloAppId === undefined ? {} : { kilo_app_id: options.kiloAppId }),
      ...(attributes === null ? {} : {
        sender_attributes: {
          sender_type: attributes.senderType,
          is_external: attributes.isExternal || delivery.externalChannel,
          is_guest: attributes.isGuest,
          is_deactivated: attributes.isDeactivated,
          ...(attributes.displayName === undefined
            ? {}
            : { display_name: attributes.displayName }),
        },
      }),
    });
    if (isSkip(result)) {
      logger.debug('ingestion.event.skipped', { reason: result.skip });
      return null;
    }
    return result;
  }

  function identity(event: NormalizedEvent) {
    try {
      // Channel boundaries key on workspace/channel, but legacy T202 validates
      // sender IDs as U/W. Preserve canonical B/A sender on the record while
      // using Gist's verified Slack user solely to resolve channel structure.
      const identityEvent = event.conversation_type === 'channel' && !/^[UW]/.test(event.sender_id)
        ? { ...event, sender_id: channel.adapter.botUserId ?? '' }
        : event;
      return resolveIdentity(identityEvent);
    } catch {
      logger.info('ingestion.event.skipped', { reason: 'identity_unresolved' });
      return null;
    }
  }

  async function routeRawDelivery(delivery: SlackDeliveryContext): Promise<CaptureRouteResult> {
    const rawType = stringField(delivery.rawEvent, 'type');
    if (rawType === 'member_joined_channel' || rawType === 'member_left_channel') {
      await applyRawMembership(delivery, rawType);
      return { responseEligible: false };
    }
    if (rawType !== 'message' && rawType !== 'app_mention') {
      return { responseEligible: false };
    }

    const event = await normalizeDelivery(delivery);
    if (!event) {
      metrics.capture({
        outcome: 'skipped',
        reason: 'malformed_event',
        senderClass: null,
        source: 'live_event',
      });
      return { responseEligible: false };
    }
    if (event.conversation_type !== 'channel') return { responseEligible: true };
    if (
      event.workspace_id !== options.policy.approved_workspace_id ||
      delivery.externalChannel
    ) {
      metrics.capture({
        outcome: 'skipped',
        reason: event.workspace_id !== options.policy.approved_workspace_id
          ? 'unapproved_workspace'
          : 'channel_not_enrolled',
        senderClass: event.sender_class,
        source: 'live_event',
      });
      return { responseEligible: false };
    }

    const resolved = identity(event);
    if (!resolved || !resolved.boundary_id.startsWith('ch:')) {
      return { responseEligible: false };
    }

    const duplicate = await deduplicate(event, ledger, {
      deliveryTtlMs: DELIVERY_TTL_MS,
      contentTtlMs: CONTENT_TTL_MS,
    });
    if (duplicate.skip) {
      metrics.capture({
        outcome: 'skipped',
        reason: duplicate.skip,
        senderClass: event.sender_class,
        source: 'live_event',
      });
      return { responseEligible: false };
    }

    if (event.class === 'mutation') {
      const outcome = await options.mutations.handle({
        event: { ...event, contract_version: '1.0.0', class: 'mutation' },
        identity: resolved,
      });
      if (event.mutation?.kind === 'edit') metrics.edit({ outcome: outcome.status });
      const botUserId = channel.adapter.botUserId;
      if (
        outcome.status === 'updated'
        && botUserId !== undefined
        && isNewHumanMention(event, delivery.rawEvent, botUserId)
      ) {
        return { responseEligible: true, trigger: 'edit_mention' };
      }
      return { responseEligible: false };
    }

    const enrollment = await options.enrollment!.captureEligibilityFor(
      resolved.boundary_id as ChannelBoundaryId,
      event.message_ts,
    );
    if (!enrollment.capture || enrollment.enrollment_epoch === null) {
      metrics.capture({
        outcome: 'skipped',
        reason: enrollment.reason,
        senderClass: event.sender_class,
        source: 'live_event',
      });
      return { responseEligible: false };
    }

    const record: ChannelMessageRecord = {
      contract_version: '1.0.0',
      message_key: duplicate.message_key!,
      boundary_id: resolved.boundary_id as ChannelBoundaryId,
      thread_id: resolved.thread_id,
      workspace_id: event.workspace_id,
      channel_id: event.channel_id,
      message_ts: event.message_ts,
      thread_root_ts: event.thread_root_ts,
      is_thread_reply: event.is_thread_reply,
      sender: event.sender,
      sent_at: event.sent_at,
      edited_at: null,
      text: event.text,
      files: event.files,
      links: event.links,
      capture_source: 'live_event',
      ingested_at: now().toISOString(),
      enrollment_epoch: enrollment.enrollment_epoch,
    };
    const result = await options.channelPersistence!.persist(record);
    const captured = result.outcome === 'inserted' || result.outcome === 'unchanged';
    metrics.capture({
      outcome: captured ? 'captured' : result.outcome === 'failed' ? 'failed' : 'skipped',
      reason: result.outcome === 'failed' || result.outcome === 'skipped'
        ? result.reason
        : null,
      senderClass: event.sender_class,
      source: 'live_event',
    });
    if (!captured) {
      logger.error('ingestion.persistence.failed', {
        errorClass: result.outcome === 'failed' ? 'storage_unavailable' : 'internal',
      });
      return { responseEligible: false };
    }

    if (responsePrecheckDenyReason(event) === null) return { responseEligible: true };
    if (
      event.class === 'ambient'
      && event.sender_class === 'human'
      && !event.addressed_to_gist
      && options.proactive?.isEnabled(event.channel_id) === true
    ) {
      return { responseEligible: true, trigger: 'proactive' };
    }
    return { responseEligible: false };
  }

  async function applyRawMembership(
    delivery: SlackDeliveryContext,
    kind: 'member_joined_channel' | 'member_left_channel',
  ): Promise<void> {
    const botUserId = channel.adapter.botUserId;
    const workspaceId = delivery.workspaceId;
    const channelId = stringField(delivery.rawEvent, 'channel');
    const eventTs = stringField(delivery.rawEvent, 'event_ts', 'ts');
    if (
      !botUserId ||
      stringField(delivery.rawEvent, 'user') !== botUserId ||
      workspaceId !== options.policy.approved_workspace_id ||
      !channelId ||
      !eventTs ||
      !SLACK_TS.test(eventTs) ||
      (kind === 'member_joined_channel' && delivery.externalChannel)
    ) return;

    const boundary = resolveIdentity({
      contract_version: '1.0.0',
      workspace_id: workspaceId,
      channel_id: channelId,
      conversation_type: 'channel',
      message_ts: eventTs,
      thread_ts: null,
      sender_id: botUserId,
    }).boundary_id as ChannelBoundaryId;
    const fact: MembershipFact = {
      contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
      boundary_id: boundary,
      workspace_id: workspaceId,
      channel_id: channelId,
      verification: 'slack_gist_membership',
      kind,
      ts: eventTs,
      event_id: delivery.eventId,
    };
    const result = await options.enrollment!.applyMembershipFact(fact);
    logger.info('channel.membership.applied', {
      outcome: result.outcome,
      reason: result.reason,
      kind,
    });
  }

  async function replayMembership(): Promise<void> {
    if (!p06Enabled) return;
    const botUserId = channel.adapter.botUserId;
    if (!botUserId) throw new Error('Slack bot identity unavailable for membership replay.');

    let cursor: string | undefined;
    do {
      const response = await channel.adapter.webClient.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (response.ok !== true || !Array.isArray(response.channels)) {
        throw new Error('Slack membership replay unavailable.');
      }

      for (const candidate of response.channels) {
        if (!candidate || candidate.is_member !== true || candidate.is_ext_shared === true) continue;
        const channelId = candidate.id;
        if (typeof channelId !== 'string' || !/^[CG][A-Z0-9]{8,}$/.test(channelId)) continue;
        const ts = observationTs(now());
        const boundary = resolveIdentity({
          contract_version: '1.0.0',
          workspace_id: options.policy.approved_workspace_id,
          channel_id: channelId,
          conversation_type: 'channel',
          message_ts: ts,
          thread_ts: null,
          sender_id: botUserId,
        }).boundary_id as ChannelBoundaryId;
        await options.enrollment!.applyMembershipFact({
          contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
          boundary_id: boundary,
          workspace_id: options.policy.approved_workspace_id,
          channel_id: channelId,
          verification: 'slack_gist_membership',
          kind: 'conversations_members',
          state: 'enrolled',
          ts,
        });
      }

      const next = response.response_metadata?.next_cursor;
      cursor = typeof next === 'string' && next !== '' ? next : undefined;
    } while (cursor !== undefined);
  }

  async function persistOutgoing(
    request: ChannelRequest,
    sent: SentMessage | undefined,
  ): Promise<void> {
    if (request.isDirectMessage || !request.workspaceId || !sent) return;
    const raw = asRecord(sent.raw) ?? {};
    const rawMessage = asRecord(raw.message) ?? raw;
    const messageTs = stringField(raw, 'ts') ?? stringField(rawMessage, 'ts')
      ?? (SLACK_TS.test(sent.id) ? sent.id : null);
    if (!messageTs) return; // CM-FR-010: never guess an outgoing identity.

    const decoded = channel.adapter.decodeThreadId(sent.threadId || request.threadId);
    const channelId = decoded.channel;
    if (!channelId) return;
    const threadRootTs = stringField(rawMessage, 'thread_ts') || decoded.threadTs || messageTs;
    const sentAt = sentAtFrom(messageTs);
    const botUserId = channel.adapter.botUserId;
    if (!sentAt || !botUserId) return;

    const resolved = resolveIdentity({
      contract_version: '1.0.0',
      workspace_id: request.workspaceId,
      channel_id: channelId,
      conversation_type: 'channel',
      message_ts: messageTs,
      thread_ts: threadRootTs === messageTs ? null : threadRootTs,
      sender_id: botUserId,
    });
    const enrollment = await options.enrollment!.captureEligibilityFor(
      resolved.boundary_id as ChannelBoundaryId,
      messageTs,
    );
    if (!enrollment.capture || enrollment.enrollment_epoch === null) return;

    const text = typeof sent.text === 'string'
      ? sent.text
      : stringField(rawMessage, 'text') ?? '';
    const record: ChannelMessageRecord = {
      contract_version: '1.0.0',
      message_key: messageKey({
        workspace_id: request.workspaceId,
        channel_id: channelId,
        message_ts: messageTs,
      }),
      boundary_id: resolved.boundary_id as ChannelBoundaryId,
      thread_id: resolved.thread_id,
      workspace_id: request.workspaceId,
      channel_id: channelId,
      message_ts: messageTs,
      thread_root_ts: threadRootTs,
      is_thread_reply: threadRootTs !== messageTs,
      sender: {
        sender_class: 'gist',
        sender_id: botUserId,
        sender_display_name: options.userName ?? GIST_USER_NAME,
        bot_id: stringField(rawMessage, 'bot_id'),
        app_id: stringField(rawMessage, 'app_id'),
        username: stringField(rawMessage, 'username'),
        is_gist_self: true,
        is_external: false,
        is_guest: false,
      },
      sent_at: sentAt,
      edited_at: null,
      text,
      files: [],
      links: [],
      capture_source: 'outgoing_self',
      ingested_at: now().toISOString(),
      enrollment_epoch: enrollment.enrollment_epoch,
    };
    const result = await options.channelPersistence!.persist(record);
    const captured = result.outcome === 'inserted' || result.outcome === 'unchanged';
    metrics.capture({
      outcome: captured ? 'captured' : result.outcome === 'failed' ? 'failed' : 'skipped',
      reason: result.outcome === 'failed' || result.outcome === 'skipped'
        ? result.reason
        : null,
      senderClass: 'gist',
      source: 'outgoing_self',
    });
  }

  // Legacy SDK-handler ingestion remains for existing DM/v1 composition only.
  async function normalized(subscribedThread: boolean): Promise<NormalizedEvent | null> {
    const delivery = deliveryContext.getStore();
    if (!delivery) {
      warnMissingDeliveryContext();
      return null;
    }
    return normalizeDelivery(delivery, subscribedThread);
  }

  function accept(event: NormalizedEvent) {
    const resolved = identity(event);
    if (!resolved) return null;
    const decision = authorize({
      contract_version: AUTHORIZATION_CONTRACT_VERSION,
      gate: 'accept_event',
      event,
      identity: resolved,
      policy: options.policy,
    });
    if (!decision.allowed) {
      logger.info('ingestion.event.denied', { reason: decision.reason });
      return null;
    }
    return resolved;
  }

  async function ingestMessage(message: Message, subscribedThread: boolean): Promise<void> {
    if (isIgnorable(message)) {
      logger.debug('ingestion.event.skipped', { reason: 'non_human_sender' });
      return;
    }
    try {
      const event = await normalized(subscribedThread);
      if (!event || event.class === 'mutation' || event.conversation_type !== 'channel') return;
      const resolved = accept(event);
      if (!resolved) return;
      const duplicate = await deduplicate(event, ledger, {
        deliveryTtlMs: DELIVERY_TTL_MS,
        contentTtlMs: CONTENT_TTL_MS,
      });
      if (duplicate.skip) return;
      const persistenceEvent = ambientProjection(event);
      const suppression = await options.mutations.shouldSuppressOriginal({
        event: persistenceEvent,
        identity: resolved,
      });
      if (suppression.status !== 'allowed' || suppression.suppressed) return;
      const result = await options.ambientPersistence!.persist({
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
    if (isIgnorable(message)) return;
    try {
      const event = await normalized(false);
      if (!event || event.class !== 'mutation') return;
      const resolved = accept(event);
      if (!resolved) return;
      const duplicate = await deduplicate(event, ledger, {
        deliveryTtlMs: DELIVERY_TTL_MS,
        contentTtlMs: CONTENT_TTL_MS,
      });
      if (duplicate.skip) return;
      await options.mutations.handle({
        event: { ...event, contract_version: '1.0.0', class: 'mutation' },
        identity: resolved,
      });
    } catch {
      logger.error('ingestion.mutation.failed', { errorClass: 'storage_unavailable' });
    }
  }

  const liveHandlers: LiveIngestionHandlers = {
    onAmbientMessage: async (thread, message) => {
      if (!p06Enabled) {
        await ingestMessage(message, false);
        return;
      }
      const capture = deliveryContext.getStore()?.capturePromise;
      if (!capture) {
        warnMissingDeliveryContext();
        return;
      }
      if ((await capture).trigger === 'proactive') {
        await channel.handlers.onNewMention(thread, message);
      }
    },
    onSubscribedMessage: async (_thread, message) => ingestMessage(message, true),
    onMessageUpdated: async (thread, message) => {
      if (!p06Enabled) {
        await handleMutation(message);
        return;
      }
      const capture = deliveryContext.getStore()?.capturePromise;
      if (!capture) {
        warnMissingDeliveryContext();
        return;
      }
      if ((await capture).responseEligible) {
        await channel.handlers.onNewMention(thread, message);
      }
    },
    onMessageDeleted: async (event) => handleMutation(event.previousMessage),
  };

  if (p06Enabled) {
    if (options.proactive?.hasChannels === true) {
      channel.bot.onNewMessage(/[\s\S]*/, liveHandlers.onAmbientMessage);
    }
    channel.bot.onMessageUpdated(liveHandlers.onMessageUpdated);
  } else {
    if (!options.ambientPersistence) {
      throw new TypeError('ambientPersistence is required without P06 capture ports.');
    }
    channel.bot.onNewMessage(/[\s\S]*/, liveHandlers.onAmbientMessage);
    channel.bot.onSubscribedMessage(liveHandlers.onSubscribedMessage);
    channel.bot.onMessageUpdated(liveHandlers.onMessageUpdated);
    channel.bot.onMessageDeleted(liveHandlers.onMessageDeleted);
  }

  return {
    ...channel,
    liveHandlers,
    replayMembership,
    start: async () => {
      await channel.start();
      await replayMembership();
    },
    stop: async () => {
      await channel.stop();
      await Promise.allSettled([...pending]);
    },
  };
}
