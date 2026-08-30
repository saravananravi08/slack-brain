/**
 * Cross-boundary leak tests (NFR-SEC-003).
 *
 * This is the privacy-critical file. Every test here asserts that some piece
 * of knowledge does **not** reach a request that is not entitled to it:
 * FR-PRV-001 (per-channel isolation), FR-PRV-002 / AC-11 (no cross-channel
 * recall), FR-PRV-003 (no cross-user DM recall), FR-PRV-004 / AC-10 (DM
 * content never becomes channel knowledge), FR-PRV-005 / D002 (DMs read
 * private memory only), FR-PRV-006 / D006 (external users denied).
 *
 * They are written as sweeps rather than single examples: a leak that only
 * appears with three approved channels, or only for the second user, is
 * exactly the kind a single hand-picked case misses.
 */

import { describe, expect, it } from 'vitest';

import { authorize, parseBoundaryId } from '../../../src/security/index.js';
import type { BoundaryId, Gate } from '../../../src/security/types.js';
import {
  ALL_GATES,
  SYNTHETIC,
  channelBoundary,
  directMessageBoundary,
  makeChannelEvent,
  makeDirectMessageEvent,
  makeIdentity,
  makePolicy,
  makeRequest,
} from './helpers.js';

const APPROVED_CHANNELS = ['C0APPROVED1', 'C0APPROVED2', 'C0APPROVED3'] as const;
const USERS = ['U0MEMBER01', 'U0MEMBER02', 'U0MEMBER03'] as const;

const MULTI_CHANNEL_POLICY = makePolicy({ approved_channel_ids: [...APPROVED_CHANNELS] });

function readScopeForChannel(channelId: string): readonly BoundaryId[] {
  const event = makeChannelEvent({ channel_id: channelId });
  return authorize(
    makeRequest('read_memory', { event, policy: MULTI_CHANNEL_POLICY }),
  ).scope;
}

function readScopeForDirectMessage(userId: string): readonly BoundaryId[] {
  const event = makeDirectMessageEvent({ sender_id: userId });
  return authorize(
    makeRequest('read_memory', { event, policy: MULTI_CHANNEL_POLICY }),
  ).scope;
}

describe('channel boundaries are isolated from each other (FR-PRV-002, AC-11)', () => {
  for (const channelId of APPROVED_CHANNELS) {
    it(`${channelId} reads only its own boundary`, () => {
      const scope = readScopeForChannel(channelId);
      expect(scope).toEqual([
        channelBoundary(SYNTHETIC.workspaceApproved, channelId),
      ]);

      for (const other of APPROVED_CHANNELS) {
        if (other === channelId) continue;
        expect(scope).not.toContain(
          channelBoundary(SYNTHETIC.workspaceApproved, other),
        );
      }
    });
  }

  it('no channel scope overlaps another channel scope', () => {
    const scopes = APPROVED_CHANNELS.map((id) => readScopeForChannel(id));
    for (let i = 0; i < scopes.length; i += 1) {
      for (let j = i + 1; j < scopes.length; j += 1) {
        const left = scopes[i] ?? [];
        const right = scopes[j] ?? [];
        expect(left.filter((id) => right.includes(id))).toEqual([]);
      }
    }
  });
});

describe('channel requests never receive DM knowledge (FR-PRV-004, AC-10)', () => {
  for (const channelId of APPROVED_CHANNELS) {
    it(`${channelId} scope contains no dm: boundary`, () => {
      const scope = readScopeForChannel(channelId);
      expect(scope.some((id) => id.startsWith('dm:'))).toBe(false);
      for (const userId of USERS) {
        expect(scope).not.toContain(
          directMessageBoundary(SYNTHETIC.workspaceApproved, userId),
        );
      }
    });
  }

  it('denies a DM event that presents a channel identity, at every gate', () => {
    // INV-3 / FR-PRV-004: this is the shape of writing private DM content into
    // shared channel knowledge. It must fail, not be filtered out later.
    const event = makeDirectMessageEvent();
    const channelIdentity = makeIdentity(makeChannelEvent(), {
      conversation_type: 'dm',
    });

    for (const gate of ALL_GATES) {
      const decision = authorize(
        makeRequest(gate, { event, identity: channelIdentity }),
      );
      expect(decision).toMatchObject({ allowed: false, reason: 'identity_unresolved' });
      expect(decision.scope).toHaveLength(0);
    }
  });

  it('denies a channel event that presents a DM identity, at every gate', () => {
    const event = makeChannelEvent();
    const dmIdentity = makeIdentity(makeDirectMessageEvent(), {
      conversation_type: 'channel',
    });

    for (const gate of ALL_GATES) {
      const decision = authorize(makeRequest(gate, { event, identity: dmIdentity }));
      expect(decision).toMatchObject({ allowed: false, reason: 'identity_unresolved' });
    }
  });
});

