/**
 * compatibility.md — the measurement contract T802 must satisfy, the
 * correlation strategy each outcome permits, and the GO/NO-GO rules
 * (GS-FR-009, GS-FR-010, D029).
 *
 * T801 runs no live probe. These tests pin the shape of the answer and the
 * decision logic, so T802 fills in measurements rather than inventing a rule,
 * and so a NO-GO cannot be talked around.
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, asStrings, byName, loadFixture, names } from './helpers.js';
import {
  compatibilityDecision,
  correlationStrategyFor,
  dispatchAllowedByCompatibility,
  hasUnmeasuredField,
  looksLikeSlackId,
  phaseRecommendation,
  type BotCompatibilityMeasurement,
  type LogicalTarget,
} from './reference-rules.js';

const fixture = loadFixture('compatibility.v1.json');
const enums = asRecord(fixture.enums, 'enums');
const template = asRecord(fixture.unmeasured_template, 'unmeasured_template');
const strategyCases = asArray(fixture.strategy_cases, 'strategy_cases');
const decisionCases = asArray(fixture.decision_cases, 'decision_cases');
const phaseCases = asArray(fixture.phase_recommendation_cases, 'phase_recommendation_cases');
const blocked = asRecord(fixture.blocked_path, 'blocked_path');

describe('the measurement record (compatibility.md §2)', () => {
  const required = asStrings(fixture.required_fields, 'required_fields');
  const forbidden = asStrings(fixture.forbidden_fields, 'forbidden_fields');

  it.each(required)('requires %s', (field) => {
    expect(template).toHaveProperty(field);
  });

  it.each(forbidden)('forbids %s', (field) => {
    // Aliases, booleans, enums, counts, and day-precision dates only. Never a
    // real ID, a message, a prompt, a payload, or a trace (GS-NFR-004).
    expect(template).not.toHaveProperty(field);
    expect(required).not.toContain(field);
  });

  it('uses a synthetic alias rather than an identity', () => {
    expect(looksLikeSlackId(String(template.bot_alias))).toBe(false);
  });

  it('records the observation date at day precision', () => {
    expect(String(template.observed_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('closes every enum', () => {
    for (const key of [
      'tri',
      'reply_placement',
      'completion_signal',
      'duplicate_behavior',
      'latency_bucket',
      'blocking_reason',
      'decision',
      'phase_recommendation',
    ]) {
      const values = asStrings(enums[key], `enums.${key}`);
      expect(values.length, `enums.${key} is empty`).toBeGreaterThan(1);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('starts unmeasured and therefore blocked', () => {
    expect(hasUnmeasuredField(template as unknown as BotCompatibilityMeasurement)).toBe(true);
    expect(template.decision).toBe('NO_GO');
    expect(template.blocking_reason_class).toBe('unmeasured');
  });
});

describe('correlation strategy selection (compatibility.md §3, GS-FR-018)', () => {
  it.each(names(strategyCases))('%s', (name) => {
    const testCase = byName(strategyCases, name);
    expect(
      correlationStrategyFor(
        testCase as unknown as Pick<
          BotCompatibilityMeasurement,
          'reply_placement' | 'marker_preserved'
        >,
      ),
    ).toBe(testCase.expect_strategy);
  });

  it('covers every strategy including "none"', () => {
    const strategies = strategyCases.map((testCase) => testCase.expect_strategy);
    for (const strategy of [
      'thread_binding_with_marker',
      'thread_binding_only',
      'marker_required',
      'none',
    ]) {
      expect(strategies, `no case yields ${strategy}`).toContain(strategy);
    }
  });

  it('accepts the thread binding alone when replies land in the bound thread', () => {
    // A thread holds at most one non-terminal workflow (events.md §4.1), so
    // the binding is sufficient even without a marker echo.
    expect(
      correlationStrategyFor({ reply_placement: 'same_thread', marker_preserved: 'no' }),
    ).toBe('thread_binding_only');
  });

  it('requires the marker when replies land outside the bound thread', () => {
    // This is the row that would force an amendment to events.md §4.2 check 3.
    for (const placement of ['channel_root', 'new_thread'] as const) {
      expect(correlationStrategyFor({ reply_placement: placement, marker_preserved: 'yes' })).toBe(
        'marker_required',
      );
      expect(correlationStrategyFor({ reply_placement: placement, marker_preserved: 'no' })).toBe(
        'none',
      );
    }
  });

  it('treats an unmeasured placement as uncorrelatable rather than optimistic', () => {
    expect(correlationStrategyFor({ reply_placement: 'unknown', marker_preserved: 'yes' })).toBe(
      'none',
    );
  });
});

describe('GO / NO-GO rules (compatibility.md §4, GS-FR-010)', () => {
  it.each(names(decisionCases))('%s', (name) => {
    const testCase = byName(decisionCases, name);
    const decision = compatibilityDecision(
      testCase.measurement as unknown as BotCompatibilityMeasurement,
    );
    expect(decision.decision).toBe(testCase.expect_decision);
    expect(decision.blocking_reason_class).toBe(testCase.expect_blocking_reason_class);
  });

  it('covers every blocking reason', () => {
    const reasons = decisionCases.map((testCase) => testCase.expect_blocking_reason_class);
    for (const reason of asStrings(enums.blocking_reason, 'enums.blocking_reason')) {
      expect(reasons, `no case yields ${reason}`).toContain(reason);
    }
  });

  it('blocks an unmeasured field even when everything measured passes', () => {
    // Rule 6. An unmeasured field is not a neutral gap: the point of the
    // spike is that the protocol stops assuming.
    const testCase = byName(decisionCases, 'one_unmeasured_field_blocks');
    const measurement = testCase.measurement as unknown as BotCompatibilityMeasurement;
    expect(measurement.accepts_bot_authored).toBe('yes');
    expect(correlationStrategyFor(measurement)).not.toBe('none');
    expect(compatibilityDecision(measurement).blocking_reason_class).toBe('unmeasured');
  });

  it('blocks a bot that performs a second action on a repeated instruction', () => {
    // Gist cannot enforce one-event/one-action at the far end.
    const testCase = byName(decisionCases, 'duplicate_instruction_causes_a_second_action');
    expect(compatibilityDecision(testCase.measurement as unknown as BotCompatibilityMeasurement))
      .toEqual({ decision: 'NO_GO', blocking_reason_class: 'duplicate_side_effects' });
  });

  it('blocks a bot whose reply identity is unstable', () => {
    // Exact-ID trust cannot be relied on if the identity moves.
    const testCase = byName(decisionCases, 'unstable_reply_identity');
    expect(
      compatibilityDecision(testCase.measurement as unknown as BotCompatibilityMeasurement)
        .blocking_reason_class,
    ).toBe('unstable_identity');
  });

  it('blocks when success and failure are indistinguishable', () => {
    for (const name of ['no_distinguishable_outcome', 'no_completion_signal']) {
      const testCase = byName(decisionCases, name);
      expect(
        compatibilityDecision(testCase.measurement as unknown as BotCompatibilityMeasurement)
          .blocking_reason_class,
        name,
      ).toBe('no_outcome_signal');
    }
  });

  it('leaves the marker-required path GO for T803 to rule on', () => {
    // Correlation is possible, so it is not a NO_GO here; §5 records that the
    // clause it depends on may still move.
    const testCase = byName(decisionCases, 'marker_required_path_is_still_go_pending_t803_review');
    const measurement = testCase.measurement as unknown as BotCompatibilityMeasurement;
    expect(correlationStrategyFor(measurement)).toBe('marker_required');
    expect(compatibilityDecision(measurement).decision).toBe('GO');
  });
});

describe('phase recommendation (compatibility.md §4)', () => {
  it.each(names(phaseCases))('%s', (name) => {
    const testCase = byName(phaseCases, name);
    expect(
      phaseRecommendation(asStrings(testCase.decisions, 'decisions') as ('GO' | 'NO_GO')[]),
    ).toBe(testCase.expect);
  });

  it('requires both bots for a plain GO', () => {
    expect(phaseRecommendation(['GO', 'GO'])).toBe('GO');
    expect(phaseRecommendation(['GO', 'NO_GO'])).toBe('PARTIAL');
    expect(phaseRecommendation(['NO_GO', 'NO_GO'])).toBe('NO_GO');
  });

  it('does not let PARTIAL unblock P09 by itself', () => {
    // D029 — partial compatibility may support only the passing path, after an
    // explicit scope amendment.
    expect(blocked.expect_partial_unblocks_p09_alone).toBe(false);
  });
});

describe('a blocked path blocks only itself (compatibility.md §4, D029)', () => {
  const blockedTarget = blocked.blocked_target as LogicalTarget;
  const passingTarget = blocked.passing_target as LogicalTarget;

  it('refuses dispatch to the blocked target with compatibility_blocked', () => {
    const result = dispatchAllowedByCompatibility(blockedTarget, [blockedTarget]);
    const expected = asRecord(blocked.expect_dispatch_to_blocked_target, 'expect_blocked');
    expect(result.allowed).toBe(expected.allowed);
    expect(result.failure_class).toBe(expected.failure_class);
    expect(expected.workflow_state).toBe('waiting_human');
  });

  it('leaves the passing target unaffected', () => {
    const result = dispatchAllowedByCompatibility(passingTarget, [blockedTarget]);
    expect(result.allowed).toBe(true);
    expect(result.failure_class).toBeNull();
  });

  it.each(asStrings(blocked.forbidden_fallbacks, 'forbidden_fallbacks'))(
    '%s is not an available fallback',
    (fallback) => {
      // There is no silent direct-connector fallback and no inferred success.
      // Adding one requires a new accepted decision (D023, D029).
      expect(fallback.length).toBeGreaterThan(0);
      expect(dispatchAllowedByCompatibility(blockedTarget, [blockedTarget]).allowed).toBe(false);
    },
  );

  it('names connectors, transports, identity substitution, and inference as forbidden', () => {
    const fallbacks = asStrings(blocked.forbidden_fallbacks, 'forbidden_fallbacks');
    for (const fragment of [
      'connector',
      'alternative_transport',
      'identity_substitution',
      'inferred_success',
    ]) {
      expect(
        fallbacks.some((fallback) => fallback.includes(fragment)),
        `no forbidden fallback covers ${fragment}`,
      ).toBe(true);
    }
  });
});

describe('clauses conditional on measurement (compatibility.md §5)', () => {
  const conditional = asArray(fixture.conditional_clauses, 'conditional_clauses');

  it('names the clauses T803 may have to amend', () => {
    const clauses = conditional.map((entry) => entry.clause);
    for (const clause of [
      'events.md §4.2',
      'actions.md §5.1',
      'workflow-state.md §3.1',
      'dispatch.md §5',
    ]) {
      expect(clauses, `${clause} is not listed as conditional`).toContain(clause);
    }
  });

  it('ties each conditional clause to a measured field', () => {
    for (const entry of conditional) {
      expect(typeof entry.depends_on).toBe('string');
      expect(String(entry.depends_on).length).toBeGreaterThan(0);
    }
  });
});
