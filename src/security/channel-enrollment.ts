import type { PolicySnapshot } from './types.js';

/** Read-only T602 adapter used by response authorization. */
export interface ResponseChannelEnrollmentProbe {
  isEnrolled(workspaceId: string, channelId: string): Promise<boolean> | boolean;
}

/**
 * Replace the superseded static channel gate after T602 confirms membership.
 * Workspace, sender, user allowlist, and DM rules remain unchanged.
 */
export function policyForEnrolledChannel(
  policy: PolicySnapshot,
  channelId: string,
): PolicySnapshot {
  return Object.freeze({
    ...policy,
    approved_channel_ids: Object.freeze([channelId]),
  });
}
