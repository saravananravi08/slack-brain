# Contract — durable commands, outbox dispatch, and failure

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen); consumers T903, T905, T906
- **Implements:** D026, D027, D028
- **Satisfies:** GS-FR-015, GS-FR-020, GS-FR-024, GS-FR-042, GS-FR-043, GS-NFR-002, GS-NFR-005, GS-NFR-006

A visible supervisor decision, its workflow consequence, and its Slack send are one durable command
protocol. They are not separate prose concerns. The database transaction creates the event-global
action claim and a `pending` outbox row. The outbox owns every later send attempt. No Slack call is
made without that row, and no completed continuation is needed to drive it after that commit.

The guarantee is idempotent effects, not exactly-once model evaluation. A continuation may be
evaluated again after a crash; a durable command cannot be created or sent twice for its event.

## 1. `ActionCheckpoint` is the command and outbox row

Common fields:

```text
ActionCheckpointBase
  action_id             non-empty string
  binding_kind          'workflow' | 'event'
  version               safe integer >= 1       # durable action version
  source_event_key      non-empty SourceEventKey
  action_class          ExternallyVisible
  logical_target        LogicalTarget | null
  destination_ref       non-empty string       # opaque, runtime-derived
  destination_source    'workflow_binding' | 'source_event'
  delivery_state        DeliveryState
  slack_message_key     non-empty MessageKey | null
  attempt_count         safe integer >= 1
  last_failure_class    FailureClass | null
  created_at            valid timestamp
  updated_at            valid timestamp >= created_at
```

The binding is a closed discriminated union:

```text
BoundCheckpoint   = ActionCheckpointBase + {
  binding_kind: 'workflow'; workflow_id: non-empty string;
  destination_source: 'workflow_binding'
}

UnboundCheckpoint = ActionCheckpointBase + {
  binding_kind: 'event'; workflow_id: null; action_class: 'reply_user';
  destination_source: 'source_event'
}
```

A bound destination is derived from the immutable workflow binding. An unbound destination is
derived from the persisted source Slack event's workspace/channel/thread. Neither destination is
model-controlled. An unmatched-bot notice and ordinary assistance use the unbound variant; they do
not fabricate a workflow ID.

The objects are closed: every shown field is required and no unknown field is accepted.
`version` is the durable action version and changes on any material objective, scope, acceptance,
work-class, or target change.
Only the five `ExternallyVisible` action classes are valid; internal actions such as `no_action`
never become checkpoints. Targeted actions require `logical_target`; all others require null.
`delivered` requires a message key and every other delivery state forbids one; `failed` requires a
failure class. Timestamps must parse
and cannot move backwards. `destination_ref` is an opaque audit handle, not a model field or Slack
identifier. Missing, malformed, unsafe-integer, unknown-field, variant, and state-consistency errors
are rejected before command insertion.

## 2. Atomic command creation (GS-FR-024)

Before creating a command, the evaluator re-reads state and checks actor authority, limits or a
single human limit grant, action schema, expected version, approval, compatibility, target identity,
and runtime destination. `destination_unresolved` stops here. It is not a Slack attempt and never
creates a retryable `failed` row.

One transaction then writes:

```text
ActionClaimKey = "ev:<source_event_key>"
ActionCheckpoint.delivery_state = 'pending'
```

and, when applicable, the workflow transition or continuation completion that selected the command.
For a continuation, `processing → completed` may commit with this durable `pending` outbox intent.
That is safe because the outbox, not the completed continuation, now owns liveness.

The action claim is event-global. Workflow metadata may be null, so the key cannot contain a
workflow. A duplicate Slack delivery, continuation replay, or restart cannot insert a second command
for the same event.

A `pending` command is an unsent durable intent. It is not abandoned or reconciled merely because a
process restarted. Startup drains pending commands before accepting new supervisor evaluation.
Policy is not re-evaluated between command commit and its first send; doing so could strand a command
whose one authorized opportunity was already consumed. Explicit cancellation or supersession may
atomically move a still-unsent `pending` row to `abandoned`.

