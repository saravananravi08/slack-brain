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
  STABLE_TEXT_MIN_SAMPLES,
  compatibilityCountFailure,
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
const countCases = asArray(fixture.count_validation_cases, 'count_validation_cases');
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
      'outcome_distinguishability',
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

describe('compatibility count schema (compatibility.md §2)', () => {
  it.each(names(countCases))('%s', (name) => {
    const testCase = byName(countCases, name);
    expect(compatibilityCountFailure({
      sample_count: Number(testCase.sample_count),
      observed_success_count: Number(testCase.observed_success_count),
      observed_failure_count: Number(testCase.observed_failure_count),
    })).toBe(testCase.expect_failure);
  });

  it('rejects malformed counts before compatibility policy', () => {
    const source = byName(decisionCases, 'fully_measured_and_compatible_is_go')
      .measurement as unknown as BotCompatibilityMeasurement;
    for (const testCase of countCases.filter((entry) => entry.expect_failure !== null)) {
      const decision = compatibilityDecision({
        ...source,
        sample_count: Number(testCase.sample_count),
        observed_success_count: Number(testCase.observed_success_count),
        observed_failure_count: Number(testCase.observed_failure_count),
      });
      expect(decision, String(testCase.name)).toEqual({
        decision: 'NO_GO',
        blocking_reason_class: 'invalid_sample_counts',
      });
    }
  });

  it('is mutation-sensitive to fractional, unsafe, overflow, and inconsistent totals', () => {
    for (const name of [
      'sample_count_fractional',
      'sample_count_unsafe',
      'outcome_count_overflow',
      'counts_exceed_total',
    ]) {
      expect(byName(countCases, name).expect_failure, name).not.toBeNull();
    }
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
    for (const name of ['outcomes_are_unreliable', 'no_completion_signal']) {
      const testCase = byName(decisionCases, name);
      expect(
        compatibilityDecision(testCase.measurement as unknown as BotCompatibilityMeasurement)
          .blocking_reason_class,
        name,
      ).toBe('no_outcome_signal');
    }
  });

  it('accepts a bot that reports outcomes reliably in prose', () => {
    // The defect this fixes: requiring a *structural* success/failure signal
    // would have blocked the Slack-only path over a formatting preference,
    // which is neither a PRD requirement nor consistent with D024/GS-FR-028.
    const testCase = byName(decisionCases, 'stable_textual_outcomes_are_go');
    const measurement = testCase.measurement as unknown as BotCompatibilityMeasurement;
    expect(measurement.outcome_distinguishability).toBe('stable_text');
    expect(compatibilityDecision(measurement)).toEqual({
      decision: 'GO',
      blocking_reason_class: null,
    });
  });

  it('requires at least one observed success and one observed failure for every GO', () => {
    for (const testCase of decisionCases.filter((entry) => entry.expect_decision === 'GO')) {
      const measurement = testCase.measurement as unknown as BotCompatibilityMeasurement;
      expect(measurement.observed_success_count, String(testCase.name)).toBeGreaterThanOrEqual(1);
      expect(measurement.observed_failure_count, String(testCase.name)).toBeGreaterThanOrEqual(1);
      expect(measurement.sample_count).toBeGreaterThanOrEqual(
        measurement.observed_success_count + measurement.observed_failure_count,
      );
    }
  });

  it('blocks structured evidence missing either observed outcome', () => {
    const testCase = byName(decisionCases, 'structured_missing_failure_sample_is_blocked');
    expect(compatibilityDecision(testCase.measurement as unknown as BotCompatibilityMeasurement))
      .toEqual({ decision: 'NO_GO', blocking_reason_class: 'insufficient_samples' });
  });

  it('holds stable_text to both outcome samples and the repeatable three-sample floor', () => {
    for (const name of [
      'stable_text_claimed_from_too_few_samples',
      'stable_text_missing_success_sample_is_blocked',
    ]) {
      const measurement = byName(decisionCases, name).measurement as unknown as BotCompatibilityMeasurement;
      expect(compatibilityDecision(measurement).blocking_reason_class).toBe('insufficient_samples');
    }
    expect(STABLE_TEXT_MIN_SAMPLES).toBe(3);
  });

  it('requires exactly the two outcome samples as the structured minimum', () => {
    const testCase = byName(decisionCases, 'structured_outcomes_need_no_sample_floor');
    const measurement = testCase.measurement as unknown as BotCompatibilityMeasurement;
    expect(measurement.sample_count).toBe(2);
    expect(measurement.observed_success_count).toBe(1);
    expect(measurement.observed_failure_count).toBe(1);
    expect(compatibilityDecision(measurement).decision).toBe('GO');
  });

  it('is mutation-sensitive to either outcome count dropping to zero', () => {
    const source = byName(decisionCases, 'fully_measured_and_compatible_is_go')
      .measurement as unknown as BotCompatibilityMeasurement;
    expect(compatibilityDecision({ ...source, observed_success_count: 0 }).decision).toBe('NO_GO');
    expect(compatibilityDecision({ ...source, observed_failure_count: 0 }).decision).toBe('NO_GO');
  });

  it('still blocks when outcomes cannot be told apart at all', () => {
    const testCase = byName(decisionCases, 'outcomes_are_unreliable');
    const measurement = testCase.measurement as unknown as BotCompatibilityMeasurement;
    expect(measurement.outcome_distinguishability).toBe('unreliable');
    expect(compatibilityDecision(measurement).blocking_reason_class).toBe('no_outcome_signal');
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

describe('prose is evidence, never authority (compatibility.md §2.2, GS-INV-07)', () => {
  const prose = asRecord(fixture.prose_is_not_authority, 'prose_is_not_authority');

  it('applies to the loosened value specifically', () => {
    expect(prose.outcome_distinguishability).toBe('stable_text');
  });

  it.each(asStrings(prose.claim_classes, 'claim_classes'))('%s changes nothing', (claim) => {
    // Measuring that a bot's wording is consistent tells Gist how to read a
    // reply. It does not make the reply true, or make it an instruction.
    expect(prose.expect_effect).toBe('none');
    expect(claim.length).toBeGreaterThan(0);
  });

  it('still routes a textual completion signal through every gate', () => {
    expect(asStrings(prose.expect_still_requires, 'expect_still_requires')).toEqual([
      'full_binding_correlation',
      'legal_transition_and_compare_and_set',
      'version_bound_human_approval_for_gated_actions',
    ]);
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
      'events.md §4.2 check 5 reply classification',
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
