/**
 * Routing behavior: DM, mention, and subscribed-thread turns.
 *
 * Covers FR-SLK-002/003/004/005/007/009 and INV-2 (authorization precedes
 * generation). No Slack call, no socket, no network.
 */

import { describe, expect, it } from 'vitest';

import { createGistHandlers, toChannelRequest } from '../../src/mastra/channels/handlers.js';
import { USER_FACING_MESSAGE } from '../../src/mastra/channels/errors.js';
import { makeMessage, makeOptions, makeThread, SYNTHETIC } from './helpers.js';

describe('DM routing (FR-SLK-002)', () => {
  it('routes one DM to exactly one reply', async () => {
    const { options, respondCalls } = makeOptions({ reply: 'answer' });
    const handlers = createGistHandlers(options);
    const fake = makeThread({ isDM: true, channelId: SYNTHETIC.dmConversation });

    await handlers.onDirectMessage(fake.thread, makeMessage());

    expect(respondCalls).toHaveLength(1);
    expect(fake.posts).toEqual(['answer']);
  });

  it('marks the request as a direct message', async () => {
    const { options, respondCalls } = makeOptions();
    const handlers = createGistHandlers(options);

    await handlers.onDirectMessage(makeThread({ isDM: true }).thread, makeMessage());

    expect(respondCalls[0]?.isDirectMessage).toBe(true);
    expect(respondCalls[0]?.surface).toBe('dm');
  });
});

describe('mention routing (FR-SLK-003/004/005)', () => {
  it('routes one mention to exactly one reply', async () => {
    const { options, respondCalls } = makeOptions({ reply: 'answer' });
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onNewMention(fake.thread, makeMessage());

    expect(respondCalls).toHaveLength(1);
    expect(fake.posts).toEqual(['answer']);
  });

  it('subscribes the thread so follow-ups need no second mention', async () => {
    const { options } = makeOptions();
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onNewMention(fake.thread, makeMessage());

    expect(fake.subscribeCalls).toBe(1);
  });

  it('does not subscribe a thread it is not authorized to answer in', async () => {
    const { options } = makeOptions({
      decision: { allowed: false, reason: 'unapproved_channel' },
    });
    const handlers = createGistHandlers(options);
    const fake = makeThread({ channelId: SYNTHETIC.channelUnapproved });

    await handlers.onNewMention(fake.thread, makeMessage());

    expect(fake.subscribeCalls).toBe(0);
  });

  it('authorizes exactly once per mention turn', async () => {
    const { options, authorizeCalls } = makeOptions();
    const handlers = createGistHandlers(options);

    await handlers.onNewMention(makeThread().thread, makeMessage());

    expect(authorizeCalls).toHaveLength(1);
  });

  it('continues a subscribed thread without a mention', async () => {
    const { options, respondCalls } = makeOptions();
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onSubscribedMessage(fake.thread, makeMessage());

    expect(respondCalls[0]?.surface).toBe('subscribed_thread');
    expect(fake.posts).toHaveLength(1);
    expect(fake.subscribeCalls).toBe(0);
  });
});

describe('sender filtering (FR-SLK-009)', () => {
  const ignorable = [
    { name: 'the bot itself', message: makeMessage({ isMe: true }) },
    { name: 'another bot', message: makeMessage({ isBot: true, userId: SYNTHETIC.bot }) },
    { name: 'an unknown-bot sender', message: makeMessage({ isBot: 'unknown' }) },
    { name: 'a system message', message: makeMessage({ isSystem: true }) },
  ];

  for (const { name, message } of ignorable) {
    it(`ignores ${name} without authorizing, generating, or replying`, async () => {
      const { options, authorizeCalls, respondCalls } = makeOptions();
      const handlers = createGistHandlers(options);
      const fake = makeThread();

      await handlers.onSubscribedMessage(fake.thread, message);

      expect(authorizeCalls).toHaveLength(0);
      expect(respondCalls).toHaveLength(0);
      expect(fake.posts).toHaveLength(0);
    });
  }
});

