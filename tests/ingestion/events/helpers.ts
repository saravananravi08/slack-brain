/**
 * Synthetic raw Slack events for the normalization suite.
 *
 * Identifiers follow docs/architecture/contracts/fixtures/manifest.json. No
 * real workspace, channel, user, or message content appears here, and nothing
 * in this directory performs I/O beyond reading the frozen contract fixtures.
 *
 * The event shapes mirror what T401 recorded the pinned adapter delivering
 * (docs/spikes/slack-event-support.md §6): a `message` / `app_mention` inner
 * event, optionally inside an `event_callback` envelope carrying `event_id`.
 */

import type {
  NormalizationContext,
  SenderAttributes,
} from '../../../src/ingestion/events/types.js';

export const SYNTHETIC = {
  workspace: 'T0SYNTH01',
  otherWorkspace: 'T0SYNTH99',
  channel: 'C0APPROVED1',
  privateChannel: 'G0APPROVED1',
  dmConversation: 'D0DMCONV01',
  user: 'U0MEMBER01',
  otherUser: 'U0MEMBER02',
  botUserId: 'U0GISTBOT1',
  botId: 'B0GISTBOT1',
  kiloUserId: 'U0KILOBOT1',
  kiloBotId: 'B0KILOBOT1',
  kiloAppId: 'A0KILOAPP1',
  otherBotId: 'B0OTHERBOT',
  otherBotUserId: 'U0OTHERBOT1',
  appId: 'A0SYNTHAPP',
  rootTs: '1735689650.000100',
  replyTs: '1735689700.000100',
  ambientTs: '1735689800.000100',
  mutationTs: '1735690000.000100',
  precisionLong: '1735689600.000200',
  precisionShort: '1735689600.0002',
} as const;

export const FULL_MEMBER: SenderAttributes = {
  sender_type: 'human',
  is_external: false,
  is_guest: false,
  is_deactivated: false,
  display_name: 'synthetic-member',
};

/**
 * Overrides accept an explicit `undefined` so a test can express "this field
 * was never resolved" — the case the normalizer must fail closed on. Keys set
 * to `undefined` are dropped rather than assigned, which is what
 * `exactOptionalPropertyTypes` requires of an optional field.
 */
export interface ContextOverrides {
  readonly bot_user_id?: string | undefined;
  readonly bot_id?: string | undefined;
  readonly kilo_bot_id?: string | undefined;
  readonly kilo_app_id?: string | undefined;
  readonly sender_attributes?: SenderAttributes | undefined;
  readonly subscribed_thread?: boolean | undefined;
  readonly delivery_event_id?: string | undefined;
}

export function makeContext(overrides: ContextOverrides = {}): NormalizationContext {
  const merged: Record<string, unknown> = {
    bot_user_id: SYNTHETIC.botUserId,
    bot_id: SYNTHETIC.botId,
    kilo_bot_id: SYNTHETIC.kiloBotId,
    kilo_app_id: SYNTHETIC.kiloAppId,
    sender_attributes: FULL_MEMBER,
    ...overrides,
  };

  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) context[key] = value;
  }
  return context as unknown as NormalizationContext;
}

let envelopeCounter = 0;

/** The `event_callback` wrapper Slack actually sends. */
export function envelope(
  event: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  envelopeCounter += 1;
  return {
    type: 'event_callback',
    event,
    team_id: SYNTHETIC.workspace,
    event_id: `Ev0SYNTH${String(envelopeCounter).padStart(4, '0')}`,
    event_time: 1735689650,
    ...overrides,
  };
}

/** An ordinary human message in a public channel (`message.channels`). */
export function channelMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message',
    channel: SYNTHETIC.channel,
    channel_type: 'channel',
    user: SYNTHETIC.user,
    text: 'rollout window is Tuesday 09:00-11:00 UTC',
    ts: SYNTHETIC.ambientTs,
    event_ts: SYNTHETIC.ambientTs,
    team: SYNTHETIC.workspace,
    ...overrides,
  };
}

export function gistMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    user: SYNTHETIC.botUserId,
    bot_id: SYNTHETIC.botId,
    app_id: 'A0GISTAPP1',
    subtype: 'bot_message',
    ...overrides,
  });
}

export function kiloMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    user: SYNTHETIC.kiloUserId,
    bot_id: SYNTHETIC.kiloBotId,
    app_id: SYNTHETIC.kiloAppId,
    subtype: 'bot_message',
    ...overrides,
  });
}

export function botMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    user: SYNTHETIC.otherBotUserId,
    bot_id: SYNTHETIC.otherBotId,
    subtype: 'bot_message',
    ...overrides,
  });
}

export function appMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    user: undefined,
    app_id: SYNTHETIC.appId,
    username: 'synthetic-app',
    ...overrides,
  });
}

export function directMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    channel: SYNTHETIC.dmConversation,
    channel_type: 'im',
    text: 'what did we decide about the retry policy',
    ts: '1735689600.000100',
    event_ts: '1735689600.000100',
    ...overrides,
  });
}

export function mentionMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return channelMessage({
    type: 'app_mention',
    text: `<@${SYNTHETIC.botUserId}> remind us what the rollout window was`,
    ts: SYNTHETIC.replyTs,
    event_ts: SYNTHETIC.replyTs,
    thread_ts: SYNTHETIC.rootTs,
    ...overrides,
  });
}

export function editEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message',
    subtype: 'message_changed',
    channel: SYNTHETIC.channel,
    channel_type: 'channel',
    ts: SYNTHETIC.mutationTs,
    event_ts: SYNTHETIC.mutationTs,
    team: SYNTHETIC.workspace,
    message: {
      type: 'message',
      user: SYNTHETIC.user,
      text: 'rollout window moved to Wednesday 09:00-11:00 UTC',
      ts: SYNTHETIC.ambientTs,
      edited: { user: SYNTHETIC.user, ts: '1735690000.000000' },
    },
    previous_message: {
      type: 'message',
      user: SYNTHETIC.user,
      text: 'rollout window is Tuesday 09:00-11:00 UTC',
      ts: SYNTHETIC.ambientTs,
    },
    ...overrides,
  };
}

export function deleteEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message',
    subtype: 'message_deleted',
    channel: SYNTHETIC.channel,
    channel_type: 'channel',
    deleted_ts: SYNTHETIC.ambientTs,
    ts: SYNTHETIC.mutationTs,
    event_ts: SYNTHETIC.mutationTs,
    team: SYNTHETIC.workspace,
    previous_message: {
      type: 'message',
      user: SYNTHETIC.user,
      text: 'rollout window is Tuesday 09:00-11:00 UTC',
      ts: SYNTHETIC.ambientTs,
    },
    ...overrides,
  };
}
