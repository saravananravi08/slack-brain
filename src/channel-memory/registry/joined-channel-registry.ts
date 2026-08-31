import type { CollectionSchema } from '@mastra/core/storage';
import { FactoryStorageDomain, UniqueViolationError } from '@mastra/core/storage';

import {
  CHANNEL_MEMORY_CONTRACT_VERSION,
  type CaptureEnrollmentCheck,
  type ChannelBoundaryId,
  type ChannelEnrollment,
  type ContextEnrollmentCheck,
  type EnrollmentState,
  type ListEnrollmentsOptions,
  type MembershipApplyReason,
  type MembershipApplyResult,
  type MembershipFact,
  type MembershipSource,
} from './types.js';
import {
  compareMessageTs,
  isSlackTimestamp,
  slackTimestampToISOString,
  withinCaptureFloor,
} from './timestamps.js';

const COLLECTION = 'gist_channel_enrollments';
const DOMAIN = 'joined-channel-registry';
const WORKSPACE_ID = /^T[A-Z0-9]{8,}$/;
const CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;
const EVENT_ID = /^\S+$/;
const MEMBERSHIP_SOURCES: ReadonlySet<string> = new Set([
  'member_joined_channel',
  'member_left_channel',
  'conversations_members',
  'operator_reconciliation',
]);

const ENROLLMENT_SCHEMA = {
  name: COLLECTION,
  columns: {
    boundary_id: { type: 'text', primaryKey: true },
    workspace_id: { type: 'text' },
    channel_id: { type: 'text' },
    state: { type: 'text' },
    epoch: { type: 'integer' },
    enrolled_at: { type: 'timestamp' },
    capture_floor_ts: { type: 'text' },
    left_at: { type: 'timestamp', nullable: true },
    membership_source: { type: 'text' },
    membership_confirmed_at: { type: 'timestamp' },
    retention: { type: 'text', default: 'retained' },
    // Internal ordering cursor. Not part of the frozen public record.
    membership_fact_ts: { type: 'text' },
  },
  uniqueIndexes: [{
    name: 'gist_channel_enrollments_workspace_channel_unique',
    columns: ['workspace_id', 'channel_id'],
  }],
  indexes: [{
    name: 'gist_channel_enrollments_state_idx',
    columns: ['state'],
  }],
} as const satisfies CollectionSchema;

type EnrollmentRow = {
  boundary_id: string;
  workspace_id: string;
  channel_id: string;
  state: string;
  epoch: number;
  enrolled_at: Date;
  capture_floor_ts: string;
  left_at: Date | null;
  membership_source: string;
  membership_confirmed_at: Date;
  retention: string;
  membership_fact_ts: string;
};

type ValidatedFact = MembershipFact & {
  readonly confirmedAt: Date;
  readonly targetState: EnrollmentState;
};

function isChannelIdentity(
  boundaryId: unknown,
  workspaceId: unknown,
  channelId: unknown,
): boundaryId is ChannelBoundaryId {
  if (
    typeof boundaryId !== 'string' ||
    typeof workspaceId !== 'string' ||
    typeof channelId !== 'string' ||
    !WORKSPACE_ID.test(workspaceId) ||
    !CHANNEL_ID.test(channelId)
  ) return false;

  const parts = boundaryId.split(':');
  return (
    parts.length === 3 &&
    parts[0] === 'ch' &&
    parts[1] === workspaceId &&
    parts[2] === channelId
  );
}

function parseBoundaryId(value: unknown): {
  readonly boundaryId: ChannelBoundaryId;
  readonly workspaceId: string;
  readonly channelId: string;
} | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length !== 3) return null;
  const [prefix, workspaceId, channelId] = parts;
  if (
    prefix !== 'ch' ||
    workspaceId === undefined ||
    channelId === undefined ||
    !isChannelIdentity(value, workspaceId, channelId)
  ) return null;
  return { boundaryId: value, workspaceId, channelId };
}

function targetState(fact: MembershipFact): EnrollmentState {
  if (fact.kind === 'member_left_channel') return 'left';
  if (fact.kind === 'operator_reconciliation') return fact.state;
  return 'enrolled';
}

