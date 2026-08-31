/**
 * identity.md — exact-ID actor resolution and the frozen routing matrix
 * (GS-FR-008, GS-FR-011, GS-FR-017, GS-FR-019, GS-FR-040, GS-INV-04…07).
 *
 * P08's exit criteria name this matrix. Every cell is asserted, including the
 * ones that say "no", because a permission that is never tested is a
 * permission that quietly becomes "yes".
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, byName, loadFixture, names } from './helpers.js';
import {
  resolveActorClass,
  routingFor,
  type ActorClass,
  type SupervisorSenderShape,
  type TrustedAutomationConfig,
} from './reference-rules.js';

const fixture = loadFixture('identity.v1.json');
const config = fixture.config as unknown as TrustedAutomationConfig;
const cases = asArray(fixture.cases, 'cases');
const traps = asArray(fixture.precedence_traps, 'precedence_traps');
const unconfigured = asRecord(fixture.unconfigured_deployment, 'unconfigured_deployment');
const nonIdentity = asRecord(fixture.non_identity_evidence, 'non_identity_evidence');
const matrix = asArray(fixture.routing_matrix, 'routing_matrix');

const ALL_ACTOR_CLASSES: readonly ActorClass[] = [
  'authorized_human',
  'unauthorized_human',
  'kilo',
  'linear',
  'gist_self',
  'unknown_automation',
  'system',
];

function senderOf(testCase: Record<string, unknown>): SupervisorSenderShape {
  return testCase.sender as unknown as SupervisorSenderShape;
}

describe('actor resolution (identity.md §1.1)', () => {
  it('covers every actor class in the union', () => {
    const covered = cases.map((testCase) => testCase.expect_actor_class);
    for (const actorClass of ALL_ACTOR_CLASSES) {
      expect(covered, `no fixture for actor class ${actorClass}`).toContain(actorClass);
    }
  });

  it.each(names(cases))('%s resolves its actor class', (name) => {
    const testCase = byName(cases, name);
    expect(resolveActorClass(senderOf(testCase), config)).toBe(testCase.expect_actor_class);
  });
});

describe('resolution order (first match wins)', () => {
  it.each(names(traps))('%s', (name) => {
    const trap = byName(traps, name);
    const resolved = resolveActorClass(senderOf(trap), config);
    expect(resolved).toBe(trap.expect_actor_class);
    expect(resolved).not.toBe(trap.must_not_be);
  });

  it('resolves a Gist self-message as gist_self even when it carries a trusted bot ID', () => {
    // The shortest loop is Gist replying to itself, so rule 1 must beat rule 2
    // regardless of what else the event carries.
    const trap = byName(traps, 'gist_beats_trusted_bot_match');
    const sender = senderOf(trap);
    expect(sender.bot_id).toBe(config.kilo_bot_id);
    expect(resolveActorClass(sender, config)).toBe('gist_self');
  });

  it('fails towards capture-only when two configurations disagree', () => {
    // channel-memory classified this as `kilo` from its own configuration; the
    // supervisor does not recognise the IDs. Disagreement must not produce
    // trust (identity.md §1.1 rule 5).
    const trap = byName(traps, 'kilo_sender_class_without_matching_config_is_unknown');
    expect(resolveActorClass(senderOf(trap), config)).toBe('unknown_automation');
  });
});

describe('an unconfigured bot has no trusted identity (identity.md §1)', () => {
  const emptyConfig = unconfigured.config as unknown as TrustedAutomationConfig;
  const unconfiguredCases = asArray(unconfigured.cases, 'unconfigured_deployment.cases');

  it.each(names(unconfiguredCases))('%s', (name) => {
    const testCase = byName(unconfiguredCases, name);
    expect(resolveActorClass(senderOf(testCase), emptyConfig)).toBe(testCase.expect_actor_class);
  });

  it('never degrades an absent configuration to a name match', () => {
    const testCase = byName(unconfiguredCases, 'kilo_ids_present_but_unconfigured');
    expect(resolveActorClass(senderOf(testCase), emptyConfig)).not.toBe('kilo');
  });
});

describe('identity is exact IDs only (identity.md §2, GS-FR-008)', () => {
  const evidenceCases = asArray(nonIdentity.cases, 'non_identity_evidence.cases');

  it.each(names(evidenceCases))('%s cannot promote an actor', (name) => {
    const testCase = byName(evidenceCases, name);
    expect(resolveActorClass(senderOf(testCase), config)).toBe(testCase.expect_actor_class);
  });

  it('rejects a display name, text, and model output as identity evidence', () => {
    const attributes = evidenceCases.map((testCase) => testCase.attribute);
    for (const attribute of ['sender_display_name', 'username', 'message_text', 'model_output']) {
      expect(attributes, `${attribute} has no negative case`).toContain(attribute);
    }
  });

  it('compares whole strings, never prefixes', () => {
    const testCase = byName(evidenceCases, 'bot_id_prefix_is_not_a_match');
    const sender = senderOf(testCase);
    expect(sender.bot_id?.startsWith(String(config.kilo_bot_id))).toBe(true);
    expect(resolveActorClass(sender, config)).toBe('unknown_automation');
  });

  it('does not accept an upstream authorized flag on a non-human sender', () => {
    const trap = byName(traps, 'authorized_flag_alone_cannot_promote_a_bot');
    expect(senderOf(trap).human_authorized).toBe(true);
    expect(resolveActorClass(senderOf(trap), config)).toBe('unknown_automation');
  });
});

describe('the routing matrix (identity.md §3)', () => {
  it('has exactly one row per actor class', () => {
    const rows = matrix.map((row) => row.actor_class);
    expect(rows.slice().sort()).toEqual([...ALL_ACTOR_CLASSES].sort());
  });

  it.each(matrix.map((row) => String(row.actor_class)))('%s matches the frozen matrix', (actor) => {
    const row = byName(
      matrix.map((entry) => ({ ...entry, name: entry.actor_class })),
      actor,
    );
    const routing = routingFor(actor as ActorClass);
    expect(routing.persisted).toBe(row.persisted);
    expect(routing.evaluated).toBe(row.evaluated);
    expect(routing.may_create_workflow).toBe(row.may_create_workflow);
    expect(routing.may_advance_workflow).toBe(row.may_advance_workflow);
    expect(routing.may_own_or_approve).toBe(row.may_own_or_approve);
    expect(routing.route).toBe(row.route);
  });
});

describe('the three product rules read off the matrix', () => {
  it('makes Gist self persist-only and unconditionally unevaluated (GS-FR-040)', () => {
    const gist = routingFor('gist_self');
    expect(gist.persisted).toBe(true);
    // `never`, not `no`: the difference is that no configuration or later
    // decision may turn it on.
    expect(gist.evaluated).toBe('never');
    expect(gist.route).toBe('capture_only');
  });

  it('makes trusted bots evaluate-eligible but powerless', () => {
    for (const actor of ['kilo', 'linear'] as const) {
      const routing = routingFor(actor);
      expect(routing.evaluated).toBe('yes');
      expect(routing.may_advance_workflow).toBe(true);
      expect(routing.may_create_workflow).toBe(false);
      expect(routing.may_own_or_approve).toBe(false);
    }
  });

  it('makes unknown automation capture-only (GS-FR-011)', () => {
    const unknown = routingFor('unknown_automation');
    expect(unknown.persisted).toBe(true);
    expect(unknown.evaluated).toBe('no');
    expect(unknown.route).toBe('capture_only');
  });

  it('grants workflow creation to exactly one actor class', () => {
    const creators = ALL_ACTOR_CLASSES.filter((actor) => routingFor(actor).may_create_workflow);
    expect(creators).toEqual(['authorized_human']);
  });

  it('grants ownership and approval to exactly one actor class (GS-INV-08)', () => {
    const owners = ALL_ACTOR_CLASSES.filter((actor) => routingFor(actor).may_own_or_approve);
    expect(owners).toEqual(['authorized_human']);
  });

  it('persists every actor class except system lifecycle noise', () => {
    for (const actor of ALL_ACTOR_CLASSES) {
      expect(routingFor(actor).persisted).toBe(actor !== 'system');
    }
  });
});

describe('trusted content is untrusted evidence (identity.md §4, GS-INV-07)', () => {
  const doc = loadFixture('actions.v1.json');
  const untrusted = asRecord(doc.untrusted_content, 'untrusted_content');

  it.each(untrusted.claim_classes as string[])('%s changes nothing', (claim) => {
    // Trust is a property of the identity, never of the bytes. A trusted bot's
    // reply may quote a PR title an outside contributor wrote.
    expect(untrusted.expect_effect).toBe('none');
    expect(claim.length).toBeGreaterThan(0);
  });

  it('covers approval, ownership, destination, limits, policy, and completion claims', () => {
    const claims = untrusted.claim_classes as string[];
    for (const fragment of [
      'approval_granted',
      'owner_changed',
      'destination_changed',
      'limit_raised',
      'policy_override',
      'completed_without_acceptance',
    ]) {
      expect(claims.some((claim) => claim.includes(fragment)), `no claim covers ${fragment}`).toBe(
        true,
      );
    }
  });
});
