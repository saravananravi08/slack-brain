/**
 * Ordering guard — authorization before anything that reads, writes, or
 * generates.
 *
 * INV-2 is not advisory: `authorize` must run before the first storage read or
 * write on every path, including mutations (authorization.md §6, D005).
 * A comment cannot enforce that. This combinator can: the operation is a
 * callback that is only ever invoked on an allowed decision, and it receives
 * the granted scope as its only argument, so a caller cannot reach storage
 * without having gone through a decision first.
 */

import { authorize } from './authorize.js';
import type { AuthorizationDecision, AuthorizationRequest, BoundaryId } from './types.js';

export type GuardedOperation<T> = (scope: readonly BoundaryId[]) => Promise<T> | T;

export type GuardOutcome<T> =
  | { readonly allowed: true; readonly decision: AuthorizationDecision; readonly value: T }
  | { readonly allowed: false; readonly decision: AuthorizationDecision };

/**
 * Authorize, then run the operation only if the decision allows it.
 *
 * A denied request costs no storage lookup and no model call: the operation is
 * never invoked, so there is no path on which an unauthorized event can touch
 * memory or generation.
 */
export async function withAuthorization<T>(
  request: AuthorizationRequest,
  operation: GuardedOperation<T>,
): Promise<GuardOutcome<T>> {
  const decision = authorize(request);
  if (!decision.allowed) return { allowed: false, decision };

  const value = await operation(decision.scope);
  return { allowed: true, decision, value };
}
