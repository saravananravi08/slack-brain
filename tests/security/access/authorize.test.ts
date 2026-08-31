/**
 * The authorization decision matrix.
 *
 * Drives docs/architecture/contracts/fixtures/authorization.v1.json case by
 * case, then covers the full matrix authorization.md §8 requires: full member,
 * single- and multi-channel guest, external/Connect user, deactivated user,
 * bot, app, unknown user, and malformed identity — each across channel and DM
 * and across all three gates.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUTHORIZATION_CONTRACT_VERSION,
  AuthorizationScopeError,
  authorize,
  retrievalScope,
} from '../../../src/security/index.js';
import type {
  AuthorizationEvent,
  BoundaryId,
  DenyReason,
  Gate,
  MembershipResolution,
  PolicySnapshot,
} from '../../../src/security/types.js';
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

interface FixtureSender {
  id: string;
  type: 'human' | 'bot' | 'app' | 'system';
  external: boolean;
  guest: boolean;
  deactivated: boolean;
}

interface FixtureCase {
  name: string;
  gates: Gate[];
  sender: FixtureSender;
  conversation: { type: 'channel' | 'dm'; workspace_id: string; channel_id: string };
  policy_override?: Partial<{
    user_allowlist: string[];
    dm_shared_knowledge: boolean;
  }>;
  membership?: string[];
  membership_lookup?: 'error';
  expect: {
    allowed?: boolean;
    reason?: DenyReason | null;
    scope?: string[];
    scope_excludes?: string[];
    scope_excludes_any_ch_boundary?: boolean;
    scope_excludes_any_dm_boundary?: boolean;
    storage_touched?: boolean;
    channels_excluded?: boolean;
  };
}

interface Fixture {
  contract_version: string;
  policy_default: {
    approved_workspace_id: string;
    approved_channel_ids: string[];
    user_allowlist: string[];
    dm_shared_knowledge: boolean;
  };
  cases: FixtureCase[];
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../docs/architecture/contracts/fixtures/authorization.v1.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as Fixture;

/** manifest.json — pin the version and fail on a major bump. */
it('implements the frozen contract version', () => {
  expect(fixture.contract_version).toBe('1.0.0');
  expect(AUTHORIZATION_CONTRACT_VERSION.split('.')[0]).toBe(
    fixture.contract_version.split('.')[0],
  );
});

function policyFor(testCase: FixtureCase): PolicySnapshot {
  const defaults = fixture.policy_default;
  const dmSharedKnowledge =
    testCase.policy_override?.dm_shared_knowledge ?? defaults.dm_shared_knowledge;

  let membership: MembershipResolution | undefined;
  if (testCase.membership_lookup === 'error') {
    membership = { status: 'unavailable' };
  } else if (testCase.membership !== undefined) {
    membership = {
      status: 'resolved',
      // The resolver owns boundary composition (authorization.md §7); the
      // fixture lists channel IDs, so the projection happens here in test data.
      boundaries: testCase.membership.map((id) =>
        channelBoundary(defaults.approved_workspace_id, id),
      ),
    };
  }

  const base = {
    approved_workspace_id: defaults.approved_workspace_id,
    approved_channel_ids: defaults.approved_channel_ids,
    user_allowlist: testCase.policy_override?.user_allowlist ?? defaults.user_allowlist,
    dm_shared_knowledge: dmSharedKnowledge,
  };
  return membership === undefined ? base : { ...base, membership };
}

function eventFor(testCase: FixtureCase): AuthorizationEvent {
  return {
    workspace_id: testCase.conversation.workspace_id,
    channel_id: testCase.conversation.channel_id,
    conversation_type: testCase.conversation.type,
    sender_id: testCase.sender.id,
    sender_type: testCase.sender.type,
    sender_is_external: testCase.sender.external,
    sender_is_guest: testCase.sender.guest,
    sender_is_deactivated: testCase.sender.deactivated,
  };
}

describe('authorization contract fixtures', () => {
  for (const testCase of fixture.cases) {
    for (const gate of testCase.gates) {
      it(`${testCase.name} @ ${gate}`, () => {
        const event = eventFor(testCase);
        const decision = authorize({
          contract_version: '1.0.0',
          gate,
          event,
          identity: makeIdentity(event),
          policy: policyFor(testCase),
        });

        const expected = testCase.expect;
        // A fixture case states `allowed` explicitly, or implies denial by
        // naming a reason; the scope-only cases are allowed reads.
        const expectedAllowed =
          expected.allowed ?? (typeof expected.reason === 'string' ? false : true);
        expect(decision.allowed).toBe(expectedAllowed);

        if (expected.reason !== undefined) {
          expect(decision.reason).toBe(expected.reason);
        }

        if (expected.scope !== undefined && gate === 'read_memory') {
          expect([...decision.scope]).toEqual(expected.scope);
        }

        for (const excluded of expected.scope_excludes ?? []) {
          expect(decision.scope).not.toContain(excluded);
        }

        if (expected.scope_excludes_any_ch_boundary === true) {
          expect(decision.scope.some((id) => id.startsWith('ch:'))).toBe(false);
        }
        if (expected.scope_excludes_any_dm_boundary === true) {
          expect(decision.scope.some((id) => id.startsWith('dm:'))).toBe(false);
        }
        if (expected.channels_excluded === true) {
          expect(decision.scope.some((id) => id.startsWith('ch:'))).toBe(false);
        }
      });
    }
  }
});