describe('authorization ordering (INV-2)', () => {
  it('never calls the responder when denied', async () => {
    const { options, respondCalls } = makeOptions({
      decision: { allowed: false, reason: 'guest_user' },
    });
    const handlers = createGistHandlers(options);

    await handlers.onDirectMessage(makeThread({ isDM: true }).thread, makeMessage());

    expect(respondCalls).toHaveLength(0);
  });

  it('shows no typing indicator when denied', async () => {
    const { options } = makeOptions({
      decision: { allowed: false, reason: 'guest_user' },
    });
    const handlers = createGistHandlers(options);
    const fake = makeThread({ isDM: true });

    await handlers.onDirectMessage(fake.thread, makeMessage());

    expect(fake.typingCalls).toBe(0);
  });

  it('replies once with the generic line for a user-scoped denial', async () => {
    const { options } = makeOptions({
      decision: { allowed: false, reason: 'external_user' },
    });
    const handlers = createGistHandlers(options);
    const fake = makeThread({ isDM: true });

    await handlers.onDirectMessage(fake.thread, makeMessage());

    expect(fake.posts).toEqual([USER_FACING_MESSAGE.unauthorized]);
  });

  it('stays completely silent in an unapproved channel (FR-SLK-010)', async () => {
    const { options } = makeOptions({
      decision: { allowed: false, reason: 'unapproved_channel' },
    });
    const handlers = createGistHandlers(options);
    const fake = makeThread({ channelId: SYNTHETIC.channelUnapproved });

    await handlers.onNewMention(fake.thread, makeMessage());

    expect(fake.posts).toHaveLength(0);
  });

  it('stays completely silent for an unapproved workspace', async () => {
    const { options } = makeOptions({
      decision: { allowed: false, reason: 'unapproved_workspace' },
    });
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onNewMention(fake.thread, makeMessage());

    expect(fake.posts).toHaveLength(0);
  });
});

describe('typing indicator (FR-SLK-006)', () => {
  it('signals activity before generating', async () => {
    const { options } = makeOptions();
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onSubscribedMessage(fake.thread, makeMessage());

    expect(fake.typingCalls).toBe(1);
  });

  it('still answers when the typing indicator fails', async () => {
    const { options } = makeOptions({ reply: 'answer' });
    const handlers = createGistHandlers(options);
    const fake = makeThread({ typingThrows: true });

    await handlers.onSubscribedMessage(fake.thread, makeMessage());

    expect(fake.posts).toEqual(['answer']);
  });
});

describe('request normalization', () => {
  it('keeps the Slack ts as a verbatim string (slack-event.md §2)', () => {
    const precise = '1735689600.000200';
    const request = toChannelRequest(
      'channel_mention',
      makeThread().thread,
      makeMessage({ ts: precise }),
      false,
    );

    expect(request.messageTs).toBe(precise);
    expect(typeof request.messageTs).toBe('string');
  });

  it('does not collapse timestamps that differ only in trailing precision', () => {
    const a = toChannelRequest(
      'channel_mention',
      makeThread().thread,
      makeMessage({ ts: '1735689600.000200' }),
      false,
    );
    const b = toChannelRequest(
      'channel_mention',
      makeThread().thread,
      makeMessage({ ts: '1735689600.0002' }),
      false,
    );

    expect(a.messageTs).not.toBe(b.messageTs);
  });

  it('carries sender and workspace identity for downstream authorization', () => {
    const request = toChannelRequest(
      'dm',
      makeThread({ isDM: true }).thread,
      makeMessage({ userId: SYNTHETIC.userMember, team: SYNTHETIC.workspaceApproved }),
      true,
    );

    expect(request.senderId).toBe(SYNTHETIC.userMember);
    expect(request.workspaceId).toBe(SYNTHETIC.workspaceApproved);
  });
});
