/**
 * Building a `PolicySnapshot` from validated configuration.
 *
 * Policy is *passed in*, never read from ambient globals, so components cannot
 * observe different workspace/user policy. Under D013 the channel list is a
 * legacy deny-only migration field; T606 projects one T602-confirmed channel
 * into the pure guard for each live channel request.
 */

import type { Config } from '../config.js';
import type { PolicySnapshot } from './types.js';

/**
 * D002 is in force: DMs read private conversation memory only.
 *
 * T102 types `GIST_DM_SHARED_KNOWLEDGE` as the literal `false`, so no
 * configuration can turn shared knowledge on. That is deliberate — D002
 * requires written owner re-approval, a fail-closed membership resolver, and a
 * passing T502 suite before the flag may move, and none of those is a code
 * change made under time pressure.
 */
export function policySnapshotFromConfig(config: Config): PolicySnapshot {
  return Object.freeze({
    approved_workspace_id: config.approvedWorkspaceId,
    approved_channel_ids: Object.freeze([...config.approvedChannelIds]),
    user_allowlist: Object.freeze([...config.userAllowlist]),
    dm_shared_knowledge: config.dmSharedKnowledge,
  });
}
