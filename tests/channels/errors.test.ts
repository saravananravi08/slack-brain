/**
 * User-facing error behavior.
 *
 * Contract: docs/architecture/contracts/errors.md §3 and the
 * `must_never_reach_slack` list in fixtures/errors.v1.json.
 */

import { describe, expect, it } from 'vitest';

import { createGistHandlers } from '../../src/mastra/channels/handlers.js';
import {
  ChannelError,
  classifyError,
  shouldReplyOnDeny,
  USER_FACING_MESSAGE,
  userFacingMessage,
} from '../../src/mastra/channels/errors.js';
import { makeMessage, makeOptions, makeThread } from './helpers.js';

/** From docs/architecture/contracts/fixtures/errors.v1.json. */
const MUST_NEVER_REACH_SLACK = [
  'Mastra',
  'libSQL',
  'claude-opus-5',
  'openai/text-embedding-3-small',
  'anthropic',
  'openai',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  '/src/',
  '.db',
  'stack trace',
  'boundary_id',
  'thread_id',
  'message_key',
  'unapproved_channel',
  'not_in_allowlist',
  'guest_user',
  'external_user',
];

describe('user-facing strings match the error contract', () => {
  it('uses the exact contract strings', () => {
    expect(USER_FACING_MESSAGE.unauthorized).toBe("I can't help with that here.");
    expect(USER_FACING_MESSAGE.retrieval_failed).toBe(
      "I couldn't get to my notes just now — try again in a moment.",
    );
    expect(USER_FACING_MESSAGE.storage_unavailable).toBe(
      "I couldn't get to my notes just now — try again in a moment.",
    );
    expect(USER_FACING_MESSAGE.model_unavailable).toBe(
      "I couldn't finish that one. Try again in a moment.",
    );
    expect(USER_FACING_MESSAGE.model_refused).toBe(
      "I couldn't finish that one. Try again in a moment.",
    );
    expect(USER_FACING_MESSAGE.event_malformed).toBe('Something went wrong on my end.');
    expect(USER_FACING_MESSAGE.internal).toBe('Something went wrong on my end.');
  });

  it('leaks no internal identifier, provider, or path in any message', () => {
    for (const message of Object.values(USER_FACING_MESSAGE)) {
      for (const forbidden of MUST_NEVER_REACH_SLACK) {
        expect(message.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('never explains why a request was unauthorized', () => {
    expect(USER_FACING_MESSAGE.unauthorized).not.toMatch(/channel|guest|external|allowlist/i);
  });
});

describe('error classification', () => {
  it('maps a ChannelError to its declared class', () => {
    expect(classifyError(new ChannelError('retrieval_failed'))).toBe('retrieval_failed');
    expect(classifyError(new ChannelError('model_unavailable'))).toBe('model_unavailable');
  });

  it('degrades an unknown failure to internal rather than surfacing it', () => {
    const leaky = new Error('libSQL connection refused at /src/data/mastra.db');

    expect(classifyError(leaky)).toBe('internal');
    expect(userFacingMessage(leaky)).toBe('Something went wrong on my end.');
    expect(userFacingMessage(leaky)).not.toContain('libSQL');
  });

  it('handles non-Error throws', () => {
    expect(classifyError('a string')).toBe('internal');
    expect(classifyError(undefined)).toBe('internal');
  });
});

describe('deny-reason reply policy', () => {
  it('stays silent for channel-, workspace-, and sender-scoped denials', () => {
    expect(shouldReplyOnDeny('unapproved_channel')).toBe(false);
    expect(shouldReplyOnDeny('unapproved_workspace')).toBe(false);
    expect(shouldReplyOnDeny('bot_or_app_sender')).toBe(false);
    expect(shouldReplyOnDeny('identity_unresolved')).toBe(false);
    expect(shouldReplyOnDeny('malformed_request')).toBe(false);
  });

  it('replies for user-scoped denials, where the asker is waiting', () => {
    expect(shouldReplyOnDeny('guest_user')).toBe(true);
    expect(shouldReplyOnDeny('external_user')).toBe(true);
    expect(shouldReplyOnDeny('deactivated_user')).toBe(true);
    expect(shouldReplyOnDeny('not_in_allowlist')).toBe(true);
  });

  it('never replies when nothing was denied', () => {
    expect(shouldReplyOnDeny(null)).toBe(false);
  });
});

describe('failure containment (NFR-REL-003, FR-SLK-007)', () => {
  it('posts exactly one mapped reply when generation fails', async () => {
    const { options } = makeOptions({ respondThrows: new ChannelError('model_unavailable') });
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onSubscribedMessage(fake.thread, makeMessage());

    expect(fake.posts).toEqual([USER_FACING_MESSAGE.model_unavailable]);
  });

  it('does not leak a raw provider error to Slack', async () => {
    const { options } = makeOptions({
      respondThrows: new Error('ANTHROPIC_API_KEY rejected: 401 from api.anthropic.com'),
    });
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onSubscribedMessage(fake.thread, makeMessage());

    expect(fake.posts).toEqual(['Something went wrong on my end.']);
    expect(String(fake.posts[0])).not.toContain('ANTHROPIC_API_KEY');
  });

  it('distinguishes retrieval failure from an empty result', async () => {
    const { options } = makeOptions({ respondThrows: new ChannelError('retrieval_failed') });
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onSubscribedMessage(fake.thread, makeMessage());

    expect(fake.posts).toEqual([USER_FACING_MESSAGE.retrieval_failed]);
    expect(fake.posts[0]).not.toBe(USER_FACING_MESSAGE.internal);
  });

  it('never posts twice for one failed turn', async () => {
    const { options } = makeOptions({ respondThrows: new Error('boom') });
    const handlers = createGistHandlers(options);
    const fake = makeThread();

    await handlers.onDirectMessage(fake.thread, makeMessage());

    expect(fake.posts).toHaveLength(1);
  });
});
