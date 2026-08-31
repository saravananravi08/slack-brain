/**
 * events.md — the supervisor event record, admission order, evaluation
 * eligibility, workflow correlation, serialization, and duplicate suppression
 * (GS-FR-001…003, GS-FR-017…021, GS-FR-032, GS-FR-041).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadFixture, names } from './helpers.js';
import {
  correlate,
  cooldownSuppresses,
  duplicateReason,
  evaluationEligibility,
  routingFor,
  type ActorClass,
  type CorrelationEvent,
  type EligibilityInput,
  type ExpectedActor,
  type WorkflowBinding,
  type WorkflowState,
} from './reference-rules.js';

const fixture = loadFixture('events.v1.json');
const binding = fixture.binding as unknown as WorkflowBinding;
const eligibility = asArray(fixture.eligibility, 'eligibility');
const correlationCases = asArray(fixture.correlation, 'correlation');
const duplicates = asArray(fixture.duplicates, 'duplicates');
const boundaryDrops = asArray(fixture.boundary_drops, 'boundary_drops');
const serialization = asRecord(fixture.serialization, 'serialization');
const unmatched = asRecord(fixture.unmatched_trusted_event, 'unmatched_trusted_event');

describe('SupervisorEvent record (events.md §1)', () => {
  const sample = asRecord(fixture.sample_event, 'sample_event');
  const required = asStrings(fixture.event_record_required_fields, 'event_record_required_fields');
  const forbidden = asStrings(fixture.event_record_forbidden_fields, 'event_record_forbidden_fields');

  it.each(required)('carries %s', (field) => {
    expect(sample).toHaveProperty(field);
  });

  it.each(forbidden)('does not carry %s', (field) => {
    // Content is read through the bounded channel-context API, which already
    // labels it untrusted. Copying it here would put message text into a
    // second retention domain (GS-NFR-004, D026).
    expect(sample).not.toHaveProperty(field);
  });

  it('keeps content identity and delivery identity separate', () => {
    expect(sample.event_key).not.toBe(sample.delivery_event_id);
    expect(String(sample.event_key)).toContain(String(sample.message_ts));
  });

  it('keeps message_ts a verbatim string', () => {
    expect(typeof sample.message_ts).toBe('string');
    expect(String(sample.message_ts)).toMatch(/^\d+\.\d+$/);
  });
});

describe('admission order (events.md §2)', () => {
  const order = asStrings(fixture.admission_order, 'admission_order');

  it('persists before it routes, and routes before it evaluates', () => {
    expect(order[0]).toBe('persist_exact_message');
    expect(order.indexOf('resolve_actor_class')).toBeLessThan(order.indexOf('route_by_actor'));
    expect(order.indexOf('route_by_actor')).toBeLessThan(order.indexOf('evaluate'));
  });

  it('deduplicates and correlates before evaluating, so a dropped event costs no model call', () => {
    expect(order.indexOf('deduplicate')).toBeLessThan(order.indexOf('evaluate'));
    expect(order.indexOf('correlate')).toBeLessThan(order.indexOf('evaluate'));
    expect(order.indexOf('serialize')).toBeLessThan(order.indexOf('evaluate'));
    expect(order.at(-1)).toBe('evaluate');
  });

  it('checks the boundary before routing', () => {
    expect(order.indexOf('check_boundary')).toBeLessThan(order.indexOf('route_by_actor'));
  });
});

describe('evaluation eligibility (events.md §3, GS-FR-002, GS-FR-003)', () => {
  it.each(names(eligibility))('%s', (name) => {
    const testCase = byName(eligibility, name);
    const decision = evaluationEligibility(testCase as unknown as EligibilityInput);
    expect(decision.reaches_evaluation).toBe(testCase.expect_reaches_evaluation);
    expect(decision.subject_to_proactive_gate).toBe(testCase.expect_subject_to_proactive_gate);
  });

  it('never gates an active workflow thread on proactive relevance (GS-FR-002)', () => {
    const testCase = byName(eligibility, 'authorized_human_in_active_workflow_thread');
    const decision = evaluationEligibility(testCase as unknown as EligibilityInput);
    expect(decision.reaches_evaluation).toBe(true);
    expect(decision.subject_to_proactive_gate).toBe(false);
  });

  it('gates only unsolicited human traffic outside a workflow (GS-FR-003)', () => {
    const gated = eligibility.filter((testCase) => testCase.expect_subject_to_proactive_gate);
    expect(gated).toHaveLength(1);
    expect(gated[0]?.name).toBe('authorized_human_unaddressed_no_workflow');
  });

  it('never evaluates Gist, unknown automation, unauthorized humans, or system events', () => {
    for (const actor of [
      'gist_self',
      'unknown_automation',
      'unauthorized_human',
      'system',
    ] as ActorClass[]) {
      expect(
        evaluationEligibility({
          actor_class: actor,
          addressed_to_gist: true,
          in_active_workflow_thread: true,
        }).reaches_evaluation,
        `${actor} must not reach evaluation`,
      ).toBe(false);
    }
  });

  it('evaluates trusted bots without consulting the human response authorizer', () => {
    // GS-FR-017. The human authorizer denies every non-human sender by design;
    // reusing it here would force a bypass flag or a widened deny rule, and
    // both weaken the human gate to serve the bot path.
    for (const actor of ['kilo', 'linear'] as ActorClass[]) {
      expect(routingFor(actor).route).toBe('trusted_automation');
      expect(
        evaluationEligibility({
          actor_class: actor,
          addressed_to_gist: false,
          in_active_workflow_thread: true,
        }).reaches_evaluation,
      ).toBe(true);
    }
  });
});

describe('workflow correlation (events.md §4.2, GS-FR-018)', () => {
  it.each(names(correlationCases))('%s', (name) => {
    const testCase = byName(correlationCases, name);
    const workflow = asRecord(testCase.workflow, 'workflow') as unknown as {
      state: WorkflowState;
      expected_actor: ExpectedActor;
    };
    const failure = correlate(
      testCase.event as unknown as CorrelationEvent,
      binding,
      workflow,
    );
    expect(failure).toBe(testCase.expect_failure);
  });

  it('covers every one of the five checks failing independently', () => {
    const failures = correlationCases
      .map((testCase) => testCase.expect_failure)
      .filter((failure): failure is string => typeof failure === 'string');
    for (const check of [
      'wrong_workspace',
      'wrong_channel',
      'wrong_thread',
      'actor_mismatch',
      'state_rejects_actor',
    ]) {
      expect(failures, `no case exercises ${check}`).toContain(check);
    }
  });

  it('rejects the right bot in the right thread when another bot is expected', () => {
    // PRD acceptance scenario 6. Four of five checks pass and it still fails.
    const testCase = byName(correlationCases, 'linear_reply_while_kilo_expected');
    const event = testCase.event as unknown as CorrelationEvent;
    expect(event.workspace_id).toBe(binding.workspace_id);
    expect(event.channel_id).toBe(binding.channel_id);
    expect(event.thread_root_ts).toBe(binding.thread_root_ts);
    expect(correlate(event, binding, { state: 'waiting_bot', expected_actor: 'kilo' })).toBe(
      'actor_mismatch',
    );
  });

  it('never correlates a trusted event into a terminal workflow', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'timed_out'] as WorkflowState[]) {
      expect(
        correlate(
          {
            workspace_id: binding.workspace_id,
            channel_id: binding.channel_id,
            thread_root_ts: binding.thread_root_ts,
            actor_class: 'kilo',
          },
          binding,
          { state, expected_actor: 'kilo' },
        ),
        `${state} must reject a trusted event`,
      ).toBe('state_rejects_actor');
    }
  });

  it('never correlates an actor class that has no workflow role', () => {
    for (const actor of ['gist_self', 'unknown_automation', 'unauthorized_human'] as ActorClass[]) {
      expect(
        correlate(
          {
            workspace_id: binding.workspace_id,
            channel_id: binding.channel_id,
            thread_root_ts: binding.thread_root_ts,
            actor_class: actor,
          },
          binding,
          { state: 'waiting_bot', expected_actor: 'kilo' },
        ),
      ).toBe('actor_mismatch');
    }
  });
});

describe('unmatched trusted events (events.md §4.3, GS-FR-019)', () => {
  it('may notify and nothing else', () => {
    expect(unmatched.allowed_action_classes).toEqual(['no_action', 'reply_user']);
  });

  it.each(asStrings(unmatched.forbidden_effects, 'forbidden_effects'))(
    'cannot %s',
    (effect) => {
      expect(asStrings(unmatched.allowed_action_classes, 'allowed_action_classes')).not.toContain(
        effect,
      );
    },
  );
});

describe('wrong-boundary events (events.md §4.4, GS-NFR-001)', () => {
  it.each(names(boundaryDrops))('%s is a named reason class, not silence', (name) => {
    const testCase = byName(boundaryDrops, name);
    const reasonClasses = asStrings(fixture.reason_classes, 'reason_classes');
    expect(reasonClasses).toContain(testCase.expect_reason_class);
  });

  it('covers workspace, channel, external, and DM boundaries', () => {
    expect(names(boundaryDrops).slice().sort()).toEqual([
      'direct_message',
      'external_shared_channel',
      'unapproved_workspace',
      'unenrolled_channel',
    ]);
  });
});

describe('duplicates, retries, and echoes (events.md §6, GS-FR-020)', () => {
  it.each(names(duplicates))('%s', (name) => {
    const testCase = byName(duplicates, name);
    expect(
      duplicateReason({
        actor_class: testCase.actor_class as ActorClass | undefined,
        already_seen_delivery: Boolean(testCase.already_seen_delivery),
        already_supervised_event: Boolean(testCase.already_supervised_event),
      }),
    ).toBe(testCase.expect_reason_class);
  });

  it('produces zero actions for every suppressed case', () => {
    for (const testCase of duplicates) {
      const suppressed = testCase.expect_reason_class !== null;
      expect(testCase.expect_actions, `${String(testCase.name)} action count`).toBe(
        suppressed ? 0 : 1,
      );
    }
  });

  it('keys suppression on identity, never on content', () => {
    // Two genuinely distinct bot messages with identical text are two events.
    const testCase = byName(duplicates, 'distinct_message_identical_text');
    expect(
      duplicateReason({
        already_seen_delivery: false,
        already_supervised_event: false,
      }),
    ).toBeNull();
    expect(testCase.expect_actions).toBe(1);
  });

  it('suppresses a Gist echo before any duplicate check applies', () => {
    // The instruction Gist sent arrives back as an echo. It must never be able
    // to trigger the supervisor that wrote it (GS-FR-040).
    expect(
      duplicateReason({
        actor_class: 'gist_self',
        already_seen_delivery: false,
        already_supervised_event: false,
      }),
    ).toBe('gist_self');
  });
});

describe('serialization and cooldown separation (events.md §5, GS-FR-021, GS-FR-041)', () => {
  const arrivals = asArray(serialization.concurrent_arrivals, 'concurrent_arrivals');
  const cooldownCases = asArray(serialization.cooldown, 'cooldown');

  it('applies the first arrival and rechecks the second against current state', () => {
    const first = byName(arrivals, 'first_reply_transitions_to_running');
    const second = byName(arrivals, 'second_reply_rechecks_and_finds_cancelled');
    expect(first.expect_applied).toBe(true);
    // Acting on the state seen at arrival would be a stale-state write.
    expect(second.state_on_arrival).not.toBe(second.state_when_dequeued);
    expect(second.expect_applied).toBe(false);
    expect(second.expect_reason_class).toBe('terminal_workflow');
  });

  it.each(names(cooldownCases))('%s', (name) => {
    const testCase = byName(cooldownCases, name);
    expect(
      cooldownSuppresses({
        in_active_workflow: Boolean(testCase.in_active_workflow),
        cooldown_active: Boolean(testCase.cooldown_active),
      }),
    ).toBe(testCase.expect_suppressed);
  });

  it('never lets a commentary rate limiter drop a workflow continuation', () => {
    // The cooldown limits unsolicited commentary; workflow limits bound
    // supervised work. Confusing the two is a correctness bug, not caution.
    expect(cooldownSuppresses({ in_active_workflow: true, cooldown_active: true })).toBe(false);
  });
});

describe('observability (events.md §7, GS-NFR-004)', () => {
  const reasonClasses = asStrings(fixture.reason_classes, 'reason_classes');

  it('names a reason class for every drop path', () => {
    expect(reasonClasses.length).toBeGreaterThanOrEqual(15);
    expect(new Set(reasonClasses).size).toBe(reasonClasses.length);
  });

  it.each(reasonClasses)('%s is a content-free lowercase class', (reason) => {
    expect(reason).toMatch(/^[a-z][a-z_]*$/);
  });
});
