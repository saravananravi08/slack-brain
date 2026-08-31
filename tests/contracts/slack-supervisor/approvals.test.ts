/**
 * approvals.md — gated action classes, version-bound approvals, ownership, and
 * human control verbs (GS-FR-006, GS-FR-007, GS-FR-016, GS-FR-033…036,
 * GS-INV-08, GS-INV-11).
 */

import { describe, expect, it } from 'vitest';

import {
  asArray,
  asRecord,
  asStrings,
  byName,
  loadContractDoc,
  loadFixture,
  names,
} from './helpers.js';
import {
  GATED_ACTION_CLASSES,
  approvalFailure,
  invalidatesApproval,
  isGated,
  mayRequestApproval,
  ownershipPermissions,
  type ActorClass,
  type Approval,
  type ApprovalWorkflow,
} from './reference-rules.js';

const fixture = loadFixture('approvals.v1.json');
const workflow = fixture.workflow as unknown as ApprovalWorkflow;
const gating = asArray(fixture.gating, 'gating');
const validity = asArray(fixture.validity, 'validity');
const invalidation = asArray(fixture.invalidation, 'invalidation');
const ownership = asArray(fixture.ownership, 'ownership');
const verbs = asArray(fixture.control_verbs, 'control_verbs');

describe('gated action classes (approvals.md §2.1, GS-FR-035)', () => {
  it('matches the frozen closed set', () => {
    expect(asStrings(fixture.gated_action_classes, 'gated_action_classes')).toEqual([
      ...GATED_ACTION_CLASSES,
    ]);
  });

  it('gates merge, release, deletion, destruction, and credential changes', () => {
    for (const gated of [
      'merge',
      'release',
      'delete',
      'destructive',
      'credential_or_security_change',
      'irreversible_other',
    ]) {
      expect(isGated(gated), `${gated} must be gated`).toBe(true);
    }
  });

  it('gates ownership transfer, scope expansion, and cancelling another owner', () => {
    for (const gated of ['ownership_transfer', 'scope_expansion', 'cancel_other_owner_workflow']) {
      expect(isGated(gated), `${gated} must be gated`).toBe(true);
    }
  });

  it.each(names(gating))('%s', (name) => {
    const testCase = byName(gating, name);
    expect(isGated(String(testCase.action_class))).toBe(testCase.expect_gated);
    expect(mayRequestApproval(String(testCase.action_class))).toBe(
      testCase.expect_may_request_approval,
    );
  });
});

describe('reversible work runs without confirmation (approvals.md §1, GS-FR-006)', () => {
  it('never requests approval for a non-gated action', () => {
    // Redundant confirmation is a contract violation, not caution: it trains
    // owners to approve without reading, which is how a genuinely gated
    // action gets waved through.
    for (const workClass of [
      'implement',
      'investigate',
      'test',
      'fix',
      'review',
      'find',
      'create',
      'update',
      'comment',
      'report',
    ]) {
      expect(mayRequestApproval(workClass), `${workClass} must not be gated`).toBe(false);
    }
  });

  it('separates approvals from human decisions that only need an answer', () => {
    const decisions = asStrings(fixture.human_decision_classes, 'human_decision_classes');
    expect(decisions).toEqual([
      'ambiguous_destination',
      'conflicting_requirements',
      'missing_required_target',
      'unresolvable_blocker',
    ]);
    for (const decision of decisions) {
      expect(isGated(decision), `${decision} is a question, not an approval`).toBe(false);
    }
  });
});

describe('approval validity (approvals.md §3.1, GS-FR-036)', () => {
  it.each(names(validity))('%s', (name) => {
    const testCase = byName(validity, name);
    expect(
      approvalFailure(
        testCase.approval as unknown as Approval,
        workflow,
        String(testCase.now),
      ),
    ).toBe(testCase.expect_failure);
  });

  it('covers every one of the six checks failing independently', () => {
    const failures = validity
      .map((testCase) => testCase.expect_failure)
      .filter((failure): failure is string => typeof failure === 'string');
    for (const failure of [
      'not_granted',
      'workflow_mismatch',
      'action_mismatch',
      'version_mismatch',
      'approver_not_authorized',
      'expired',
    ]) {
      expect(failures, `no case exercises ${failure}`).toContain(failure);
    }
  });

  it('accepts the owner and a configured approver, and nobody else', () => {
    expect(byName(validity, 'valid_owner_approval').expect_failure).toBeNull();
    expect(byName(validity, 'valid_configured_approver_approval').expect_failure).toBeNull();
    expect(byName(validity, 'approval_from_a_non_owner_human').expect_failure).toBe(
      'approver_not_authorized',
    );
  });

  it('re-reads validity at dispatch time, so a restart changes nothing', () => {
    // GS-NFR-007 — the approval is not cached at grant time.
    const testCase = byName(validity, 'restart_between_grant_and_dispatch_changes_nothing');
    expect(testCase.restarted_between).toBe(true);
    expect(
      approvalFailure(
        testCase.approval as unknown as Approval,
        workflow,
        String(testCase.now),
      ),
    ).toBeNull();
  });
});

