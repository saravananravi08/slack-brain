import { LibSQLFactoryStorage } from '@mastra/libsql';

import {
  CHANNEL_MEMORY_CONTRACT_VERSION,
  JoinedChannelRegistry,
  type ChannelBoundaryId,
  type JoinedChannelFact,
  type LeftChannelFact,
} from '../../../src/channel-memory/registry/index.js';

export const SYNTHETIC = {
  workspaceId: 'T0CHANTEST',
  channelA: 'C0CHANTESTA',
  channelB: 'C0CHANTESTB',
  unknownChannel: 'C0CHANTESTZ',
  boundaryA: 'ch:T0CHANTEST:C0CHANTESTA' as ChannelBoundaryId,
  boundaryB: 'ch:T0CHANTEST:C0CHANTESTB' as ChannelBoundaryId,
  unknownBoundary: 'ch:T0CHANTEST:C0CHANTESTZ' as ChannelBoundaryId,
  firstJoinTs: '1767603600.000100',
  leaveTs: '1767718800.000100',
  rejoinTs: '1767862800.000100',
} as const;

export interface RegistryHarness {
  readonly storage: LibSQLFactoryStorage;
  readonly registry: JoinedChannelRegistry;
}

export async function createHarness(url = ':memory:'): Promise<RegistryHarness> {
  const storage = new LibSQLFactoryStorage({ id: 't602-registry-test', url });
  const registry = storage.registerDomain(new JoinedChannelRegistry());
  await storage.init();
  return { storage, registry };
}

export function joinedFact(overrides: Partial<JoinedChannelFact> = {}): JoinedChannelFact {
  return {
    contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
    boundary_id: SYNTHETIC.boundaryA,
    workspace_id: SYNTHETIC.workspaceId,
    channel_id: SYNTHETIC.channelA,
    verification: 'slack_gist_membership',
    kind: 'member_joined_channel',
    ts: SYNTHETIC.firstJoinTs,
    event_id: 'Ev0CHANTEST0001',
    ...overrides,
  };
}

export function leftFact(overrides: Partial<LeftChannelFact> = {}): LeftChannelFact {
  return {
    contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
    boundary_id: SYNTHETIC.boundaryA,
    workspace_id: SYNTHETIC.workspaceId,
    channel_id: SYNTHETIC.channelA,
    verification: 'slack_gist_membership',
    kind: 'member_left_channel',
    ts: SYNTHETIC.leaveTs,
    event_id: 'Ev0CHANTEST0002',
    ...overrides,
  };
}
