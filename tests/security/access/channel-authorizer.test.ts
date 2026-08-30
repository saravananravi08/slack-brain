/**
 * The Slack-surface authorizer.
 *
 * T104 declared `ChannelAuthorizer` as a required injected port; this suite
 * checks that T203's implementation satisfies that port and fails closed on
 * every lookup that can fail (D006, and T502's requirement that no path grants
 * access on a failed identity lookup).
 */

import { describe, expect, it, vi } from 'vitest';

import { createChannelAuthorizer } from '../../../src/security/index.js';
import type {
  ChannelAuthorizerOptions,
  SenderAttributes,
} from '../../../src/security/channel-authorizer.js';
import type { AuthorizationEvent } from '../../../src/security/types.js';
import type { ChannelAuthorizer } from '../../../src/mastra/channels/types.js';
import { SYNTHETIC, makeIdentity, makePolicy } from './helpers.js';

const FULL_MEMBER: SenderAttributes = {
  senderType: 'human',
  isExternal: false,
  isGuest: false,
  isDeactivated: false,
};

function makeAuthorizer(overrides: Partial<ChannelAuthorizerOptions> = {}) {
  return createChannelAuthorizer({
    policy: makePolicy(),
    resolveIdentity: (event) => makeIdentity(event),
    resolveSender: () => FULL_MEMBER,
    ...overrides,
  });
}

const CHANNEL_REQUEST = {
  workspaceId: SYNTHETIC.workspaceApproved,
  channelId: SYNTHETIC.channelApproved,
  senderId: SYNTHETIC.userMember,
  isDirectMessage: false,
};

const DM_REQUEST = {
  workspaceId: SYNTHETIC.workspaceApproved,
  channelId: SYNTHETIC.dmConversation,
  senderId: SYNTHETIC.userMember,
  isDirectMessage: true,
};

describe('port compatibility', () => {
  it('satisfies T104 ChannelAuthorizer', () => {
    // Type-level assertion: a mismatch fails `npm run typecheck`, which is
    // where a drift between the two layers should surface.
    const port: ChannelAuthorizer = makeAuthorizer();
    expect(typeof port).toBe('function');
  });
});

describe('allowed paths', () => {
  it('allows a full member in an approved channel', async () => {
    await expect(makeAuthorizer()(CHANNEL_REQUEST)).resolves.toEqual({
      allowed: true,
      reason: null,
    });
  });

  it('allows a full member in a DM', async () => {
    await expect(makeAuthorizer()(DM_REQUEST)).resolves.toEqual({
      allowed: true,
      reason: null,
    });
  });
});

describe('fails closed on every lookup that can fail', () => {
  it('denies when the sender lookup throws', async () => {
    const authorizer = makeAuthorizer({
      resolveSender: () => {
        throw new Error('slack unavailable');
      },
    });
    await expect(authorizer(CHANNEL_REQUEST)).resolves.toEqual({
      allowed: false,
      reason: 'identity_unresolved',
    });
  });

  it('denies when the sender lookup rejects', async () => {
    const authorizer = makeAuthorizer({
      resolveSender: async () => {
        throw new Error('timeout');
      },
    });
    await expect(authorizer(CHANNEL_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reason: 'identity_unresolved',
    });
  });

  it('denies when the sender is unknown', async () => {
    const authorizer = makeAuthorizer({ resolveSender: () => null });
    await expect(authorizer(CHANNEL_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reason: 'identity_unresolved',
    });
  });

  it('denies when identity resolution throws (identity.md §5)', async () => {
    const authorizer = makeAuthorizer({
      resolveIdentity: () => {
        throw new Error('malformed event');
      },
    });
    await expect(authorizer(CHANNEL_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reason: 'identity_unresolved',
    });
  });

  it('denies when the workspace cannot be verified', async () => {
    // D001 does not permit assuming the approved workspace.
    await expect(
      makeAuthorizer()({ ...CHANNEL_REQUEST, workspaceId: undefined }),
    ).resolves.toMatchObject({ allowed: false, reason: 'malformed_request' });
    await expect(
      makeAuthorizer()({ ...CHANNEL_REQUEST, workspaceId: '   ' }),
    ).resolves.toMatchObject({ allowed: false, reason: 'malformed_request' });
  });

  it('does not call the identity resolver once the sender lookup fails', async () => {
    const resolveIdentity = vi.fn((event: AuthorizationEvent) => makeIdentity(event));
    const authorizer = makeAuthorizer({ resolveSender: () => null, resolveIdentity });
    await authorizer(CHANNEL_REQUEST);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });
});

