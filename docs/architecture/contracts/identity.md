# Contract — resource, thread, and boundary identity

- **Contract version:** 1.0.0
- **Owner:** T004 (frozen); consumers T201, T202, T204, T403
- **Enforces:** INV-3, INV-4, INV-5

This is the contract that makes privacy isolation **structural**. D002 requires that a DM can never resolve to a channel resource; that guarantee lives here, in the shape of the ID space, rather than in a filter someone can forget to apply.

## 1. Types

```ts
type BoundaryId  = `ch:${string}:${string}` | `dm:${string}:${string}`;
type ResourceId  = BoundaryId;
type ThreadId    = `${BoundaryId}#${string}`;

interface ResourceIdentity {
  contract_version: string;
  boundary_id: BoundaryId;
  resource_id: ResourceId;
  thread_id: ThreadId;
  conversation_type: 'channel' | 'dm';
}
```

## 2. Construction

| Kind | `boundary_id` | Composed from |
|---|---|---|
| Channel | `ch:<workspace_id>:<channel_id>` | workspace + channel |
| DM | `dm:<workspace_id>:<user_id>` | workspace + **the human user's** ID |

```
thread_id = `${boundary_id}#${thread_root_ts}`
```

Rules:

1. **The `ch:` / `dm:` prefix is mandatory and never stripped.** It is what makes INV-3 structural: no channel ID can produce a `dm:` boundary, and no DM can produce a `ch:` boundary, because the prefix comes from the conversation type rather than from any Slack ID. A string collision between a channel ID and a user ID cannot cross the boundary.
2. **A DM boundary is keyed on the human user, not on the Slack DM conversation ID.** The user ID is stable; the DM conversation ID is an implementation detail of Slack's IM channel. This gives each user exactly one private boundary (FR-PRV-003) and makes "this user's DM history" directly addressable for the D004 90-day sweep.
3. **`resource_id === boundary_id`** in v1. They are kept as distinct types because Mastra's memory model separates resource from thread, and collapsing them now would make a future split a breaking change.
4. **Workspace ID is always included.** Multi-workspace installation is a non-goal (PRD §5), but omitting the workspace would make identities ambiguous the moment a test workspace and the production workspace both exist — which is exactly the T003 alpha setup.

## 3. Thread root normalization

```ts
threadRootTs(e: NormalizedEvent): string
  = e.thread_ts ?? e.message_ts;
```

Slack encodes a root message two ways: `thread_ts` absent, or `thread_ts === message_ts`. The normalizer collapses the second to `null` (`slack-event.md` §2), and this function collapses both to the same root. **Both encodings must produce one `thread_id`.** Failing this splits a single conversation across two memory threads, which surfaces as "Gist forgot the earlier part of this thread" — and is invisible in any test that only exercises one encoding.

## 4. Forbidden operations

These must be impossible by construction, not merely unused. T202's tests assert each.

| Forbidden | Why |
|---|---|
| Deriving a `ch:` boundary from a DM event, or a `dm:` boundary from a channel event | INV-3 |
| Writing a DM message into a `ch:` boundary | INV-4, FR-PRV-004 |
| Reading another user's `dm:` boundary | FR-PRV-003 |
| Constructing a `BoundaryId` by string concatenation outside `resource-policy.ts` | Single point of truth; ad-hoc construction is how prefixes get dropped |
| Using a bare channel or user ID as a `BoundaryId` | Unprefixed IDs defeat INV-3 |

## 5. Resolver interface

```ts
function resolveIdentity(e: NormalizedEvent): ResourceIdentity;
function boundaryIdFor(i: ResourceIdentity): BoundaryId;
```

- Pure and total: same input always yields the same output, no I/O, no clock, no randomness.
- Deterministic across processes and restarts — identities are persisted, so a change to this function is a **data migration**, not a refactor.
- Malformed input throws rather than returning a guessed identity. A wrong identity writes data into the wrong boundary, which is worse than a failed request.

## 6. Alignment with the T002 benchmark

`benchmarks/baseline/benchmark.schema.json` (merged, T002) already uses `boundary_id`, `conversation_type`, `conversation_id`, and `thread_id`. This contract adopts that vocabulary deliberately so benchmark fixtures and runtime identities do not diverge. Where the benchmark schema says `conversation_id`, the runtime equivalent is the `channel_id` component of `boundary_id`.

## 7. Fixtures

[`fixtures/identities.v1.json`](./fixtures/identities.v1.json) — channel root, channel reply, both root encodings, DM root, DM reply, plus the collision pair where a channel ID and a user ID share a suffix and must still land in different boundaries.
