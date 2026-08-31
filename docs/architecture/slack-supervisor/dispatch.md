# Contract — action checkpoints, dispatch, and failure

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen); consumers T903, T905, T906
- **Implements:** D026, D027, D028
- **Satisfies:** GS-FR-015, GS-FR-020, GS-FR-024, GS-FR-042, GS-FR-043, GS-NFR-002, GS-NFR-005, GS-NFR-006

One Slack event must not be able to produce two instructions to a bot — not through a retry, not
through a restart, not through a replayed reply, not through two concurrent deliveries. This
contract is where that is enforced.

## 1. `ActionCheckpoint`

```text
ActionCheckpoint
  action_id
  workflow_id
  version              integer >= 1
  source_event_key     MessageKey        # the one event that justifies this action
  action_class         # actions.md §1
  logical_target       LogicalTarget | null
  destination_ref      string | null     # opaque runtime handle; resolved from the binding
  delivery_state       DeliveryState     # §3
  slack_message_key    MessageKey | null # set only on confirmed delivery
  attempt_count        integer
  last_failure_class   FailureClass | null
  created_at           timestamp
  updated_at           timestamp
```

`destination_ref` is resolved by the runtime from the workflow binding (`actions.md` §3 step 7) and
is never carried in, or derivable from, the model's action. It is recorded so an audit can show
which destination was used without the record itself becoming a place a destination can be
injected.

`version` increments on any material change to the action — objective, scope, acceptance, work
class, or logical target — which is what makes approval invalidation structural
(`approvals.md` §3.2).

## 2. One event, at most one durable external action (GS-FR-024)

Two durable claims, both taken **before** anything leaves the process:

```text
ActionClaimKey   = "wf:<workflow_id>|ev:<source_event_key>"
DispatchClaimKey = "wf:<workflow_id>|act:<action_id>|v:<version>|n:<attempt>"
```

**`ActionClaimKey`** is claimed once per supervisor event. A second attempt to create an externally
visible action for the same `(workflow_id, source_event_key)` fails the claim and is refused. This
is the literal statement of GS-FR-024: one event, at most one externally visible action, and the
claim commits before the action becomes visible.

**`DispatchClaimKey`** is claimed once per delivery attempt. It bounds retries: a retry is a new
attempt number with its own claim, so a retry that races with a slow original cannot produce two
sends under one attempt.

Both claims are durable and atomic — the same compare-and-set property the existing channel-delivery
dedup ledger provides. Both survive restart. In-memory sets are not sufficient: the failure this
prevents is precisely the one where the process died between deciding and sending.

Only one action per workflow may be in a non-terminal delivery state at any time
(`workflow-state.md` §7.1, `max_in_flight_actions = 1`). A dispatch requested while another is
`pending` or `in_flight` is refused with `in_flight_conflict`.

## 3. `DeliveryState`

```text
DeliveryState = 'pending' | 'in_flight' | 'delivered' | 'failed' | 'abandoned'
```

| From | To | When |
|---|---|---|
| `pending` | `in_flight` | the dispatch claim is held and the Slack call has started |
| `pending` | `abandoned` | the action was superseded before any send (cancel, redirect, limit stop) |
| `in_flight` | `delivered` | Slack returned a canonical message identity for the post |
| `in_flight` | `failed` | Slack returned an error, or the attempt timed out |
| `in_flight` | `abandoned` | reconciliation proved nothing was delivered (§5) |
| `failed` | `pending` | a retry is permitted and a new attempt begins |
| `failed` | `abandoned` | retries exhausted, or the workflow moved on |
| `delivered` | — | terminal; a delivered action is never re-sent |

`delivered` is set **only** from a Slack response carrying the outgoing message identity. Not from
a timeout that "probably" succeeded, not from an absence of error. `slack_message_key` is set in the
same commit, which is what lets a later reply be matched to the action that caused it.

Retry convergence (GS-FR-043): retries share one `action_id` and one `version`. Whichever attempt
succeeds first sets `delivered` under compare-and-set; later attempts observe `delivered` and stop.
One durable action, one expected bot turn.

## 4. Failed dispatch does not advance the workflow (GS-FR-042)

On any `failed` delivery:

1. The workflow **stays in `ready`**. It does not enter `dispatched`, and `expected_actor` does not
   become the bot (`workflow-state.md` §2.3).
2. `consecutive_failures` increments.
3. The failure class is recorded on the checkpoint and in a `TransitionRecord` with
   `outcome: 'rejected'`.
