import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  IDENTITY_CONTRACT_VERSION,
  boundaryIdFor,
  deliveryKey,
  messageKey,
  resolveIdentity,
  type IdentityEvent,
} from '../../src/mastra/memory/resource-policy.js';

interface IdentityFixture {
  contract_version: string;
  cases: Array<Record<string, unknown>>;
  forbidden: Array<Record<string, unknown>>;
}

const fixture = JSON.parse(
  await readFile(
    new URL('../../docs/architecture/contracts/fixtures/identities.v1.json', import.meta.url),
    'utf8',
  ),
) as IdentityFixture;

function event(overrides: Partial<IdentityEvent> = {}): IdentityEvent {
  return {
    contract_version: fixture.contract_version,
    workspace_id: 'T0SYNTH01',
    channel_id: 'C0APPROVED1',
    conversation_type: 'channel',
    message_ts: '1735689650.000100',
    thread_ts: null,
    sender_id: 'U0MEMBER01',
    ...overrides,
  };
}

function fixtureCase(name: string): Record<string, any> {
  const found = fixture.cases.find((candidate) => candidate.name === name);
  expect(found, `Missing identity fixture: ${name}`).toBeDefined();
  return found as Record<string, any>;
}

describe('resource identity contract fixtures', () => {
  it('pins the supported contract version', () => {
    expect(fixture.contract_version).toBe('1.0.0');
    expect(IDENTITY_CONTRACT_VERSION).toBe(fixture.contract_version);
  });

  it.each(['channel_root', 'channel_root_self_referential_thread_ts', 'channel_reply'])(
    'maps %s to its channel resource and thread',
    (name) => {
      const testCase = fixtureCase(name);
      const identity = resolveIdentity({
        contract_version: fixture.contract_version,
        ...testCase.input,
      } as IdentityEvent);

      expect(identity).toMatchObject(testCase.expect);
      expect(identity.resource_id).toBe(identity.boundary_id);
      expect(boundaryIdFor(identity)).toBe(testCase.expect.boundary_id);
    },
  );

  it('maps DMs by human user rather than Slack DM conversation', () => {
    const root = fixtureCase('dm_root');
    const expected = root.expect;
    const first = resolveIdentity({
      contract_version: fixture.contract_version,
      ...root.input,
    } as IdentityEvent);
    const reopenedConversation = resolveIdentity({
      contract_version: fixture.contract_version,
      ...root.input,
      channel_id: 'D0DMCONV99',
      message_ts: '1735689700.000100',
    } as IdentityEvent);

    expect(first).toMatchObject(expected);
    expect(reopenedConversation.boundary_id).toBe(expected.boundary_id);
    expect(reopenedConversation.boundary_id).not.toContain(root.input.channel_id);
  });

  it('isolates DM users', () => {
    const first = resolveIdentity({
      contract_version: fixture.contract_version,
      ...fixtureCase('dm_root').input,
    } as IdentityEvent);
    const secondCase = fixtureCase('dm_second_user_isolated');
    const second = resolveIdentity({
      contract_version: fixture.contract_version,
      ...secondCase.input,
    } as IdentityEvent);

    expect(second).toMatchObject(secondCase.expect);
    expect(second.boundary_id).not.toBe(first.boundary_id);
  });

  it('keeps channel and DM suffix collisions structurally distinct', () => {
    const testCase = fixtureCase('suffix_collision_pair');
    const channel = resolveIdentity({
      contract_version: fixture.contract_version,
      ...testCase.input_channel,
    } as IdentityEvent);
    const dm = resolveIdentity({
      contract_version: fixture.contract_version,
      ...testCase.input_dm,
    } as IdentityEvent);

    expect(channel.boundary_id).toBe(testCase.expect_channel_boundary);
    expect(dm.boundary_id).toBe(testCase.expect_dm_boundary);
    expect(channel.boundary_id).not.toBe(dm.boundary_id);
    expect(channel.boundary_id.startsWith('ch:')).toBe(true);
    expect(dm.boundary_id.startsWith('dm:')).toBe(true);
  });

  it('includes workspace in every boundary', () => {
    const testCase = fixtureCase('workspace_disambiguation');
    const first = resolveIdentity({
      contract_version: fixture.contract_version,
      ...testCase.input_a,
    } as IdentityEvent);
    const second = resolveIdentity({
      contract_version: fixture.contract_version,
      ...testCase.input_b,
    } as IdentityEvent);

    expect(first.boundary_id).not.toBe(second.boundary_id);
  });

  it('normalizes both Slack root encodings to one thread', () => {
    const absent = resolveIdentity(event());
    const selfReferential = resolveIdentity(event({
      thread_ts: '1735689650.000100',
    }));

    expect(absent.thread_id).toBe(selfReferential.thread_id);
  });

  it('is deterministic across independent calls', () => {
    const input = event({ thread_ts: '1735689600.000100' });

    expect(resolveIdentity({ ...input })).toEqual(resolveIdentity({ ...input }));
  });
});

