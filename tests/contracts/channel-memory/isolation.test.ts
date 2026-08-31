/**
 * invariants.md — channel isolation (CM-INV-01…04, CM-INV-10, CM-NFR-003).
 *
 * Two channels, one workspace, deliberately overlapping timestamps: the corpus
 * is built so that anything which merges boundaries produces a visible wrong
 * answer here.
 */

import { describe, expect, it } from 'vitest';

import { asArray, asRecord, byName, loadFixture } from './helpers.js';
import { channelBoundaryId } from './reference-rules.js';

const fixture = loadFixture('isolation.v1.json');
const boundaries = asRecord(fixture.boundaries, 'boundaries');
const sameTs = asRecord(fixture.same_ts_two_channels, 'same_ts_two_channels');
const scopeCases = asArray(fixture.scope_cases, 'scope_cases');
const forbidden = asArray(fixture.forbidden, 'forbidden');
const independence = asArray(fixture.independence, 'independence');
const loggable = asRecord(fixture.loggable_reasons, 'loggable_reasons');

describe('two-channel boundaries', () => {
  it('derives both boundaries from the prefix rule (CM-INV-04)', () => {
    expect(boundaries.channel_a).toBe(channelBoundaryId('T0CHANTEST', 'C0CHANTESTA'));
    expect(boundaries.channel_b).toBe(channelBoundaryId('T0CHANTEST', 'C0CHANTESTB'));
    expect(boundaries.channel_a).not.toBe(boundaries.channel_b);
  });

  it('keeps the same Slack ts in two channels as two records', () => {
    const a = asRecord(sameTs.a, 'a');
    const b = asRecord(sameTs.b, 'b');

    expect(a.message_key).not.toBe(b.message_key);
    expect(a.boundary_id).not.toBe(b.boundary_id);
    // Same timestamp — only the channel component separates them.
    expect((a.message_key as string).split('/')[2]).toBe((b.message_key as string).split('/')[2]);
    expect(sameTs.expect_record_count).toBe(2);
  });
});

describe('scope is exactly one boundary (CM-INV-01)', () => {
  it.each(scopeCases.map((entry) => entry.name as string))('%s', (name) => {
    const testCase = byName(scopeCases, name);
    const scope = asArray(testCase.expect_scope, 'expect_scope');
    expect(scope).toHaveLength(1);
    expect(testCase.expect_scope_length).toBe(1);
    expect(scope[0]).toBe(channelBoundaryId('T0CHANTEST', testCase.request_channel_id as string));
  });

  it('gives each channel its own scope and never the other', () => {
    const a = byName(scopeCases, 'channel_a_request_scope');
    const b = byName(scopeCases, 'channel_b_request_scope');
    expect(a.expect_scope).not.toEqual(b.expect_scope);
    expect(a.expect_scope).not.toContain(boundaries.channel_b);
    expect(b.expect_scope).not.toContain(boundaries.channel_a);
  });
});

describe('forbidden cross-boundary operations (CM-INV-02, CM-NFR-003)', () => {
  it.each(forbidden.map((entry) => entry.name as string))('%s is denied', (name) => {
    expect(byName(forbidden, name).expect_allowed).toBe(false);
  });

  it('denies a two-channel scope and an empty scope alike', () => {
    // authorization.md §5 rule 6: an allowed decision with an empty scope is a
    // contract violation, not an empty search.
    for (const name of ['scope_containing_two_channels', 'empty_scope']) {
      const testCase = byName(forbidden, name);
      expect(testCase.expect_allowed).toBe(false);
      expect(testCase.expect_reason).toBe('scope_length_must_be_one');
    }
  });

  it('denies a dm: boundary and an unprefixed ID in a channel scope', () => {
    for (const name of ['dm_boundary_in_channel_scope', 'unprefixed_channel_id_as_boundary']) {
      expect(byName(forbidden, name).expect_reason).toBe('boundary_prefix_mismatch');
    }
  });

  it('requires the boundary filter inside the vector query, not after it', () => {
    // Post-filtering means the store already scored across boundaries; a LIMIT
    // then decides what leaks (storage.md §2).
    const testCase = byName(forbidden, 'post_filtering_instead_of_in_query_filter');
    expect(testCase.vector_query_filter_present).toBe(false);
    expect(testCase.expect_allowed).toBe(false);
    expect(testCase.expect_reason).toBe('boundary_filter_must_be_in_query');
  });
});

describe('channel independence (CM-INV-03)', () => {
  it('keeps capture running in A when B fails to embed', () => {
    const testCase = byName(independence, 'channel_b_embedding_failure_does_not_stop_channel_a');
    expect(testCase.expect_channel_a_capture).toBe(true);
    // Capture continues even in the failing channel — only the vector lags
    // (CM-NFR-002).
    expect(testCase.expect_channel_b_capture).toBe(true);
    expect(testCase.expect_channel_b_embedding_marked_stale).toBe(true);
  });

  it('scopes a leave to its own boundary and deletes nothing (CM-INV-10)', () => {
    const testCase = byName(independence, 'channel_a_left_does_not_affect_channel_b');
    expect(testCase.expect_channel_a_capture).toBe(false);
    expect(testCase.expect_channel_a_records_retained).toBe(true);
    expect(testCase.expect_channel_b_capture).toBe(true);
    expect(testCase.expect_delete_primitive_calls).toBe(0);
  });

  it('contains a malformed event to its own channel and emits nothing', () => {
    const testCase = byName(independence, 'malformed_event_in_channel_b_does_not_stop_channel_a');
    expect(testCase.expect_channel_a_capture).toBe(true);
    expect(testCase.expect_outbound_actions).toEqual([]);
    expect(testCase.expect_generation_calls).toBe(0);
  });
});

describe('CM-INV-11 — every logged reason is content-free', () => {
  const reasons = [
    ...asArray(loggable.capture_deny_reasons, 'capture_deny_reasons'),
    ...asArray(loggable.response_deny_reasons_added, 'response_deny_reasons_added'),
    ...asArray(loggable.mutation_results, 'mutation_results'),
  ] as unknown as string[];

  it('uses stable snake_case tokens, never free text', () => {
    for (const reason of reasons) {
      expect(reason, `${reason} is not a stable token`).toMatch(/^[a-z_]+$/);
    }
  });

  it('carries no identifier or message text in any reason', () => {
    for (const reason of reasons) {
      expect(reason).not.toMatch(/[TCUBAF]0[A-Z0-9]{6,}/);
      expect(reason).not.toContain(' ');
    }
  });
});