describe('policy denials reach the surface with their reason', () => {
  const cases = [
    {
      label: 'external user',
      attributes: { ...FULL_MEMBER, isExternal: true },
      request: CHANNEL_REQUEST,
      reason: 'external_user',
    },
    {
      label: 'external user in a DM',
      attributes: { ...FULL_MEMBER, isExternal: true },
      request: DM_REQUEST,
      reason: 'external_user',
    },
    {
      label: 'guest',
      attributes: { ...FULL_MEMBER, isGuest: true },
      request: CHANNEL_REQUEST,
      reason: 'guest_user',
    },
    {
      label: 'deactivated user',
      attributes: { ...FULL_MEMBER, isDeactivated: true },
      request: CHANNEL_REQUEST,
      reason: 'deactivated_user',
    },
    {
      label: 'bot',
      attributes: { ...FULL_MEMBER, senderType: 'bot' as const },
      request: CHANNEL_REQUEST,
      reason: 'bot_or_app_sender',
    },
    {
      label: 'app',
      attributes: { ...FULL_MEMBER, senderType: 'app' as const },
      request: CHANNEL_REQUEST,
      reason: 'bot_or_app_sender',
    },
  ] as const;

  for (const testCase of cases) {
    it(`denies a ${testCase.label}`, async () => {
      const authorizer = makeAuthorizer({ resolveSender: () => testCase.attributes });
      await expect(authorizer(testCase.request)).resolves.toEqual({
        allowed: false,
        reason: testCase.reason,
      });
    });
  }

  it('denies an unapproved channel', async () => {
    await expect(
      makeAuthorizer()({ ...CHANNEL_REQUEST, channelId: SYNTHETIC.channelUnapproved }),
    ).resolves.toEqual({ allowed: false, reason: 'unapproved_channel' });
  });

  it('denies an unapproved workspace', async () => {
    await expect(
      makeAuthorizer()({ ...CHANNEL_REQUEST, workspaceId: SYNTHETIC.workspaceOther }),
    ).resolves.toEqual({ allowed: false, reason: 'unapproved_workspace' });
  });

  it('denies a non-listed member once the allowlist is populated', async () => {
    const authorizer = makeAuthorizer({
      policy: makePolicy({ user_allowlist: [SYNTHETIC.userMemberSecond] }),
    });
    await expect(authorizer(CHANNEL_REQUEST)).resolves.toEqual({
      allowed: false,
      reason: 'not_in_allowlist',
    });
  });
});

describe('what the adapter passes on and logs', () => {
  it('hands the identity resolver no message text and no display name', async () => {
    let seen: AuthorizationEvent | null = null;
    const authorizer = makeAuthorizer({
      resolveIdentity: (event) => {
        seen = event;
        return makeIdentity(event);
      },
    });

    await authorizer({
      ...CHANNEL_REQUEST,
      // Extra fields a real `ChannelRequest` carries must not be forwarded.
      text: 'private message body',
      senderName: 'A Person',
    } as never);

    const event = seen as AuthorizationEvent | null;
    expect(event).not.toBeNull();
    expect(Object.keys(event ?? {}).sort()).toEqual([
      'channel_id',
      'conversation_type',
      'sender_id',
      'sender_is_deactivated',
      'sender_is_external',
      'sender_is_guest',
      'sender_type',
      'workspace_id',
    ]);
    expect(JSON.stringify(event)).not.toContain('private message body');
    expect(JSON.stringify(event)).not.toContain('A Person');
  });

  it('logs a denial as a reason code with no identifier or text', async () => {
    const entries: Array<{ message: string; fields: Record<string, unknown> | undefined }> =
      [];
    const authorizer = makeAuthorizer({
      logger: { info: (message, fields) => entries.push({ message, fields }) },
    });

    await authorizer({ ...CHANNEL_REQUEST, channelId: SYNTHETIC.channelUnapproved });

    expect(entries).toHaveLength(1);
    const serialized = JSON.stringify(entries[0]);
    expect(serialized).toContain('unapproved_channel');
    for (const value of [
      SYNTHETIC.channelUnapproved,
      SYNTHETIC.workspaceApproved,
      SYNTHETIC.userMember,
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('logs nothing for an allowed turn', async () => {
    const info = vi.fn();
    await makeAuthorizer({ logger: { info } })(CHANNEL_REQUEST);
    expect(info).not.toHaveBeenCalled();
  });
});
