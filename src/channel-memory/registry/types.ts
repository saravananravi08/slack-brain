export const CHANNEL_MEMORY_CONTRACT_VERSION = '1.0.0' as const;

export type ChannelBoundaryId = `ch:${string}:${string}`;
export type EnrollmentState = 'enrolled' | 'left';
export type MembershipSource =
  | 'member_joined_channel'
  | 'member_left_channel'
  | 'conversations_members'
  | 'operator_reconciliation';

export interface ChannelEnrollment {
  readonly contract_version: typeof CHANNEL_MEMORY_CONTRACT_VERSION;
  readonly boundary_id: ChannelBoundaryId;
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly state: EnrollmentState;
  readonly epoch: number;
  readonly enrolled_at: string;
  readonly capture_floor_ts: string;
  readonly left_at: string | null;
  readonly membership_source: MembershipSource;
  readonly membership_confirmed_at: string;
  readonly retention: 'retained';
}

interface MembershipFactBase {
  readonly contract_version: typeof CHANNEL_MEMORY_CONTRACT_VERSION;
  readonly boundary_id: ChannelBoundaryId;
  readonly workspace_id: string;
  readonly channel_id: string;
  /** Set only after Slack confirms Gist membership in an internal channel. */
  readonly verification: 'slack_gist_membership';
  /** Membership event or observation Slack ts, kept verbatim. */
  readonly ts: string;
}

export interface JoinedChannelFact extends MembershipFactBase {
  readonly kind: 'member_joined_channel';
  readonly event_id: string;
}

export interface LeftChannelFact extends MembershipFactBase {
  readonly kind: 'member_left_channel';
  readonly event_id: string;
}

export interface MembersConfirmationFact extends MembershipFactBase {
  readonly kind: 'conversations_members';
  readonly state: 'enrolled';
}

export interface OperatorReconciliationFact extends MembershipFactBase {
  readonly kind: 'operator_reconciliation';
  readonly state: EnrollmentState;
}

export type MembershipFact =
  | JoinedChannelFact
  | LeftChannelFact
  | MembersConfirmationFact
  | OperatorReconciliationFact;

export type MembershipApplyOutcome = 'inserted' | 'updated' | 'unchanged' | 'rejected';
export type MembershipApplyReason =
  | 'invalid_membership_fact'
  | 'channel_not_enrolled'
  | 'stale_membership_fact'
  | 'registry_unavailable'
  | null;

/** Safe operational result: no channel identifier, message content, or credential. */
export interface MembershipApplyResult {
  readonly outcome: MembershipApplyOutcome;
  readonly reason: MembershipApplyReason;
}

export type CaptureEnrollmentReason =
  | 'channel_not_enrolled'
  | 'before_capture_floor'
  | 'malformed_event'
  | null;

export interface CaptureEnrollmentCheck {
  readonly capture: boolean;
  readonly reason: CaptureEnrollmentReason;
  readonly enrollment_epoch: number | null;
}

export type ContextEnrollmentReason = 'channel_not_enrolled' | 'malformed_request' | null;

export interface ContextEnrollmentCheck {
  readonly context_allowed: boolean;
  readonly reason: ContextEnrollmentReason;
}

export interface ListEnrollmentsOptions {
  readonly state?: EnrollmentState;
}
