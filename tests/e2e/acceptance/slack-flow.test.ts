import { describe, expect, it, vi } from 'vitest';

import { parseConfig } from '../../../src/config.js';
import {
  ChannelError,
  USER_FACING_MESSAGE,
  createSlackChannel,
} from '../../../src/mastra/channels/index.js';
import { makeMessage, makeOptions, makeThread, SYNTHETIC } from '../../channels/helpers.js';
import {
  channelMessage,
  envelope,
  makeHarness,
  mentionEvent,
} from '../../spikes/slack-events/helpers.js';
import { AMBIENT_FIXTURES } from '../live-ingestion/fixtures.js';
import { createAmbientE2EHarness, expectSilent } from '../live-ingestion/helpers.js';

const CONFIG = {
  SLACK_BOT_TOKEN: SYNTHETIC.botToken,
  SLACK_APP_TOKEN: SYNTHETIC.appToken,
  GIST_APPROVED_WORKSPACE_ID: SYNTHETIC.workspaceApproved,
  GIST_APPROVED_CHANNEL_IDS: SYNTHETIC.channelApproved,
  GIST_USER_ALLOWLIST: '',
  GIST_DM_SHARED_KNOWLEDGE: 'false',
  GIST_MODEL: 'gpt-4.1',
  EMBEDDING_MODEL: 'openai/text-embedding-3-small',
  OPENAI_API_KEY: 'synthetic-openai-key',
  MASTRA_DATABASE_URL: 'file:/tmp/t501-acceptance.db',
} as const;