Only one command per workflow may be `pending` or `in_flight`. Unbound commands deduplicate through
the same event-global action claim and need no workflow-scoped in-flight slot.

## 3. Attempt protocol

```text
DeliveryState = 'pending' | 'in_flight' | 'delivered' | 'failed' | 'abandoned'
DispatchClaimKey = "wf:<workflow_id>|act:<action_id>|v:<version>|n:<attempt>"
```

For an unbound command the dispatch claim uses the command's `action_id`, version, and attempt with
its event binding; no fabricated workflow identity is introduced.

### 3.1 First send ordering

The outbox worker performs these steps in order:

1. CAS `pending → in_flight` and durably claim the current attempt.
2. Only after that commit, initiate the Slack call.
3. Record the result under CAS.

The `in_flight` write must precede the call. A crash before step 1 leaves `pending`, so restart safely
resumes the first send. A crash after step 1 makes call start ambiguous; restart reconciles and never
blindly retries.

| From | To | Cause |
|---|---|---|
| `pending` | `in_flight` | attempt claim committed; Slack call may now start |
| `pending` | `abandoned` | explicit cancel/supersede before any attempt |
| `in_flight` | `delivered` | Slack returned canonical outgoing message identity, or reconciliation found positive delivery evidence |
| `in_flight` | `failed` | Slack definitively rejected the call before acceptance |
| `in_flight` | `in_flight` | ambiguous result; reconciliation has not resolved delivery |
| `in_flight` | `abandoned` | explicit owner/approver resolution only |
| `failed` | `pending` | next serial attempt is durably scheduled after policy checks |
| `failed` | `abandoned` | retries exhausted or command superseded |
| `delivered`, `abandoned` | — | terminal |

### 3.2 Outcomes

```text
DeliveryOutcome = 'delivered' | 'definitive_failure' | 'indeterminate'
```

- `delivered`: a canonical outgoing message identity was returned.
- `definitive_failure`: Slack returned `slack_permission_denied`, `slack_rate_limited`, or
  `slack_invalid_request` before accepting the post.
- `indeterminate`: timeout, connection loss, `slack_transport_error`, or any response that neither
  confirms nor disproves publication.

Only `definitive_failure` moves `in_flight → failed`. An indeterminate result remains `in_flight`,
runs §5 reconciliation, and cannot create another attempt.

### 3.3 Attempts are serial

Attempt 1 starts from the original pending command. Attempt N+1 may be created only after attempt N
has durably ended in `failed` from a definitive Slack pre-acceptance rejection. Attempt numbers are
consecutive. Two attempts are never live together. An ambiguous or live attempt never permits its
successor to exist.

A retry keeps one `action_id` and one `version`, requires the workflow to remain `ready`, and stops at
`max_consecutive_failures`. `failed → pending` creates the next durable unsent attempt; startup then
handles it exactly like any pending outbox work.

### 3.4 Human abandonment

An unresolved `in_flight` command may move to `abandoned` only on an explicit resolution by the
workflow owner or configured approver, recorded with the workflow transition. Absence from a thread,
an unreadable thread, elapsed time, or runtime inference is never enough. `pending → abandoned` is
allowed before a send because no call may have started.

## 4. Workflow effects

`ready → dispatched` commits only with `delivered` and the outgoing message identity. A definitive
failure leaves the workflow `ready`, increments `consecutive_failures`, and may schedule the next
serial attempt. Reaching the failure limit moves to `waiting_human`.

An indeterminate attempt leaves the checkpoint `in_flight`; immediate reconciliation either commits
`ready → dispatched` on positive evidence or `ready → waiting_human` with
`dispatch_unreconciled`. `ready` is transient on that path and must not look dispatchable.

A durable pending command is already an authorized effect. Limit checks apply before command
creation, not again in the outbox worker. This is required for a one-opportunity human continue grant:
a crash after consuming the grant and committing the command must not lose the send.

