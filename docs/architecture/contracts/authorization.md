# Contract — authorization and privacy guard

- **Contract version:** 1.0.0
- **Owner:** T004 (frozen); consumers T203, T402, T404, T502
- **Enforces:** INV-1, INV-2, INV-5
- **Implements:** D001 (approved channels), D002 (DM knowledge access), D006 (workspace membership)

## 1. Gates

D001 requires three gates, **each checked independently** rather than inferred from another. A component that has passed one gate has no standing to skip another.

| Gate | Question | Called by |
|---|---|---|
| `accept_event` | May this event be processed at all? | Adapter / normalizer, before any storage touch |
| `write_memory` | May this content be stored in this boundary? | Silent persistence, mutations, import |
| `read_memory` | Which boundaries may this request retrieve from? | Retrieval, before generation |

`generate` is not a separate gate: generation is permitted only on the `addressed` path, and only after `read_memory` has returned a scope.

## 2. Types

```ts
type Gate = 'accept_event' | 'write_memory' | 'read_memory';

interface AuthorizationRequest {
  contract_version: string;
  gate: Gate;
  event: NormalizedEvent;
  identity: ResourceIdentity;
  policy: PolicySnapshot;
}

interface PolicySnapshot {
  approved_workspace_id: string;
  approved_channel_ids: readonly string[];   // GIST_APPROVED_CHANNEL_IDS, never empty
  user_allowlist: readonly string[];         // GIST_USER_ALLOWLIST, empty = all full members
  dm_shared_knowledge: boolean;              // GIST_DM_SHARED_KNOWLEDGE, accepted default false
}

interface AuthorizationDecision {
  allowed: boolean;
  reason: DenyReason | null;                 // null iff allowed
  scope: readonly BoundaryId[];              // non-empty iff allowed && gate === 'read_memory'
}
```

`PolicySnapshot` is **passed in, never read from ambient globals** (D001 consequence for T004). This keeps the guard pure, makes every test case a plain object, and makes it impossible for one component to be looking at different policy than another.

## 3. Deny reasons

```ts
type DenyReason =
  | 'unapproved_workspace' | 'unapproved_channel'
  | 'external_user' | 'guest_user' | 'deactivated_user' | 'not_in_allowlist'
  | 'bot_or_app_sender' | 'dm_shared_knowledge_disabled'
  | 'identity_unresolved' | 'malformed_request';
```

Every reason is safe to log (no message content, no token) and maps to a user-facing message via `errors.md`. The user never sees the raw reason — `unapproved_channel` tells an attacker the channel exists but is not approved (INV-11).

## 4. Decision rules

Evaluated in order. **First deny wins**, and evaluation stops — later checks must not run against an already-denied request.

1. Workspace ≠ `approved_workspace_id` → `unapproved_workspace`.
2. `sender_is_external` → `external_user` (D006, FR-PRV-006). Applies to every gate, every conversation type, including DMs.
3. `sender_is_guest` → `guest_user` (D006).
4. `sender_type !== 'human'` → `bot_or_app_sender` (FR-SLK-009).
5. Sender deactivated → `deactivated_user`.
6. `user_allowlist` non-empty and sender absent → `not_in_allowlist` (D006; empty list means all full members).
7. Channel conversation with `channel_id ∉ approved_channel_ids` → `unapproved_channel` (D001).
8. Identity unresolved or malformed → `identity_unresolved` / `malformed_request`.
9. Otherwise allow, and compute scope per §5.

## 5. Retrieval scope (D002)

`scope` is the **exhaustive** list of boundaries the request may read. Retrieval must query only these — it is not a hint or a ranking preference.

| Conversation | `dm_shared_knowledge` | Scope |
|---|---|---|
| Channel | any | `[ch:<ws>:<channel>]` — the originating channel only |
| DM | `false` (accepted default) | `[dm:<ws>:<user>]` — that user's private boundary only (INV-5) |
| DM | `true` (requires D002 re-approval) | `[dm:<ws>:<user>, ...approved channels the user is currently a member of]` |

Rules:

1. **A channel request never receives another channel's boundary.** Cross-channel recall requires explicit approval that does not exist (FR-PRV-002, AC-11).
2. **A channel request never receives any `dm:` boundary.** DM content is not channel knowledge (FR-PRV-004, AC-10).
3. **Under the accepted default, a DM request never receives a `ch:` boundary.** This is the whole of D002.
4. **The `dm_shared_knowledge: true` row is specified but must not be enabled.** D002 gates it on written owner re-approval, a fail-closed membership resolver, and a passing T502 suite. It is documented here so that enabling it later is a configuration change against a known shape rather than a redesign — but a T203 implementation that ships it live violates the accepted decision.
5. **Membership resolution fails closed.** If the membership lookup errors, times out, or returns stale data, the affected channel boundaries are **excluded**, not included. A lookup failure must never widen scope.
6. **Empty scope denies.** An allowed decision with an empty scope is a contract violation, not an empty search.

## 6. Ordering

INV-2 is not advisory. `authorize` must be called **before** the first storage read or write on every path, including mutations (D005: a mutation for an unapproved channel is denied before lookup, so mutation events cannot probe stored state). T502 verifies this by inspecting call order, not by trusting comments.

## 7. Interface

```ts
function authorize(req: AuthorizationRequest): AuthorizationDecision;
function retrievalScope(d: AuthorizationDecision): readonly BoundaryId[];
```

Pure, total, no I/O, no clock. In v1 membership data arrives inside `PolicySnapshot`; when D002 flips, the resolver that populates it owns the network call and the fail-closed behavior, keeping `authorize` itself pure and exhaustively testable.

## 8. Required test matrix (T203, T502)

Full member · single-channel guest · multi-channel guest · external/Connect user · deactivated user · bot · app · unknown user · malformed identity — each × channel and DM × all three gates. Plus: empty allowlist allows full members; non-empty allowlist denies a non-listed full member; unapproved channel denies before any storage call; membership lookup failure narrows scope rather than widening it; allowed decision never returns empty scope.

## 9. Fixtures

[`fixtures/authorization.v1.json`](./fixtures/authorization.v1.json) — the decision matrix as input/expected pairs, including both `dm_shared_knowledge` settings so the disabled default is pinned by test and cannot be flipped unnoticed.