describe('DM boundaries are isolated per user (FR-PRV-003)', () => {
  for (const userId of USERS) {
    it(`${userId} reads only their own private boundary`, () => {
      const scope = readScopeForDirectMessage(userId);
      expect(scope).toEqual([
        directMessageBoundary(SYNTHETIC.workspaceApproved, userId),
      ]);

      for (const other of USERS) {
        if (other === userId) continue;
        expect(scope).not.toContain(
          directMessageBoundary(SYNTHETIC.workspaceApproved, other),
        );
      }
    });
  }

  it('no two users share a DM scope', () => {
    const scopes = USERS.map((id) => readScopeForDirectMessage(id));
    for (let i = 0; i < scopes.length; i += 1) {
      for (let j = i + 1; j < scopes.length; j += 1) {
        const left = scopes[i] ?? [];
        const right = scopes[j] ?? [];
        expect(left.filter((id) => right.includes(id))).toEqual([]);
      }
    }
  });
});

describe('an identity cannot address a boundary the event does not own', () => {
  it("denies a DM request carrying another user's private boundary", () => {
    // FR-PRV-003 — the highest-value leak: one user reading another user's DM
    // history by presenting their boundary. The identity must describe the
    // sender, not merely be well-formed.
    const event = makeDirectMessageEvent({ sender_id: SYNTHETIC.userMember });
    const otherUsersIdentity = makeIdentity(
      makeDirectMessageEvent({ sender_id: SYNTHETIC.userMemberSecond }),
    );

    for (const gate of ALL_GATES) {
      const decision = authorize(
        makeRequest(gate, { event, identity: otherUsersIdentity }),
      );
      expect(decision).toMatchObject({ allowed: false, reason: 'identity_unresolved' });
      expect(decision.scope).toHaveLength(0);
    }
  });

  it("denies a channel request carrying another approved channel's boundary", () => {
    // FR-PRV-002 — writing channel A's content into channel B, or reading B
    // from A, both start here. Being approved is not the same as being *this*
    // channel.
    const event = makeChannelEvent({ channel_id: SYNTHETIC.channelApproved });
    const otherChannelIdentity = makeIdentity(
      makeChannelEvent({ channel_id: SYNTHETIC.channelApprovedSecond }),
    );

    for (const gate of ALL_GATES) {
      const decision = authorize(
        makeRequest(gate, { event, identity: otherChannelIdentity }),
      );
      expect(decision).toMatchObject({ allowed: false, reason: 'identity_unresolved' });
    }
  });

  it('denies an identity whose workspace disagrees with the event', () => {
    const event = makeChannelEvent();
    const otherWorkspaceIdentity = makeIdentity(
      makeChannelEvent({ workspace_id: SYNTHETIC.workspaceOther }),
    );
    expect(
      authorize(makeRequest('read_memory', { event, identity: otherWorkspaceIdentity })),
    ).toMatchObject({ allowed: false, reason: 'identity_unresolved' });
  });

  it('denies an identity whose resource_id disagrees with its boundary_id', () => {
    const event = makeChannelEvent();
    const identity = makeIdentity(event, {
      resource_id: 'ch:T0SYNTH01:C0APPROVED2',
    });
    expect(authorize(makeRequest('read_memory', { event, identity }))).toMatchObject({
      allowed: false,
      reason: 'identity_unresolved',
    });
  });

  it('denies an identity whose thread is rooted in another boundary', () => {
    const event = makeChannelEvent();
    const identity = makeIdentity(event, {
      thread_id: 'ch:T0SYNTH01:C0APPROVED2#1735689650.000100',
    });
    expect(authorize(makeRequest('read_memory', { event, identity }))).toMatchObject({
      allowed: false,
      reason: 'identity_unresolved',
    });
  });
});

describe('DMs read private memory only (D002, FR-PRV-005, INV-5)', () => {
  it('the accepted default is off, and a DM scope carries no ch: boundary', () => {
    expect(makePolicy().dm_shared_knowledge).toBe(false);
    for (const userId of USERS) {
      const scope = readScopeForDirectMessage(userId);
      expect(scope.some((id) => id.startsWith('ch:'))).toBe(false);
    }
  });

  it('ignores membership entirely while the flag is off', () => {
    const policy = makePolicy({
      dm_shared_knowledge: false,
      membership: {
        status: 'resolved',
        boundaries: APPROVED_CHANNELS.map((id) =>
          channelBoundary(SYNTHETIC.workspaceApproved, id),
        ),
      },
    });
    const event = makeDirectMessageEvent();
    const scope = authorize(makeRequest('read_memory', { event, policy })).scope;
    expect(scope).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
    ]);
  });
});

/**
 * The D002-enabled shape. Unreachable in this build — T102 types the flag as
 * the literal `false` — but pinned so that a future re-approval starts from a
 * known, tested shape rather than a redesign, and so that a premature flip is
 * caught by a failing expectation rather than by a leak.
 */