describe('fixture invariants', () => {
  const decisions = fixture.cases.flatMap((testCase) =>
    testCase.gates.map((gate) => {
      const event = eventFor(testCase);
      return {
        gate,
        decision: authorize({
          contract_version: '1.0.0',
          gate,
          event,
          identity: makeIdentity(event),
          policy: policyFor(testCase),
        }),
      };
    }),
  );

  it('a denial always carries a reason and an empty scope', () => {
    for (const { decision } of decisions) {
      if (decision.allowed) continue;
      expect(decision.reason).not.toBeNull();
      expect(decision.scope).toHaveLength(0);
    }
  });

  it('an allowed read always yields a non-empty scope', () => {
    for (const { gate, decision } of decisions) {
      if (!decision.allowed || gate !== 'read_memory') continue;
      expect(decision.scope.length).toBeGreaterThan(0);
    }
  });

  it('an allowed decision never carries a reason', () => {
    for (const { decision } of decisions) {
      if (!decision.allowed) continue;
      expect(decision.reason).toBeNull();
    }
  });

  it('only read_memory ever grants scope', () => {
    for (const { gate, decision } of decisions) {
      if (gate === 'read_memory') continue;
      expect(decision.scope).toHaveLength(0);
    }
  });
});

/** authorization.md §8 — the required identity matrix. */
interface MatrixRow {
  readonly label: string;
  readonly reason: DenyReason | null;
  readonly event: (base: AuthorizationEvent) => AuthorizationEvent;
  /** Identity deliberately not describing this event, for the unknown case. */
  readonly mismatchedIdentity?: boolean;
}

const MATRIX: readonly MatrixRow[] = [
  { label: 'full member', reason: null, event: (base) => base },
  {
    label: 'single-channel guest',
    reason: 'guest_user',
    event: (base) => ({ ...base, sender_id: SYNTHETIC.userGuest, sender_is_guest: true }),
  },
  {
    label: 'multi-channel guest',
    reason: 'guest_user',
    event: (base) => ({ ...base, sender_id: SYNTHETIC.userGuest, sender_is_guest: true }),
  },
  {
    label: 'external Slack Connect user',
    reason: 'external_user',
    event: (base) => ({
      ...base,
      sender_id: SYNTHETIC.userExternal,
      sender_is_external: true,
    }),
  },
  {
    label: 'deactivated user',
    reason: 'deactivated_user',
    event: (base) => ({
      ...base,
      sender_id: SYNTHETIC.userDeactivated,
      sender_is_deactivated: true,
    }),
  },
  {
    label: 'bot',
    reason: 'bot_or_app_sender',
    event: (base) => ({ ...base, sender_id: SYNTHETIC.bot, sender_type: 'bot' }),
  },
  {
    label: 'app',
    reason: 'bot_or_app_sender',
    event: (base) => ({ ...base, sender_id: SYNTHETIC.bot, sender_type: 'app' }),
  },
  {
    label: 'unknown user (identity does not describe the event)',
    reason: 'identity_unresolved',
    event: (base) => base,
    mismatchedIdentity: true,
  },
  {
    label: 'malformed identity (blank sender)',
    reason: 'malformed_request',
    event: (base) => ({ ...base, sender_id: '' }),
  },
];

describe('required identity matrix across surfaces and gates', () => {
  for (const row of MATRIX) {
    for (const surface of ['channel', 'dm'] as const) {
      for (const gate of ALL_GATES) {
        it(`${row.label} · ${surface} · ${gate}`, () => {
          const base =
            surface === 'channel' ? makeChannelEvent() : makeDirectMessageEvent();
          const event = row.event(base);
          const identity =
            row.mismatchedIdentity === true
              ? makeIdentity(makeChannelEvent({ sender_id: SYNTHETIC.userMemberSecond }), {
                  boundary_id: 'ch:T0SYNTH01:C0UNKNOWN9',
                  resource_id: 'ch:T0SYNTH01:C0UNKNOWN9',
                  thread_id: 'ch:T0SYNTH01:C0UNKNOWN9#1735689650.000100',
                  conversation_type: surface === 'channel' ? 'channel' : 'dm',
                })
              : makeIdentity(event);

          const decision = authorize({
            contract_version: '1.0.0',
            gate,
            event,
            identity,
            policy: makePolicy(),
          });

          expect(decision.allowed).toBe(row.reason === null);
          expect(decision.reason).toBe(row.reason);
          if (row.reason !== null) expect(decision.scope).toHaveLength(0);
        });
      }
    }
  }
});