## 5. Restart and reconciliation (GS-FR-015, GS-NFR-002)

Startup processes non-terminal outbox rows before new supervisor events:

| Durable row | Recovery |
|---|---|
| `pending` | resume its first/current send: CAS to `in_flight`, then call Slack |
| `in_flight` with Gist outgoing record | `delivered`; advance workflow |
| `in_flight` with matching marker in bound thread | `delivered`; advance workflow |
| `in_flight` without positive evidence | remain `in_flight`; workflow `waiting_human`; no send |
| `failed` | schedule a serial retry only if §3.3 still permits it |
| `delivered` / `abandoned` | no action |

Reconciliation is for `in_flight`, not `pending`. It is one-directional: positive evidence may prove
delivery; missing evidence never establishes that nothing was sent. Local outgoing records are checked before a
thread scan. Delayed capture/history and short or rate-limited reads make absence inconclusive.

### 5.1 Crash matrix

| Crash point | Durable fact | Recovery | Effect guarantee |
|---|---|---|---|
| before command transaction | continuation still non-completed | resume at-least-once evaluation | zero or one idempotent effect |
| action claim + checkpoint committed; Slack call not started | `pending` | resume pending first send | one eventual Slack effect if Slack accepts; no lost dispatch |
| after `pending → in_flight`, before/around call start | `in_flight` | reconcile; human if unresolved | zero or one effect; never blind retry |
| Slack accepted, result not committed | `in_flight` | positive evidence → `delivered` | one effect, no duplicate |
| result committed | `delivered` | skip | one effect, no duplicate |

The unavoidable pre-call gap after `in_flight` is treated as ambiguity. The protocol does not claim
exactly-once external delivery. It preserves safety by refusing an automatic second call and
preserves liveness for the proven-unsent `pending` case.

## 6. Failure classes

```text
FailureClass =
  'slack_rate_limited' | 'slack_transport_error' | 'slack_permission_denied' |
  'slack_invalid_request' | 'destination_unresolved' | 'in_flight_conflict' |
  'claim_conflict' | 'state_mismatch' | 'version_mismatch' | 'illegal_transition' |
  'terminal_workflow' | 'approval_missing' | 'approval_expired' |
  'approval_scope_changed' | 'compatibility_blocked' | 'schema_invalid' |
  'runtime_controlled_field_present' | 'model_unavailable' |
  'storage_unavailable' | 'dispatch_unreconciled' | 'internal_error'
```

| Group | Behavior |
|---|---|
| definitive Slack pre-acceptance rejection | serial retry within limits; workflow stays `ready` |
| ambiguous transport | reconcile; unresolved → `waiting_human`; no retry |
| `destination_unresolved`, compatibility | no command/send/fallback; `waiting_human` |
| stale/authorization/claim/schema/model guard | no send; re-evaluate only from a new eligible event |
| storage unavailable | no command means no send |
| dispatch unreconciled | remain `in_flight`; `waiting_human`; no send |

All classes are content-free. Exact message capture continues under every supervisor failure.

## 7. Where each rule is pinned

| Rule | Pinned by |
|---|---|
| complete closed bound/unbound schemas, field types, safe integers, and state/time consistency | `dispatch.test.ts` |
| event-global claim and unbound dedup/restart | `dispatch.test.ts` |
| atomic continuation completion + pending intent | `continuation.test.ts`, `dispatch.test.ts` |
| pending resumes before new evaluation | `dispatch.test.ts` |
| pending → in_flight before Slack call | `dispatch.test.ts` |
| in-flight ambiguity only reconciles | `dispatch.test.ts` |
| strictly serial definitive-failure retries | `dispatch.test.ts` |
| crash matrix and pending first-send liveness | `dispatch.test.ts`, `continuation.test.ts` |
| human-only in-flight abandonment | `dispatch.test.ts` |
| failure taxonomy and `destination_unresolved` | `dispatch.test.ts`, `actions.test.ts` |