describe('no bot, echo, or unauthorized human can approve (GS-FR-033, GS-FR-040)', () => {
  const base = byName(validity, 'valid_owner_approval').approval as unknown as Approval;

  it.each(['kilo', 'linear', 'gist_self', 'unknown_automation', 'unauthorized_human'] as ActorClass[])(
    '%s cannot grant an approval even as the owner ID',
    (actorClass) => {
      // A Kilo or Linear reply reporting an upstream approval is evidence
      // about another system, never an approval here.
      expect(
        approvalFailure(
          { ...base, approver_actor_class: actorClass },
          workflow,
          '2026-09-01T00:20:00.000Z',
        ),
      ).toBe('approver_not_authorized');
    },
  );

  it('rejects a Linear-reported upstream approval', () => {
    expect(byName(validity, 'approval_from_linear').expect_failure).toBe('approver_not_authorized');
  });
});

describe('invalidation is structural (approvals.md §3.2)', () => {
  it.each(names(invalidation))('%s', (name) => {
    const testCase = byName(invalidation, name);
    expect(invalidatesApproval(String(testCase.change))).toBe(testCase.expect_invalidated);
  });

  it('invalidates on any material change to the approved action', () => {
    for (const change of [
      'version_increment',
      'objective',
      'scope',
      'acceptance',
      'work_class',
      'logical_target',
      'owner',
    ]) {
      expect(invalidatesApproval(change), `${change} must invalidate`).toBe(true);
    }
  });

  it('does not force a second approval for ordinary progress', () => {
    expect(invalidatesApproval('bot_progress_reply')).toBe(false);
  });

  it('fails a superseded version through the ordinary version check', () => {
    // The mechanism is the version bump, so invalidation is structural rather
    // than something a code path has to remember to do.
    const testCase = byName(validity, 'approval_for_a_superseded_version');
    expect(
      approvalFailure(
        testCase.approval as unknown as Approval,
        workflow,
        String(testCase.now),
      ),
    ).toBe('version_mismatch');
  });
});

describe('ownership (approvals.md §4, GS-FR-016)', () => {
  it('keeps configured-approver control aligned with owner-only redirect across contracts', () => {
    const approvalsDoc = loadContractDoc('approvals.md');
    const workflowDoc = loadContractDoc('workflow-state.md');

    expect(approvalsDoc).toContain('| configured approver | yes | yes | **no** |');
    expect(approvalsDoc).toContain('A configured approver may approve or cancel but can never materially redirect');
    expect(workflowDoc).toContain(
      '| material redirect (new objective, new logical target, widened scope) | the owner only;',
    );
    expect(approvalsDoc).not.toContain('| configured approver | yes | yes | yes |');
  });

  it.each(names(ownership))('%s', (name) => {
    const testCase = byName(ownership, name);
    const permissions = ownershipPermissions({
      actor_class: testCase.actor_class as ActorClass,
      is_owner: Boolean(testCase.is_owner),
      is_approver: Boolean(testCase.is_approver),
    });
    expect(permissions.may_discuss).toBe(testCase.expect_may_discuss);
    expect(permissions.may_control).toBe(testCase.expect_may_control);
  });

  it('lets another authorized human discuss without controlling', () => {
    const permissions = ownershipPermissions({
      actor_class: 'authorized_human',
      is_owner: false,
      is_approver: false,
    });
    expect(permissions.may_discuss).toBe(true);
    expect(permissions.may_control).toBe(false);
  });

  it('gates ownership transfer and invalidates outstanding approvals', () => {
    // The new owner inherits the work, not the previous owner's consent.
    const transfer = asRecord(fixture.ownership_transfer, 'ownership_transfer');
    expect(isGated(String(transfer.gated_class))).toBe(true);
    expect(transfer.expect_requires_approval).toBe(true);
    expect(transfer.expect_invalidates_outstanding_approvals).toBe(true);
    expect(transfer.expect_recorded_on_workflow).toBe(true);
  });
});

describe('human control verbs (approvals.md §5, GS-FR-034)', () => {
  it('covers status, pause, resume, correct, cancel, details, approve, and deny', () => {
    expect(names(verbs).slice().sort()).toEqual([
      'approve',
      'cancel',
      'correct',
      'deny',
      'pause',
      'provide_details',
      'resume',
      'status',
    ]);
  });

  it('lets any authorized human read status and supply details', () => {
    // Status exposes only state, counts, and classes — the same content-free
    // fields a log line may carry.
    for (const verb of ['status', 'provide_details']) {
      expect(byName(verbs, verb).requires_owner_or_approver).toBe(false);
    }
  });

  it('restricts correction to the owner alone', () => {
    expect(byName(verbs, 'correct').owner_only).toBe(true);
  });

  it('restricts pause, resume, cancel, approve, and deny to the owner or approver', () => {
    for (const verb of ['pause', 'resume', 'cancel', 'approve', 'deny']) {
      expect(byName(verbs, verb).requires_owner_or_approver, verb).toBe(true);
    }
  });
});

describe('a limit stop is not an approval (approvals.md §6)', () => {
  const stop = asRecord(fixture.limit_stop_is_not_an_approval, 'limit_stop_is_not_an_approval');

  it('waits for a human without an approval record', () => {
    expect(stop.state).toBe('waiting_human');
    expect(stop.approval_state).toBe('none');
    expect(stop.expect_carries_approval_record).toBe(false);
  });

  it('does not raise the limit when the human says continue', () => {
    expect(stop.expect_limit_raised_by_continue).toBe(false);
  });
});