4. If `consecutive_failures` has reached `max_consecutive_failures`, the workflow moves to
   `waiting_human` instead of retrying (`workflow-state.md` §7.3).

There is no state that means "sent, we think". The whole point of confirming delivery before
advancing is that the alternative — advancing optimistically and correcting later — requires
knowing whether the bot received something, which is exactly what a failed dispatch cannot tell you.

## 5. Restart reconciliation (GS-FR-015, GS-NFR-002)

At startup, every checkpoint in `pending` or `in_flight` is reconciled before the workflow accepts
new events:

| Found state | Reconciliation | Result |
|---|---|---|
| `pending`, no claim consumed | nothing was sent | → `abandoned`; workflow stays `ready` |
| `in_flight`, an outgoing message with this action's `workflow_marker` exists in the bound thread | it was delivered | → `delivered`; workflow advances normally |
| `in_flight`, the bound thread contains no such message and the thread is readable | nothing was delivered | → `abandoned`; workflow stays `ready` |
| `in_flight`, the thread cannot be read or the answer is ambiguous | unknown | → left `in_flight`; workflow → `waiting_human`, reason `dispatch_unreconciled` |

Reconciliation reads Gist's **own** outgoing message record first — the send path persists
outgoing messages directly, so the local record is authoritative and does not depend on Slack echo
behavior. The thread scan is the fallback when the local record is absent because the process died
between the Slack call and the local write.

Row 4 is the important one: an unreconcilable in-flight action asks a human rather than re-sending.
Re-sending would risk a duplicate instruction, and a duplicate instruction to a coding bot is a
duplicate pull request, a duplicate issue, or duplicated work. Asking is cheap; duplicating is not.

**Recovery replays state, not effects.** No confirmed-delivered instruction is re-sent, and no
committed transition is re-applied.

## 6. `FailureClass` (GS-NFR-006)

```text
FailureClass =
  'slack_rate_limited' | 'slack_transport_error' | 'slack_permission_denied' |
  'destination_unresolved' | 'in_flight_conflict' | 'claim_conflict' |
  'state_mismatch' | 'version_mismatch' | 'illegal_transition' | 'terminal_workflow' |
  'approval_missing' | 'approval_expired' | 'approval_scope_changed' |
  'compatibility_blocked' | 'schema_invalid' | 'model_unavailable' |
  'storage_unavailable' | 'dispatch_unreconciled' | 'internal_error'
```

Every value is a class, safe to log, and names nothing about content, channel, or person.

Fail-closed behavior by group:

| Group | Behavior |
|---|---|
| Slack transport (`slack_*`) | retry within `max_consecutive_failures`; workflow stays `ready` |
| Guard rejections (`state_*`, `version_*`, `illegal_*`, `terminal_*`, `approval_*`, `claim_*`, `in_flight_conflict`) | no retry; the decision was stale or unauthorized. Re-evaluate against current state |
| Capability (`destination_unresolved`, `compatibility_blocked`) | no retry; `waiting_human`. Never substitute another destination or transport (D023, D029) |
| Model/schema (`schema_invalid`, `model_unavailable`) | no action taken; the event is recorded as evaluated with no effect. Exact capture is unaffected |
| Storage (`storage_unavailable`) | no dispatch. If the checkpoint cannot be written, nothing is sent |

The storage row is the ordering guarantee that makes the rest work: **the checkpoint write precedes
the Slack call**. If durable state cannot record the intent to act, the act does not happen. A
process that sends first and records after cannot survive its own crash.

Under every failure class, exact message capture continues (GS-NFR-006). Supervision degrading
never costs the memory layer.

## 7. Where each rule is pinned

| Rule | Pinned by |
|---|---|
| §1 checkpoint shape; `destination_ref` not model-derived | `dispatch.test.ts` |
| §2 both claim keys; one action per event; one in-flight per workflow | `dispatch.test.ts` |
| §3 delivery transition table; `delivered` only on confirmed identity | `dispatch.test.ts` |
| §3 retry convergence to one action and one bot turn | `dispatch.test.ts` |
| §4 failed dispatch leaves the workflow in `ready` | `dispatch.test.ts`, `workflow-state.test.ts` |
| §5 all four reconciliation rows, including the ask-a-human row | `dispatch.test.ts` |
| §6 failure classes are content-free; checkpoint precedes the send | `dispatch.test.ts`, `contract-safety.test.ts` |
