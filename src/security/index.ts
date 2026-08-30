/**
 * Gist authorization and privacy guard (T203).
 *
 * Contracts: docs/architecture/contracts/authorization.md, identity.md,
 * errors.md. Decisions: D001, D002, D006.
 *
 * The entry point is `authorize` — pure, total, deny-by-default. Everything
 * else here either feeds it (`policySnapshotFromConfig`), enforces its
 * ordering (`withAuthorization`), adapts it to the Slack surface
 * (`createChannelAuthorizer`), or governs what a denial may say
 * (`deny.ts`).
 */

export {
  AUTHORIZATION_CONTRACT_VERSION,
  AuthorizationScopeError,
  authorize,
  retrievalScope,
} from './authorize.js';

export { isChannelBoundary, isDirectMessageBoundary, parseBoundaryId } from './boundary.js';
export type { ParsedBoundary } from './boundary.js';

export {
  SILENT_DENY_REASONS,
  SPOKEN_DENY_REASONS,
  UNAUTHORIZED_USER_MESSAGE,
  denyLogFields,
  shouldNotifyUser,
  userMessageForDeny,
} from './deny.js';
export type { DenyLogFields } from './deny.js';

export { withAuthorization } from './guard.js';
export type { GuardOutcome, GuardedOperation } from './guard.js';

export { createChannelAuthorizer } from './channel-authorizer.js';
export type {
  ChannelAuthorizationDecision,
  ChannelAuthorizationInput,
  ChannelAuthorizerOptions,
  ChannelDenyReason,
  IdentityResolver,
  SecurityLogger,
  SenderAttributes,
  SenderResolver,
} from './channel-authorizer.js';

export { policySnapshotFromConfig } from './policy.js';

export type {
  AuthorizationDecision,
  AuthorizationEvent,
  AuthorizationRequest,
  BoundaryId,
  ConversationType,
  DenyReason,
  Gate,
  MembershipResolution,
  PolicySnapshot,
  ResourceId,
  ResourceIdentity,
  SenderType,
  ThreadId,
} from './types.js';
