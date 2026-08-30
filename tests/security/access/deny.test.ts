/**
 * What a denial may say.
 *
 * Contract: docs/architecture/contracts/errors.md §1, §3, §5.
 * Requirements: FR-RSP-007/008, FR-PRV-008, INV-11, INV-12.
 *
 * The silent/spoken split is pinned directly against T104's merged
 * implementation, so the two layers cannot drift apart silently.
 */

import { describe, expect, it } from 'vitest';

import {
  SILENT_DENY_REASONS,
  SPOKEN_DENY_REASONS,
  UNAUTHORIZED_USER_MESSAGE,
  authorize,
  denyLogFields,
  shouldNotifyUser,
  userMessageForDeny,
} from '../../../src/security/index.js';
import type { DenyReason } from '../../../src/security/types.js';
import {
  USER_FACING_MESSAGE,
  shouldReplyOnDeny,
} from '../../../src/mastra/channels/errors.js';
import type { ChannelDenyReason } from '../../../src/mastra/channels/types.js';
import {
  SYNTHETIC,
  makeChannelEvent,
  makeDirectMessageEvent,
  makePolicy,
  makeRequest,
} from './helpers.js';

const ALL_DENY_REASONS: readonly DenyReason[] = [
  'unapproved_workspace',
  'unapproved_channel',
  'external_user',
  'guest_user',
  'deactivated_user',
  'not_in_allowlist',
  'bot_or_app_sender',
  'dm_shared_knowledge_disabled',
  'identity_unresolved',
  'malformed_request',
];

describe('deny reason classification', () => {
  it('classifies every reason exactly once', () => {
    for (const reason of ALL_DENY_REASONS) {
      const silent = SILENT_DENY_REASONS.has(reason);
      const spoken = SPOKEN_DENY_REASONS.has(reason);
      expect(silent !== spoken).toBe(true);
    }
    expect(SILENT_DENY_REASONS.size + SPOKEN_DENY_REASONS.size).toBe(
      ALL_DENY_REASONS.length,
    );
  });

  it('matches the split T104 implements for the Slack surface', () => {
    for (const reason of ALL_DENY_REASONS) {
      if (reason === 'dm_shared_knowledge_disabled') continue; // not a channel reason
      expect(shouldNotifyUser(reason)).toBe(shouldReplyOnDeny(reason as ChannelDenyReason));
    }
  });

  it('stays silent for workspace-, channel-, and sender-scoped denials', () => {
    // FR-SLK-010 / INV-11: replying would confirm the channel exists and that
    // Gist is present in it.
    for (const reason of [
      'unapproved_workspace',
      'unapproved_channel',
      'bot_or_app_sender',
      'identity_unresolved',
      'malformed_request',
    ] as const) {
      expect(shouldNotifyUser(reason)).toBe(false);
      expect(userMessageForDeny(reason)).toBeNull();
    }
  });

  it('speaks one generic line for user-scoped denials', () => {
    for (const reason of [
      'external_user',
      'guest_user',
      'deactivated_user',
      'not_in_allowlist',
    ] as const) {
      expect(shouldNotifyUser(reason)).toBe(true);
      expect(userMessageForDeny(reason)).toBe(UNAUTHORIZED_USER_MESSAGE);
    }
  });

  it('says nothing at all when nothing was denied', () => {
    expect(shouldNotifyUser(null)).toBe(false);
    expect(userMessageForDeny(null)).toBeNull();
  });
});

describe('the user-facing string', () => {
  it('is the exact contract string and matches the channel layer', () => {
    expect(UNAUTHORIZED_USER_MESSAGE).toBe("I can't help with that here.");
    expect(UNAUTHORIZED_USER_MESSAGE).toBe(USER_FACING_MESSAGE.unauthorized);
  });

  it('never explains why (errors.md §3 rule 1)', () => {
    const message = UNAUTHORIZED_USER_MESSAGE.toLowerCase();
    for (const reason of ALL_DENY_REASONS) {
      expect(message).not.toContain(reason);
    }
    for (const word of ['channel', 'workspace', 'guest', 'external', 'allowlist', 'policy']) {
      expect(message).not.toContain(word);
    }
  });

  it('is identical for every spoken denial, so it distinguishes nothing', () => {
    const messages = new Set(
      [...SPOKEN_DENY_REASONS].map((reason) => userMessageForDeny(reason)),
    );
    expect(messages.size).toBe(1);
  });
});

describe('log fields (FR-PRV-008, INV-12, errors.md §5)', () => {
  const denials = [
    makeRequest('accept_event', {
      event: makeChannelEvent({ channel_id: SYNTHETIC.channelUnapproved }),
    }),
    makeRequest('read_memory', {
      event: makeDirectMessageEvent({ sender_is_external: true }),
    }),
    makeRequest('write_memory', {
      event: makeChannelEvent({ sender_id: SYNTHETIC.userMemberSecond }),
      policy: makePolicy({ user_allowlist: [SYNTHETIC.userMember] }),
    }),
    makeRequest('accept_event', {
      event: makeChannelEvent({ workspace_id: SYNTHETIC.workspaceOther }),
    }),
  ];

  it('carries the class, gate, and reason code only', () => {
    for (const request of denials) {
      const fields = denyLogFields(authorize(request));
      expect(fields).not.toBeNull();
      expect(Object.keys(fields ?? {}).sort()).toEqual(['class', 'gate', 'reason']);
      expect(fields?.class).toBe('unauthorized');
    }
  });

  it('carries no workspace, channel, user, boundary, thread, or text value', () => {
    const forbidden = [
      SYNTHETIC.workspaceApproved,
      SYNTHETIC.workspaceOther,
      SYNTHETIC.channelApproved,
      SYNTHETIC.channelUnapproved,
      SYNTHETIC.dmConversation,
      SYNTHETIC.userMember,
      SYNTHETIC.userMemberSecond,
      SYNTHETIC.userExternal,
      'ch:',
      'dm:',
      '#',
    ];

    for (const request of denials) {
      const serialized = JSON.stringify(denyLogFields(authorize(request)));
      for (const value of forbidden) {
        expect(serialized).not.toContain(value);
      }
    }
  });

  it('returns nothing to log for an allowed decision', () => {
    expect(denyLogFields(authorize(makeRequest('read_memory')))).toBeNull();
  });
});