describe('content and delivery idempotency keys', () => {
  it('converges live and imported content without inventing a delivery key', () => {
    const live = {
      ...event(),
      event_id: 'Ev0SYNTH0001',
      source: 'live',
    };
    const imported = {
      workspace_id: live.workspace_id,
      channel_id: live.channel_id,
      message_ts: live.message_ts,
      source: 'import',
    };

    expect(messageKey(live)).toBe('T0SYNTH01/C0APPROVED1/1735689650.000100');
    expect(messageKey(imported)).toBe(messageKey(live));
    expect(deliveryKey(live)).toBe('Ev0SYNTH0001');
  });

  it('keeps content dedup separate from delivery dedup', () => {
    const firstDelivery = { ...event(), event_id: 'Ev0SYNTH0001' };
    const secondDelivery = { ...firstDelivery, event_id: 'Ev0SYNTH0002' };

    expect(messageKey(firstDelivery)).toBe(messageKey(secondDelivery));
    expect(deliveryKey(firstDelivery)).not.toBe(deliveryKey(secondDelivery));
  });

  it('preserves timestamp strings verbatim', () => {
    const precise = event({ message_ts: '1735689600.000200' });
    const shorter = event({ message_ts: '1735689600.0002' });

    expect(messageKey(precise)).not.toBe(messageKey(shorter));
  });
});

describe('invalid identity input', () => {
  it.each([
    ['contract_version', { contract_version: '2.0.0' }],
    ['workspace_id', { workspace_id: '' }],
    ['workspace_id', { workspace_id: 'T0SYNTH01:C0APPROVED1' }],
    ['channel_id', { channel_id: 'D0DMCONV01' }],
    ['message_ts', { message_ts: '1735689650/000100' }],
    ['thread_ts', { thread_ts: 'not-a-slack-ts' }],
    ['sender_id', { sender_id: '' }],
  ])('rejects malformed %s', (_field, override) => {
    expect(() => resolveIdentity(event(override))).toThrow(TypeError);
  });

  it('rejects a channel-shaped ID for a DM and a DM-shaped ID for a channel', () => {
    expect(() =>
      resolveIdentity(event({ conversation_type: 'dm', channel_id: 'C0APPROVED1' })),
    ).toThrow(TypeError);
    expect(() =>
      resolveIdentity(event({ conversation_type: 'channel', channel_id: 'D0DMCONV01' })),
    ).toThrow(TypeError);
  });

  it('rejects missing required input rather than guessing', () => {
    const malformed = fixture.forbidden.find(
      (candidate) => candidate.name === 'malformed_input_missing_workspace',
    );

    expect(() =>
      resolveIdentity({
        contract_version: fixture.contract_version,
        ...(malformed?.input as object),
      } as IdentityEvent),
    ).toThrow(TypeError);
  });

  it('rejects bare or internally inconsistent resource identities', () => {
    const valid = resolveIdentity(event());

    expect(() =>
      boundaryIdFor({ ...valid, boundary_id: 'C0APPROVED1' as never }),
    ).toThrow(TypeError);
    expect(() =>
      boundaryIdFor({ ...valid, conversation_type: 'dm' }),
    ).toThrow(TypeError);
    expect(() =>
      boundaryIdFor({ ...valid, resource_id: 'ch:T0SYNTH01:C0APPROVED2' }),
    ).toThrow(TypeError);
  });

  it('rejects malformed message and delivery keys', () => {
    expect(() => messageKey({ ...event(), channel_id: 'C0APPROVED1/other' })).toThrow(
      TypeError,
    );
    expect(() => deliveryKey({ event_id: '' })).toThrow(TypeError);
  });
});
