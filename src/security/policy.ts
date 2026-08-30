/**
 * Building a `PolicySnapshot` from validated configuration.
 *
 * D001's consequence for the guard is that policy is *passed in*, never read
 * from ambient globals — so that two components can never be looking at
 * different policy, and so every test case is a plain object. This is the one
 * place that projects T102's validated `Config` into that shape, and it is a
 * pure function of its argument: it reads no environment variable itself.
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