describe('T501 configuration and Slack acceptance', () => {
  it('loads validated production configuration without defaults for credentials or boundaries', () => {
    expect(parseConfig(CONFIG)).toMatchObject({
      approvedWorkspaceId: SYNTHETIC.workspaceApproved,
      approvedChannelIds: [SYNTHETIC.channelApproved],
      dmSharedKnowledge: false,
      gistModel: 'gpt-4.1',
      databaseUrl: CONFIG.MASTRA_DATABASE_URL,
    });
    expect(() => parseConfig({ ...CONFIG, SLACK_APP_TOKEN: undefined }))
      .toThrow('Invalid configuration: SLACK_APP_TOKEN');
  });

  it('constructs and starts the Slack adapter in Socket Mode', async () => {
    const { options } = makeOptions();
    const channel = createSlackChannel(options);
    const initialize = vi.spyOn(channel.bot, 'initialize').mockResolvedValue();
    const shutdown = vi.spyOn(channel.bot, 'shutdown').mockResolvedValue();

    expect((channel.adapter as unknown as { mode: string }).mode).toBe('socket');
    await channel.start();
    await channel.stop();

    expect(initialize).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('AC-01: answers one DM and retains its private Slack thread identity', async () => {
    const { options, respondCalls } = makeOptions();
    const channel = createSlackChannel(options);
    const dm = makeThread({
      isDM: true,
      channelId: SYNTHETIC.dmConversation,
      threadId: `slack:${SYNTHETIC.dmConversation}:1735689650.000100`,
    });

    await channel.handlers.onDirectMessage(dm.thread, makeMessage());

    expect(dm.posts).toHaveLength(1);
    expect(respondCalls).toEqual([
      expect.objectContaining({
        surface: 'dm',
        channelId: SYNTHETIC.dmConversation,
        threadId: `slack:${SYNTHETIC.dmConversation}:1735689650.000100`,
        isDirectMessage: true,
      }),
    ]);
  });

  it('AC-02: answers one channel mention in the originating thread', async () => {
    const { options, respondCalls } = makeOptions();
    const channel = createSlackChannel(options);
    const thread = makeThread();

    await channel.handlers.onNewMention(thread.thread, makeMessage());

    expect(thread.posts).toHaveLength(1);
    expect(thread.subscribeCalls).toBe(1);
    expect(respondCalls[0]).toMatchObject({
      surface: 'channel_mention',
      channelId: SYNTHETIC.channelApproved,
      threadId: thread.thread.id,
    });
  });

  it('AC-03: keeps an existing thread key available to the follow-up responder', async () => {
    const { options, respondCalls } = makeOptions();
    const channel = createSlackChannel(options);
    const thread = makeThread({
      threadId: `slack:${SYNTHETIC.channelApproved}:1735689000.000100`,
    });

    await channel.handlers.onNewMention(
      thread.thread,
      makeMessage({ ts: '1735689010.000100' }),
    );
    await channel.handlers.onSubscribedMessage(
      thread.thread,
      makeMessage({ ts: '1735689020.000100' }),
    );

    expect(respondCalls.map(({ threadId }) => threadId)).toEqual([
      thread.thread.id,
      thread.thread.id,
    ]);
    expect(thread.posts).toHaveLength(2);
  });

  it('AC-04: distinguishes speakers while continuing the same thread', async () => {
    const { options, respondCalls } = makeOptions();
    const channel = createSlackChannel(options);
    const thread = makeThread();

    await channel.handlers.onNewMention(
      thread.thread,
      makeMessage({ userId: SYNTHETIC.userMember }),
    );
    await channel.handlers.onSubscribedMessage(
      thread.thread,
      makeMessage({ userId: 'U0MEMBER02', ts: '1735689800.000100' }),
    );

    expect(respondCalls.map(({ senderId, threadId }) => ({ senderId, threadId })))
      .toEqual([
        { senderId: SYNTHETIC.userMember, threadId: thread.thread.id },
        { senderId: 'U0MEMBER02', threadId: thread.thread.id },
      ]);
  });

  it('AC-06: deduplicates a Slack redelivery before a second reply', async () => {
    const harness = makeHarness({ registerAmbient: false });
    const delivery = envelope(mentionEvent());

    await harness.deliver(delivery);
    await harness.deliver(delivery);

    expect(harness.log.calls.filter(({ handler }) => handler === 'onNewMention'))
      .toHaveLength(1);
  });

  it('AC-09: stores an ambient channel message with no model call or reply', async () => {
    const harness = createAmbientE2EHarness();

    await harness.deliver(AMBIENT_FIXTURES.root);

    expect(harness.persist).toHaveBeenCalledOnce();
    expectSilent(harness);
  });

  it('AC-12: ignores bot and system traffic without knowledge pollution', async () => {
    const harness = createAmbientE2EHarness();
    const system = envelope(channelMessage({
      subtype: 'channel_join',
      ts: '1735690001.000100',
      event_ts: '1735690001.000100',
    }));

    await harness.deliver(AMBIENT_FIXTURES.bot);
    await harness.deliver(system);

    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.handleMutation).not.toHaveBeenCalled();
    expectSilent(harness);
  });

  it('AC-13: resumes after state reconnect without replaying a reply', async () => {
    const harness = makeHarness({ registerAmbient: false });
    const delivery = envelope(mentionEvent({ ts: '1735690100.000100' }));

    await harness.state.connect();
    await harness.deliver(delivery);
    await harness.state.disconnect();
    await harness.state.connect();
    await harness.deliver(delivery);

    expect((harness.adapter as unknown as { mode: string }).mode).toBe('socket');
    expect(harness.log.calls.filter(({ handler }) => handler === 'onNewMention'))
      .toHaveLength(1);
  });

  it('AC-15: maps provider failure to one friendly reply without internal details', async () => {
    const rawError = 'OPENAI_API_KEY rejected by api.openai.com';
    const { options } = makeOptions({
      respondThrows: new ChannelError('model_unavailable', rawError),
    });
    const channel = createSlackChannel(options);
    const thread = makeThread();

    await channel.handlers.onSubscribedMessage(thread.thread, makeMessage());

    expect(thread.posts).toEqual([USER_FACING_MESSAGE.model_unavailable]);
    expect(String(thread.posts[0])).not.toContain(rawError);
  });
});
