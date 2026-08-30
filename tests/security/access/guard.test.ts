/**
 * Ordering: authorization before storage, retrieval, or generation (INV-2).
 *
 * authorization.md §6 says T502 verifies this by inspecting call order rather
 * than trusting comments. `withAuthorization` makes the order structural, and
 * these tests inspect the order.
 */

import { describe, expect, it, vi } from 'vitest';

import { withAuthorization } from '../../../src/security/index.js';
import type { BoundaryId } from '../../../src/security/types.js';
import {
  ALL_GATES,
  SYNTHETIC,
  channelBoundary,
  directMessageBoundary,
  makeChannelEvent,
  makeDirectMessageEvent,
  makeRequest,
} from './helpers.js';

describe('withAuthorization', () => {
  it('never invokes the operation on a denied request', async () => {
    const operation = vi.fn(async () => 'retrieved');

    for (const gate of ALL_GATES) {
      const event = makeChannelEvent({ channel_id: SYNTHETIC.channelUnapproved });
      const outcome = await withAuthorization(makeRequest(gate, { event }), operation);
      expect(outcome.allowed).toBe(false);
      expect(outcome.decision.reason).toBe('unapproved_channel');
    }

    expect(operation).not.toHaveBeenCalled();
  });

  it('never invokes the operation for an external sender', async () => {
    // FR-PRV-006 — a denied turn costs no storage lookup and no model call.
    const operation = vi.fn(async () => 'generated');
    const event = makeDirectMessageEvent({ sender_is_external: true });
    const outcome = await withAuthorization(
      makeRequest('read_memory', { event }),
      operation,
    );

    expect(outcome.allowed).toBe(false);
    expect(operation).not.toHaveBeenCalled();
  });

  it('never invokes the operation for a malformed request', async () => {
    const operation = vi.fn(async () => 'generated');
    const outcome = await withAuthorization(null as never, operation);
    expect(outcome.decision.reason).toBe('malformed_request');
    expect(operation).not.toHaveBeenCalled();
  });

  it('runs the operation with the granted scope on an allowed read', async () => {
    const seen: Array<readonly BoundaryId[]> = [];
    const outcome = await withAuthorization(makeRequest('read_memory'), (scope) => {
      seen.push(scope);
      return scope.length;
    });

    expect(outcome.allowed).toBe(true);
    expect(seen).toEqual([
      [channelBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.channelApproved)],
    ]);
    expect(outcome.allowed ? outcome.value : null).toBe(1);
  });

  it('hands a DM operation only that user private boundary', async () => {
    const event = makeDirectMessageEvent();
    let received: readonly BoundaryId[] = [];
    await withAuthorization(makeRequest('read_memory', { event }), (scope) => {
      received = scope;
    });

    expect(received).toEqual([
      directMessageBoundary(SYNTHETIC.workspaceApproved, SYNTHETIC.userMember),
    ]);
  });

  it('authorizes before running the operation, not alongside it', async () => {
    const order: string[] = [];
    const request = makeRequest('write_memory');
    await withAuthorization(request, () => {
      order.push('operation');
    });

    expect(order).toEqual(['operation']);
    // And the denied path records nothing at all.
    const denied = makeChannelEvent({ channel_id: SYNTHETIC.channelUnapproved });
    await withAuthorization(makeRequest('write_memory', { event: denied }), () => {
      order.push('operation');
    });
    expect(order).toEqual(['operation']);
  });
});