describe('deny-by-default rules', () => {
  it('denies an unapproved channel', () => {
    const event = makeChannelEvent({ channel_id: SYNTHETIC.channelUnapproved });
    const decision = authorize(makeRequest('accept_event', { event }));
    expect(decision).toMatchObject({ allowed: false, reason: 'unapproved_channel' });
  });

  it('denies another workspace', () => {
    const event = makeChannelEvent({ workspace_id: SYNTHETIC.workspaceOther });
    const decision = authorize(makeRequest('accept_event', { event }));
    expect(decision).toMatchObject({ allowed: false, reason: 'unapproved_workspace' });
  });

  it('denies an external user before the channel check (D006 ordering)', () => {
    const event = makeChannelEvent({
      channel_id: SYNTHETIC.channelUnapproved,
      sender_is_external: true,
    });
    // Rule 2 precedes rule 7: the external denial wins, and evaluation stops.
    expect(authorize(makeRequest('accept_event', { event })).reason).toBe('external_user');
  });

  it('denies a non-listed member once the allowlist is populated', () => {
    const policy = makePolicy({ user_allowlist: [SYNTHETIC.userMember] });
    const event = makeChannelEvent({ sender_id: SYNTHETIC.userMemberSecond });
    const decision = authorize(makeRequest('accept_event', { event, policy }));
    expect(decision).toMatchObject({ allowed: false, reason: 'not_in_allowlist' });
  });

  it('allows any full member while the allowlist is empty (D006)', () => {
    const event = makeChannelEvent({ sender_id: SYNTHETIC.userMemberSecond });
    expect(authorize(makeRequest('accept_event', { event })).allowed).toBe(true);
  });

  it('treats an empty legacy channel list as no projected enrollment under D013', () => {
    const policy = makePolicy({ approved_channel_ids: [] });
    const decision = authorize(makeRequest('accept_event', { policy }));
    expect(decision).toMatchObject({ allowed: false, reason: 'unapproved_channel' });
  });

  it('denies a request whose contract version is a different major', () => {
    const decision = authorize(makeRequest('read_memory', { contractVersion: '2.0.0' }));
    expect(decision).toMatchObject({ allowed: false, reason: 'malformed_request' });
  });

  it('denies structurally invalid input rather than throwing', () => {
    for (const garbage of [null, undefined, 42, 'accept', {}, { gate: 'read_memory' }]) {
      const decision = authorize(garbage as never);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('malformed_request');
      expect(decision.scope).toHaveLength(0);
    }
  });

  it('denies an unrecognised gate', () => {
    const decision = authorize({ ...makeRequest('accept_event'), gate: 'generate' as never });
    expect(decision).toMatchObject({ allowed: false, reason: 'malformed_request' });
  });
});

describe('retrievalScope', () => {
  it('returns the granted boundaries for an allowed read', () => {
    const decision = authorize(makeRequest('read_memory'));
    expect(retrievalScope(decision)).toEqual([
      channelBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.channelApproved),
    ]);
  });

  it('throws rather than handing back an empty filter on a denial', () => {
    const event = makeChannelEvent({ channel_id: SYNTHETIC.channelUnapproved });
    const decision = authorize(makeRequest('read_memory', { event }));
    expect(() => retrievalScope(decision)).toThrow(AuthorizationScopeError);
  });

  it('throws for a gate that grants no scope', () => {
    const decision = authorize(makeRequest('write_memory'));
    expect(decision.allowed).toBe(true);
    expect(() => retrievalScope(decision)).toThrow(AuthorizationScopeError);
  });
});

describe('purity', () => {
  it('returns the same decision for the same input', () => {
    const request = makeRequest('read_memory', { event: makeDirectMessageEvent() });
    const first = authorize(request);
    const second = authorize(request);
    expect(first).toEqual(second);
  });

  it('returns a frozen decision and scope', () => {
    const decision = authorize(makeRequest('read_memory'));
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.scope)).toBe(true);
  });

  it('does not mutate the policy it was given', () => {
    const policy = makePolicy();
    const snapshot = JSON.stringify(policy);
    authorize(makeRequest('read_memory', { policy }));
    expect(JSON.stringify(policy)).toBe(snapshot);
  });

  it('keys a DM boundary on the human user, never the DM conversation ID', () => {
    const event = makeDirectMessageEvent();
    const decision = authorize(makeRequest('read_memory', { event }));
    expect(decision.scope).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
    ]);
    expect(decision.scope.some((id: BoundaryId) => id.includes(SYNTHETIC.dmConversation))).toBe(
      false,
    );
  });
});