function validateFact(value: unknown): ValidatedFact | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fact = value as Partial<MembershipFact>;
  if (
    fact.contract_version !== CHANNEL_MEMORY_CONTRACT_VERSION ||
    fact.verification !== 'slack_gist_membership' ||
    !isChannelIdentity(fact.boundary_id, fact.workspace_id, fact.channel_id) ||
    !isSlackTimestamp(fact.ts)
  ) return null;

  if (
    (fact.kind === 'member_joined_channel' || fact.kind === 'member_left_channel') &&
    (typeof fact.event_id !== 'string' || !EVENT_ID.test(fact.event_id))
  ) return null;
  if (fact.kind === 'conversations_members' && fact.state !== 'enrolled') return null;
  if (
    fact.kind === 'operator_reconciliation' &&
    fact.state !== 'enrolled' &&
    fact.state !== 'left'
  ) return null;
  if (!MEMBERSHIP_SOURCES.has(String(fact.kind))) return null;

  const confirmedAt = slackTimestampToISOString(fact.ts);
  if (!confirmedAt) return null;
  return {
    ...(fact as MembershipFact),
    confirmedAt: new Date(confirmedAt),
    targetState: targetState(fact as MembershipFact),
  };
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function rowToEnrollment(row: EnrollmentRow): ChannelEnrollment | null {
  if (
    !isChannelIdentity(row.boundary_id, row.workspace_id, row.channel_id) ||
    (row.state !== 'enrolled' && row.state !== 'left') ||
    !Number.isInteger(row.epoch) ||
    row.epoch < 1 ||
    !isValidDate(row.enrolled_at) ||
    !isSlackTimestamp(row.capture_floor_ts) ||
    !isValidDate(row.membership_confirmed_at) ||
    !isSlackTimestamp(row.membership_fact_ts) ||
    !MEMBERSHIP_SOURCES.has(row.membership_source) ||
    row.retention !== 'retained' ||
    (row.left_at !== null && !isValidDate(row.left_at)) ||
    (row.state === 'enrolled') !== (row.left_at === null)
  ) return null;

  return {
    contract_version: CHANNEL_MEMORY_CONTRACT_VERSION,
    boundary_id: row.boundary_id,
    workspace_id: row.workspace_id,
    channel_id: row.channel_id,
    state: row.state,
    epoch: row.epoch,
    enrolled_at: row.enrolled_at.toISOString(),
    capture_floor_ts: row.capture_floor_ts,
    left_at: row.left_at?.toISOString() ?? null,
    membership_source: row.membership_source as MembershipSource,
    membership_confirmed_at: row.membership_confirmed_at.toISOString(),
    retention: 'retained',
  };
}

function initialRow(fact: ValidatedFact): EnrollmentRow {
  return {
    boundary_id: fact.boundary_id,
    workspace_id: fact.workspace_id,
    channel_id: fact.channel_id,
    state: 'enrolled',
    epoch: 1,
    enrolled_at: fact.confirmedAt,
    capture_floor_ts: fact.ts,
    left_at: null,
    membership_source: fact.kind,
    membership_confirmed_at: fact.confirmedAt,
    retention: 'retained',
    membership_fact_ts: fact.ts,
  };
}

interface Transition {
  readonly patch: Partial<EnrollmentRow> | null;
  readonly reason: MembershipApplyReason;
}

function transition(row: EnrollmentRow, fact: ValidatedFact): Transition {
  if (!rowToEnrollment(row)) return { patch: null, reason: 'registry_unavailable' };

  const order = compareMessageTs(fact.ts, row.membership_fact_ts);
  if (order === null) return { patch: null, reason: 'registry_unavailable' };
  if (order < 0) return { patch: null, reason: 'stale_membership_fact' };
  if (order === 0) return { patch: null, reason: null };

  const shared = {
    membership_source: fact.kind,
    membership_confirmed_at: fact.confirmedAt,
    membership_fact_ts: fact.ts,
  } as const;

  if (fact.targetState === 'left') {
    return {
      patch: {
        ...shared,
        state: 'left',
        left_at: fact.confirmedAt,
      },
      reason: null,
    };
  }

  if (row.state === 'left') {
    return {
      patch: {
        ...shared,
        state: 'enrolled',
        epoch: row.epoch + 1,
        enrolled_at: fact.confirmedAt,
        capture_floor_ts: fact.ts,
        left_at: null,
      },
      reason: null,
    };
  }

  return { patch: shared, reason: null };
}

const rejected = (reason: Exclude<MembershipApplyReason, null>): MembershipApplyResult => ({
  outcome: 'rejected',
  reason,
});

