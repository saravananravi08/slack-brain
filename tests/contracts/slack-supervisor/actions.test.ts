/**
 * actions.md — the action union, logical targets, destination mapping, and the
 * instruction envelope (GS-FR-022…026, GS-FR-027, GS-FR-031, GS-FR-037,
 * GS-INV-10).
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadFixture, names } from './helpers.js';
import {
  ACTION_CLASSES,
  EXTERNALLY_VISIBLE_ACTIONS,
  FAILURE_OUTCOME_CLASSES,
  MESSAGE_CLASSES,
  MISSING_FIELDS,
  MODEL_INSTRUCTION_FIELDS,
  NO_ACTION_REASONS,
  RUNTIME_INSTRUCTION_FIELDS,
  WAIT_REASON_CLASSES,
  WORK_CLASSES,
  deriveResponseDeadlineMs,
  expectedSignalsFor,
  actionAllowedInState,
  containsSlackIdentifier,
  isAllowedWorkClass,
  isExternallyVisible,
  isLogicalTarget,
  resolveContextRef,
  resolveDestination,
  requiredActionFields,
  validateAction,
  workflowMarker,
  type ActionClass,
  type DestinationConfig,
  type LogicalTarget,
  type WorkflowBinding,
  type WorkflowState,
} from './reference-rules.js';

const fixture = loadFixture('actions.v1.json');
const valid = asArray(fixture.valid_actions, 'valid_actions');
const invalid = asArray(fixture.invalid_actions, 'invalid_actions');
const workClassCases = asArray(fixture.work_class_rejections, 'work_class_rejections');
const envelope = asRecord(fixture.instruction_envelope, 'instruction_envelope');
const deadline = asRecord(envelope.response_deadline, 'response_deadline');
const destination = asRecord(fixture.destination_mapping, 'destination_mapping');
const authority = asArray(fixture.action_authority, 'action_authority');
const reporting = asRecord(fixture.progress_reporting, 'progress_reporting');

describe('the action union (actions.md §1, GS-FR-022)', () => {
  it('has exactly ten members', () => {
    expect(asStrings(fixture.action_classes, 'action_classes')).toEqual([...ACTION_CLASSES]);
    expect(ACTION_CLASSES).toHaveLength(10);
  });

  it('splits externally visible from internal with no overlap and no gap', () => {
    const visible = asStrings(fixture.externally_visible, 'externally_visible');
    const internal = asStrings(fixture.internal, 'internal');
    expect(visible).toEqual([...EXTERNALLY_VISIBLE_ACTIONS]);
    expect([...visible, ...internal].slice().sort()).toEqual([...ACTION_CLASSES].sort());
    expect(visible.filter((entry) => internal.includes(entry))).toEqual([]);
  });

  it.each(ACTION_CLASSES)('%s is classified as visible or internal', (actionClass) => {
    expect(typeof isExternallyVisible(actionClass)).toBe('boolean');
  });

  it('gives a terminal outcome no extra Slack message', () => {
    // complete/fail/cancel are internal: reporting the outcome is the one
    // visible action for that event, not a bonus on top of it.
    for (const actionClass of ['complete', 'fail', 'cancel'] as ActionClass[]) {
      expect(isExternallyVisible(actionClass)).toBe(false);
    }
  });
});

describe('schema validation', () => {
  it.each(names(valid))('%s validates', (name) => {
    const testCase = byName(valid, name);
    expect(validateAction(asRecord(testCase.action, 'action'))).toBeNull();
  });

  it.each(names(invalid))('%s is rejected, not repaired', (name) => {
    const testCase = byName(invalid, name);
    expect(validateAction(asRecord(testCase.action, 'action'))).toBe(testCase.expect_reason);
  });

  it('covers every security-specific rejection reason', () => {
    const reasons = invalid.map((testCase) => testCase.expect_reason);
    for (const reason of [
      'unknown_action_class',
      'runtime_controlled_field_present',
      'slack_identifier_present',
      'destination_field_present',
      'missing_workflow_id',
      'unknown_logical_target',
      'work_class_not_allowed_for_target',
    ]) {
      expect(reasons, `no case exercises ${reason}`).toContain(reason);
    }
  });

  it('pins every closed action enum to the fixture', () => {
    const schema = asRecord(fixture.action_schema, 'action_schema');
    expect(asStrings(schema.no_action_reasons, 'no_action_reasons')).toEqual([...NO_ACTION_REASONS]);
    expect(asStrings(schema.message_classes, 'message_classes')).toEqual([...MESSAGE_CLASSES]);
    expect(asStrings(schema.missing_fields, 'missing_fields')).toEqual([...MISSING_FIELDS]);
    expect(asStrings(schema.wait_reason_classes, 'wait_reason_classes')).toEqual([...WAIT_REASON_CLASSES]);
    expect(asStrings(schema.failure_outcome_classes, 'failure_outcome_classes')).toEqual([
      ...FAILURE_OUTCOME_CLASSES,
    ]);
  });

  it.each(valid.map((entry) => String(entry.name)))('%s rejects every missing required field', (name) => {
    const source = asRecord(byName(valid, name).action, 'action');
    const actionClass = source.action_class as ActionClass;
    const required = requiredActionFields(actionClass, actionClass === 'reply_user' && 'workflow_id' in source);
    for (const field of required) {
      const candidate = { ...source };
      delete candidate[field];
      expect(validateAction(candidate), `${name} accepted without ${field}`).not.toBeNull();
    }
  });

  it.each(valid.map((entry) => String(entry.name)))('%s rejects malformed required fields', (name) => {
    const source = asRecord(byName(valid, name).action, 'action');
    const actionClass = source.action_class as ActionClass;
    const required = requiredActionFields(actionClass, actionClass === 'reply_user' && 'workflow_id' in source);
    for (const field of required) {
      const malformed: unknown =
        field === 'action_class' ? 'unknown_variant' :
        field === 'workflow_id' ? '' :
        field === 'expected_version' ? 0 :
        field === 'logical_target' ? 'unknown_target' :
        field === 'instruction' ? null : 7;
      expect(validateAction({ ...source, [field]: malformed }), `${name} accepted malformed ${field}`)
        .not.toBeNull();
    }
  });

  it.each(valid.map((entry) => String(entry.name)))('%s rejects unknown top-level fields', (name) => {
    const source = asRecord(byName(valid, name).action, 'action');
    expect(validateAction({ ...source, invented_field: 'synthetic' })).toBe('unknown_field');
  });

  it.each(['dispatch_bot_to_kilo', 'follow_up_bot_to_linear'])(
    '%s requires a complete, closed ModelInstruction',
    (name) => {
      const source = asRecord(byName(valid, name).action, 'action');
      const instruction = asRecord(source.instruction, 'instruction');
      for (const field of MODEL_INSTRUCTION_FIELDS) {
        const candidateInstruction = { ...instruction };
        delete candidateInstruction[field];
        expect(validateAction({ ...source, instruction: candidateInstruction }), `missing ${field}`)
          .toBe('missing_required_field');

        const malformed = field === 'context_refs' ? 'ctx_1' : 7;
        expect(
          validateAction({ ...source, instruction: { ...instruction, [field]: malformed } }),
          `malformed ${field}`,
        ).not.toBeNull();
      }
      expect(validateAction({ ...source, instruction: { ...instruction, invented_field: true } }))
        .toBe('unknown_field');
    },
  );

  it('requires non-empty IDs/strings and positive expected_version', () => {
    const source = asRecord(byName(valid, 'dispatch_bot_to_kilo').action, 'action');
    const instruction = asRecord(source.instruction, 'instruction');
    expect(validateAction({ ...source, workflow_id: ' ' })).toBe('invalid_field_value');
    expect(validateAction({ ...source, expected_version: 0 })).toBe('invalid_field_value');
    expect(validateAction({ ...source, expected_version: 1.5 })).toBe('invalid_field_value');
    for (const field of ['objective', 'scope', 'acceptance']) {
      expect(validateAction({ ...source, instruction: { ...instruction, [field]: ' ' } }))
        .toBe('invalid_field_value');
    }
  });

  it('requires a workflow only where a workflow exists to require', () => {
    expect(validateAction({ action_class: 'no_action', reason_class: 'not_relevant' })).toBeNull();
    expect(validateAction({
      action_class: 'wait',
      expected_version: 1,
      wait_reason_class: 'bot_turn_outstanding',
    })).toBe('missing_workflow_id');
  });
});

describe('the model never controls a Slack identifier (GS-INV-10, GS-FR-023)', () => {
  it('rejects an identifier in a top-level field', () => {
    expect(validateAction(asRecord(byName(invalid, 'dispatch_naming_a_slack_channel').action, 'a')))
      .toBe('slack_identifier_present');
  });

  it('rejects an identifier buried in instruction text', () => {
    // The scan is recursive on purpose: a destination smuggled into prose is
    // the same violation as a destination in a field.
    expect(
      validateAction(asRecord(byName(invalid, 'instruction_text_embedding_a_bot_id').action, 'a')),
    ).toBe('slack_identifier_present');
    expect(
      validateAction(asRecord(byName(invalid, 'instruction_scope_embedding_a_user_id').action, 'a')),
    ).toBe('slack_identifier_present');
  });

  it('rejects a raw message key offered instead of a context handle', () => {
    // A MessageKey is workspace_id/channel_id/message_ts, so accepting one
    // would carve an exception into an invariant that has to be absolute.
    expect(
      validateAction(
        asRecord(
          byName(invalid, 'instruction_supplying_a_raw_message_key_instead_of_a_handle').action,
          'a',
        ),
      ),
    ).toBe('slack_identifier_present');
  });

  it('finds an identifier at any depth', () => {
    expect(containsSlackIdentifier({ a: [{ b: { c: 'C0SUPVTESTB' } }] })).toBe(true);
    expect(containsSlackIdentifier({ a: [{ b: { c: 'ctx_1' } }] })).toBe(false);
  });

  it('carries no Slack identifier in any valid action', () => {
    for (const testCase of valid) {
      expect(
        containsSlackIdentifier(testCase.action),
        `${String(testCase.name)} leaks an identifier`,
      ).toBe(false);
    }
  });
});

describe('logical targets and work classes (actions.md §3, §4)', () => {
  it('offers exactly two logical targets', () => {
    expect(asStrings(fixture.logical_targets, 'logical_targets')).toEqual(['kilo', 'linear']);
    expect(isLogicalTarget('github')).toBe(false);
  });

  it('matches the frozen work-class union per target', () => {
    const declared = asRecord(fixture.work_classes, 'work_classes');
    expect(asStrings(declared.kilo, 'work_classes.kilo')).toEqual([...WORK_CLASSES.kilo]);
    expect(asStrings(declared.linear, 'work_classes.linear')).toEqual([...WORK_CLASSES.linear]);
  });

  it.each(names(workClassCases))('%s', (name) => {
    const testCase = byName(workClassCases, name);
    expect(
      isAllowedWorkClass(String(testCase.logical_target), String(testCase.work_class)),
    ).toBe(testCase.expect_valid);
  });

  it('has no work class for merging, releasing, or deleting', () => {
    // Those are gated human decisions (approvals.md §2.1), not instructions.
    for (const target of ['kilo', 'linear'] as LogicalTarget[]) {
      for (const forbidden of ['merge', 'release', 'delete', 'destroy']) {
        expect(WORK_CLASSES[target], `${target} must not offer ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });
});

describe('destination mapping (actions.md §3)', () => {
  const binding = destination.binding as unknown as WorkflowBinding;
  const config = destination.config as unknown as DestinationConfig;
  const cases = asArray(destination.cases, 'destination_mapping.cases');

  it.each(names(cases))('%s', (name) => {
    const testCase = byName(cases, name);
    const resolved = resolveDestination(
      testCase.logical_target as LogicalTarget,
      testCase.config as unknown as DestinationConfig,
      binding,
    );
    expect(resolved?.target_identity ?? null).toEqual(testCase.expect_identity);
    if (resolved !== null) {
      expect(resolved.channel_id).toBe(testCase.expect_channel_id);
      expect(resolved.thread_root_ts).toBe(testCase.expect_thread_root_ts);
    } else {
      expect(testCase.expect_failure_class).toBe('destination_unresolved');
    }
  });

  it('supports bot-only, app-only, both, and neither without identity substitution', () => {
    expect(cases.map((entry) => entry.expect_identity === null ? 'neither' : asRecord(entry.expect_identity, 'identity').identity_kind))
      .toEqual(['bot', 'app', 'bot_and_app', 'neither']);
  });

  it('derives the destination from the binding, never from the action', () => {
    for (const target of ['kilo', 'linear'] as LogicalTarget[]) {
      const resolved = resolveDestination(target, config, binding);
      expect(resolved?.channel_id).toBe(binding.channel_id);
      expect(resolved?.thread_root_ts).toBe(binding.thread_root_ts);
    }
  });

  it('checks authorization, state, approval, and compatibility before it maps', () => {
    const order = asStrings(destination.check_order, 'check_order');
    expect(order.indexOf('actor_permits_action')).toBeLessThan(order.indexOf('map_logical_target'));
    expect(order.indexOf('transition_legal_and_cas')).toBeLessThan(
      order.indexOf('map_logical_target'),
    );
    expect(order.indexOf('approval_valid_if_gated')).toBeLessThan(
      order.indexOf('map_logical_target'),
    );
    expect(order.indexOf('compatibility_go')).toBeLessThan(order.indexOf('map_logical_target'));
    expect(order.at(-1)).toBe('claim_dispatch_checkpoint');
  });
});

describe('the instruction envelope (actions.md §5, GS-FR-025)', () => {
  const modelFields = asStrings(envelope.model_fields, 'model_fields');
  const runtimeFields = asStrings(envelope.runtime_fields, 'runtime_fields');
  const forbidden = asStrings(envelope.forbidden_content_classes, 'forbidden_content_classes');
  const scoping = asRecord(envelope.context_ref_scoping, 'context_ref_scoping');
  const marker = asRecord(envelope.marker, 'marker');
  const composed = asRecord(envelope.composed_sample, 'composed_sample');

  it('splits into a model half and a runtime half with no overlap', () => {
    expect(modelFields).toEqual([...MODEL_INSTRUCTION_FIELDS]);
    expect(runtimeFields.filter((field) => modelFields.includes(field))).toEqual([]);
    for (const field of runtimeFields) {
      expect(RUNTIME_INSTRUCTION_FIELDS, `${field} is not a declared runtime field`).toContain(
        field,
      );
    }
  });

  it('composes an envelope carrying everything GS-FR-025 requires', () => {
    // The requirement is about the rendered instruction; only the model's
    // contribution is narrower.
    for (const field of [...modelFields, ...runtimeFields]) {
      expect(composed, `composed envelope is missing ${field}`).toHaveProperty(field);
    }
  });

  it.each(forbidden)('excludes %s', (contentClass) => {
    expect([...modelFields, ...runtimeFields]).not.toContain(contentClass);
  });

  it('lets the model supply only the work, never the protocol', () => {
    const instruction = asRecord(
      asRecord(byName(valid, 'dispatch_bot_to_kilo').action, 'action').instruction,
      'instruction',
    );
    for (const field of modelFields) {
      expect(instruction, `sample instruction is missing ${field}`).toHaveProperty(field);
    }
    for (const field of runtimeFields) {
      expect(instruction, `sample model instruction leaks ${field}`).not.toHaveProperty(field);
    }
  });

  it.each(RUNTIME_INSTRUCTION_FIELDS)('rejects a model action carrying %s', (field) => {
    // Rejected, not merged and not silently dropped: a model that tried once
    // will try again, and a silent drop makes that invisible.
    expect(
      validateAction({
        action_class: 'dispatch_bot',
        workflow_id: 'wf_supv_0001',
        logical_target: 'kilo',
        instruction: { work_class: 'implement', [field]: 'anything at all' },
      }),
    ).toBe('runtime_controlled_field_present');
  });

  describe('context handles', () => {
    const handleTable = asRecord(scoping.handle_table, 'handle_table') as Record<string, string>;
    const binding = scoping.binding as unknown as WorkflowBinding;
    const cases = asArray(scoping.cases, 'context_ref_scoping.cases');

    it.each(names(cases))('%s', (name) => {
      const testCase = byName(cases, name);
      const resolved = resolveContextRef(String(testCase.context_ref), handleTable, binding);
      expect(resolved !== null).toBe(testCase.expect_kept);
    });

    it('drops a handle it did not issue rather than erroring', () => {
      // A model asking for context it should not have gets nothing, rather
      // than a rejection it can iterate against.
      expect(resolveContextRef('ctx_not_issued', handleTable, binding)).toBeNull();
    });

    it('drops a stale handle that resolves outside the binding', () => {
      for (const handle of ['ctx_stale_channel', 'ctx_stale_workspace', 'ctx_stale_unenrolled']) {
        expect(resolveContextRef(handle, handleTable, binding), handle).toBeNull();
      }
    });
  });

  describe('response deadline (actions.md §5.2)', () => {
    const limits = deadline.limits as { inactivity_timeout_ms: number; absolute_lifetime_ms: number };
    const cases = asArray(deadline.cases, 'response_deadline.cases');

    it.each(names(cases))('%s', (name) => {
      const testCase = byName(cases, name);
      expect(
        deriveResponseDeadlineMs(limits, String(deadline.created_at), String(testCase.now)),
      ).toBe(testCase.expect_deadline_ms);
    });

    it('never exceeds the inactivity timeout', () => {
      // A model-chosen deadline would have been exactly the timeout extension
      // workflow-state.md §7.4 forbids, arriving through the one field nobody
      // was checking.
      for (const testCase of cases) {
        const value = deriveResponseDeadlineMs(
          limits,
          String(deadline.created_at),
          String(testCase.now),
        );
        if (value !== null) expect(value).toBeLessThanOrEqual(limits.inactivity_timeout_ms);
      }
      expect(deadline.expect_never_exceeds_inactivity_timeout).toBe(true);
    });

    it('never outlives the workflow', () => {
      expect(
        deriveResponseDeadlineMs(limits, '2026-09-01T00:00:00.000Z', '2026-09-01T23:45:00.000Z'),
      ).toBe(900_000);
      expect(deadline.expect_never_outlives_the_workflow).toBe(true);
    });

    it('returns null rather than a non-positive window, so nothing is dispatched', () => {
      expect(
        deriveResponseDeadlineMs(limits, '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
      ).toBeNull();
      expect(deadline.expect_null_means_time_out_instead_of_dispatch).toBe(true);
    });

    it('is unreachable from a model action', () => {
      expect(RUNTIME_INSTRUCTION_FIELDS).toContain('response_deadline_ms');
      expect(
        validateAction({
          action_class: 'dispatch_bot',
          workflow_id: 'wf_supv_0001',
          logical_target: 'kilo',
          instruction: { work_class: 'implement', response_deadline_ms: 604_800_000 },
        }),
      ).toBe('runtime_controlled_field_present');
    });
  });

  describe('expected signals (actions.md §5.2)', () => {
    const cases = asArray(envelope.expected_signals, 'expected_signals');

    it.each(names(cases))('%s', (name) => {
      const testCase = byName(cases, name);
      expect(expectedSignalsFor(String(testCase.work_class))).toEqual(testCase.expect);
    });

    it('adds review findings only for a review', () => {
      expect(expectedSignalsFor('review')).toContain('review_findings');
      expect(expectedSignalsFor('implement')).not.toContain('review_findings');
    });
  });

  describe('workflow marker (actions.md §5.1)', () => {
    it('is deterministic and runtime-generated', () => {
      expect(
        workflowMarker(String(marker.workflow_id), Number(marker.action_version)),
      ).toBe(marker.expect_marker);
      expect(marker.runtime_generated).toBe(true);
      expect(marker.model_supplied).toBe(false);
    });

    it('is corroborating evidence, never identity or authority', () => {
      // Marker text travels through content, and content is attacker-influenced.
      expect(marker.is_sufficient_identity).toBe(false);
      expect(marker.is_sufficient_authority).toBe(false);
    });

    it('changes with the action version, so a reply matches one version', () => {
      const first = workflowMarker('wf_supv_0001', 1);
      const second = workflowMarker('wf_supv_0001', 2);
      expect(first).not.toBe(second);
    });

    it('contains no Slack identifier', () => {
      expect(containsSlackIdentifier(workflowMarker('wf_supv_0001', 1))).toBe(false);
    });
  });
});

describe('action authority by state (actions.md §1.2)', () => {
  it.each(names(authority))('%s', (name) => {
    const testCase = byName(authority, name);
    expect(
      actionAllowedInState(
        testCase.action_class as ActionClass,
        testCase.state as WorkflowState,
        Boolean(testCase.in_flight),
      ),
    ).toBe(testCase.expect_allowed);
  });

  it('permits dispatch only from ready, and never with an action in flight', () => {
    const states: WorkflowState[] = [
      'draft',
      'clarifying',
      'ready',
      'dispatched',
      'running',
      'waiting_human',
      'waiting_bot',
      'reviewing',
      'changes_requested',
    ];
    for (const state of states) {
      expect(actionAllowedInState('dispatch_bot', state, false)).toBe(state === 'ready');
      expect(actionAllowedInState('dispatch_bot', state, true)).toBe(false);
    }
  });

  it('permits no action at all in a terminal state', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'timed_out'] as WorkflowState[]) {
      for (const actionClass of ACTION_CLASSES) {
        expect(actionAllowedInState(actionClass, state, false), `${actionClass}/${state}`).toBe(
          false,
        );
      }
    }
  });
});

describe('progress reporting (actions.md §7, GS-FR-037)', () => {
  it('reports at meaningful transitions only', () => {
    const reportAt = asStrings(reporting.report_at, 'report_at');
    expect(reportAt).toContain('dispatch_confirmed');
    expect(reportAt).toContain('terminal_outcome');
  });

  it('does not narrate every bot status or internal step', () => {
    const doNotReport = asStrings(reporting.do_not_report, 'do_not_report');
    expect(doNotReport).toContain('every_bot_status_line');
    expect(doNotReport).toContain('internal_reasoning_step');
    expect(doNotReport).toContain('repeated_equivalent_status');
  });

  it('makes narration structurally bounded rather than a matter of prompt discipline', () => {
    // A report is a reply_user action, so it competes for the single visible
    // action this event is allowed.
    expect(isExternallyVisible('reply_user')).toBe(true);
  });
});