describe('D002 enabled shape narrows, never widens', () => {
  const enabled = (
    membership: { status: 'resolved'; boundaries: BoundaryId[] } | { status: 'unavailable' },
  ) =>
    makePolicy({
      approved_channel_ids: [...APPROVED_CHANNELS],
      dm_shared_knowledge: true,
      membership,
    });

  function scopeWith(policy: ReturnType<typeof enabled>): readonly BoundaryId[] {
    const event = makeDirectMessageEvent();
    return authorize(makeRequest('read_memory', { event, policy })).scope;
  }

  it('grants only the intersection of membership and the approved list', () => {
    const scope = scopeWith(
      enabled({
        status: 'resolved',
        boundaries: [
          channelBoundary(SYNTHETIC.workspaceApproved, 'C0APPROVED1'),
          // Member of a channel nobody approved — must not appear.
          channelBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.channelUnapproved),
        ],
      }),
    );

    expect(scope).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
      channelBoundary(SYNTHETIC.workspaceApproved, 'C0APPROVED1'),
    ]);
    expect(scope).not.toContain(
      channelBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.channelUnapproved),
    );
    expect(scope).not.toContain(channelBoundary(SYNTHETIC.workspaceApproved, 'C0APPROVED2'));
  });

  it('excludes membership from another workspace', () => {
    const scope = scopeWith(
      enabled({
        status: 'resolved',
        boundaries: [channelBoundary(SYNTHETIC.workspaceOther, 'C0APPROVED1')],
      }),
    );
    expect(scope.some((id) => id.startsWith('ch:'))).toBe(false);
  });

  it('excludes a dm: boundary smuggled into membership', () => {
    // Another user's private boundary must never enter a scope, whatever the
    // resolver hands over (FR-PRV-003).
    const scope = scopeWith(
      enabled({
        status: 'resolved',
        boundaries: [
          directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMemberSecond),
        ] as BoundaryId[],
      }),
    );
    expect(scope).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
    ]);
  });

  it('narrows to the private boundary when the lookup fails', () => {
    const scope = scopeWith(enabled({ status: 'unavailable' }));
    expect(scope).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
    ]);
    expect(scope.some((id) => id.startsWith('ch:'))).toBe(false);
  });

  it('narrows to the private boundary when membership is absent', () => {
    const policy = makePolicy({
      approved_channel_ids: [...APPROVED_CHANNELS],
      dm_shared_knowledge: true,
    });
    const event = makeDirectMessageEvent();
    const scope = authorize(makeRequest('read_memory', { event, policy })).scope;
    expect(scope).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
    ]);
  });

  it('ignores malformed membership entries instead of trusting them', () => {
    const scope = scopeWith(
      enabled({
        status: 'resolved',
        boundaries: ['C0APPROVED1', 'ch:C0APPROVED1', ''] as unknown as BoundaryId[],
      }),
    );
    expect(scope).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
    ]);
  });
});

describe('identity collisions cannot cross a boundary (INV-3)', () => {
  it('a channel ID and a user ID sharing a suffix land in different boundaries', () => {
    const policy = makePolicy({ approved_channel_ids: ['C0COLLIDE1'] });
    const channelScope = authorize(
      makeRequest('read_memory', {
        event: makeChannelEvent({ channel_id: 'C0COLLIDE1' }),
        policy,
      }),
    ).scope;
    const dmScope = authorize(
      makeRequest('read_memory', {
        event: makeDirectMessageEvent({ sender_id: 'U0COLLIDE1' }),
        policy,
      }),
    ).scope;

    expect(channelScope).toEqual(['ch:T0SYNTH01:C0COLLIDE1']);
    expect(dmScope).toEqual(['dm:T0SYNTH01:U0COLLIDE1']);
    expect(channelScope[0]).not.toBe(dmScope[0]);
  });

  it('the same channel ID in another workspace is denied, not merged', () => {
    const event = makeChannelEvent({ workspace_id: SYNTHETIC.workspaceOther });
    const decision = authorize(makeRequest('read_memory', { event }));
    expect(decision).toMatchObject({ allowed: false, reason: 'unapproved_workspace' });
  });

  it('rejects a bare unprefixed ID used as a boundary (identity.md §4)', () => {
    expect(parseBoundaryId(SYNTHETIC.channelApproved)).toBeNull();
    expect(parseBoundaryId('ch:T0SYNTH01')).toBeNull();
    expect(parseBoundaryId('ch:T0SYNTH01:C0APPROVED1:extra')).toBeNull();
    expect(parseBoundaryId('im:T0SYNTH01:U0MEMBER01')).toBeNull();
    expect(parseBoundaryId(null)).toBeNull();
  });
});

describe('a denied request never receives scope, at any gate', () => {
  const denied: ReadonlyArray<{ label: string; gate: Gate }> = ALL_GATES.map((gate) => ({
    label: gate,
    gate,
  }));

  for (const { label, gate } of denied) {
    it(`unapproved channel at ${label} yields no scope and no lookup key`, () => {
      // D005: a mutation for an unapproved channel is denied before any
      // storage lookup, so it cannot probe what Gist holds.
      const event = makeChannelEvent({ channel_id: SYNTHETIC.channelUnapproved });
      const decision = authorize(makeRequest(gate, { event }));
      expect(decision.allowed).toBe(false);
      expect(decision.scope).toHaveLength(0);
    });
  }
});