/** Durable, membership-authoritative registry for channel-memory enrollment. */
export class JoinedChannelRegistry extends FactoryStorageDomain {
  constructor() {
    super(DOMAIN);
  }

  override async init(): Promise<void> {
    await this.ensureCollections([ENROLLMENT_SCHEMA]);
  }

  override async dangerouslyClearAll(): Promise<void> {
    await this.ensureReady();
    await this.ops.deleteMany(COLLECTION, {});
  }

  async applyMembershipFact(value: MembershipFact): Promise<MembershipApplyResult> {
    const fact = validateFact(value);
    if (!fact) return rejected('invalid_membership_fact');

    try {
      await this.ensureReady();
      return await this.#apply(fact);
    } catch {
      return rejected('registry_unavailable');
    }
  }

  async #apply(fact: ValidatedFact): Promise<MembershipApplyResult> {
    const existing = await this.ops.findOne<EnrollmentRow>(COLLECTION, {
      boundary_id: fact.boundary_id,
    });

    if (!existing) {
      if (fact.targetState === 'left') {
        return { outcome: 'unchanged', reason: 'channel_not_enrolled' };
      }
      try {
        await this.ops.insertOne<EnrollmentRow>(COLLECTION, initialRow(fact));
        return { outcome: 'inserted', reason: null };
      } catch (error) {
        if (!(error instanceof UniqueViolationError)) throw error;
        return this.#updateExisting(fact);
      }
    }

    return this.#updateExisting(fact);
  }

  async #updateExisting(fact: ValidatedFact): Promise<MembershipApplyResult> {
    let changed = false;
    let reason: MembershipApplyReason = null;
    const row = await this.ops.updateAtomic<EnrollmentRow>(
      COLLECTION,
      { boundary_id: fact.boundary_id },
      (current) => {
        const result = transition(current, fact);
        reason = result.reason;
        changed = result.patch !== null;
        return result.patch;
      },
    );

    if (!row || !rowToEnrollment(row)) return rejected('registry_unavailable');
    return { outcome: changed ? 'updated' : 'unchanged', reason };
  }

  async enrollmentFor(boundaryId: ChannelBoundaryId): Promise<ChannelEnrollment | null> {
    if (!parseBoundaryId(boundaryId)) return null;

    try {
      await this.ensureReady();
      const row = await this.ops.findOne<EnrollmentRow>(COLLECTION, {
        boundary_id: boundaryId,
      });
      return row ? rowToEnrollment(row) : null;
    } catch {
      return null;
    }
  }

  async list(options: ListEnrollmentsOptions = {}): Promise<readonly ChannelEnrollment[]> {
    if (options.state !== undefined && options.state !== 'enrolled' && options.state !== 'left') {
      return [];
    }

    try {
      await this.ensureReady();
      const rows = await this.ops.findMany<EnrollmentRow>(
        COLLECTION,
        options.state === undefined ? {} : { state: options.state },
        { orderBy: [['workspace_id', 'asc'], ['channel_id', 'asc']] },
      );
      return rows.flatMap((row) => {
        const enrollment = rowToEnrollment(row);
        return enrollment ? [enrollment] : [];
      });
    } catch {
      return [];
    }
  }

  async captureEligibilityFor(
    boundaryId: ChannelBoundaryId,
    messageTs: string,
  ): Promise<CaptureEnrollmentCheck> {
    if (!parseBoundaryId(boundaryId) || !isSlackTimestamp(messageTs)) {
      return { capture: false, reason: 'malformed_event', enrollment_epoch: null };
    }

    const enrollment = await this.enrollmentFor(boundaryId);
    if (!enrollment || enrollment.state !== 'enrolled') {
      return { capture: false, reason: 'channel_not_enrolled', enrollment_epoch: null };
    }
    if (!withinCaptureFloor(enrollment, messageTs)) {
      return {
        capture: false,
        reason: 'before_capture_floor',
        enrollment_epoch: enrollment.epoch,
      };
    }
    return { capture: true, reason: null, enrollment_epoch: enrollment.epoch };
  }

  async contextEligibilityFor(boundaryId: ChannelBoundaryId): Promise<ContextEnrollmentCheck> {
    if (!parseBoundaryId(boundaryId)) {
      return { context_allowed: false, reason: 'malformed_request' };
    }
    return (await this.enrollmentFor(boundaryId))
      ? { context_allowed: true, reason: null }
      : { context_allowed: false, reason: 'channel_not_enrolled' };
  }
}
