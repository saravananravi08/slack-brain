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
  source_event_key     SourceEventKey    # the one event that justifies this action (§2)
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

`SourceEventKey` is either a Slack `MessageKey` or a continuation key
(`cont:<workflow_id>:<continuation_seq>`, `actions.md` §2.1). Both are durable identities that
survive restart, which is what lets §2's claim treat them identically.

## 2. One event, at most one durable external action (GS-FR-024)

Two durable claims, both taken **before** anything leaves the process:

```text
ActionClaimKey   = "ev:<source_event_key>"
DispatchClaimKey = "wf:<workflow_id>|act:<action_id>|v:<version>|n:<attempt>"
```

**`ActionClaimKey` is keyed on the source event alone.** The workflow is recorded on the claim as
metadata for audit, but it is **not** part of the key. A second attempt to create an externally
visible action for the same `source_event_key` fails the claim and is refused. This is the literal
statement of GS-FR-024: one event, at most one externally visible action, and the claim commits
before the action becomes visible.

Event-global rather than per-workflow, for a reason that a workflow-scoped key gets wrong. Two of
the externally visible actions carry **no** `workflow_id` at all — an unmatched trusted-bot
notification (`events.md` §4.3) and ordinary assistance outside any workflow (`actions.md` §2).
A key containing the workflow would have had nothing to put there, and every unbound reply would
have fallen outside the invariant it is supposed to obey: a retried delivery of an unmatched bot
message could produce two notifications, and GS-FR-024 would hold only for the bound half of the
traffic. Keying on the event covers bound and unbound uniformly.

It is also strictly stronger than the per-workflow form and costs nothing, because one event can
correlate to at most one workflow: a thread holds at most one non-terminal workflow
(`events.md` §4.1), so there is no case where a single event legitimately needs to act on two.

The `source_event_key` may be a Slack `MessageKey` or a continuation's
`cont:<workflow_id>:<continuation_seq>` (`actions.md` §2.1). Both are durable event identities, so a
continuation that *does* produce an externally visible action is bounded by exactly the same claim
as a Slack event.

It is not, however, what marks a continuation **processed**: a silent continuation takes no action
claim at all, so replay protection for the internal turn is the separate consumption claim in
`actions.md` §2.4.

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
| `in_flight` | `failed` | the attempt returned a **definitive non-delivery** result (§3.1) |
| `in_flight` | `in_flight` | the attempt's outcome is **indeterminate**; nothing moves (§3.2) |
| `in_flight` | `abandoned` | reconciliation proved nothing was delivered and the action was superseded (§5) |
| `failed` | `pending` | a retry is permitted and a new attempt begins (§3.3) |
| `failed` | `abandoned` | retries exhausted, or the workflow moved on |
| `delivered` | — | terminal; a delivered action is never re-sent |

`delivered` is set **only** from a Slack response carrying the outgoing message identity. Not from
a timeout that "probably" succeeded, not from an absence of error. `slack_message_key` is set in the
same commit, which is what lets a later reply be matched to the action that caused it.

### 3.1 `DeliveryOutcome` — three answers, not two

Every attempt resolves to exactly one of:

```text
DeliveryOutcome = 'delivered' | 'definitive_failure' | 'indeterminate'
```

| Outcome | Meaning | Next `DeliveryState` |
|---|---|---|
| `delivered` | Slack returned the outgoing message identity | `delivered` |
| `definitive_failure` | Slack **rejected the post before accepting it**, so it provably was not published | `failed` |
| `indeterminate` | the attempt neither confirmed nor disproved publication | stays `in_flight` |

The split is by error class, because "an error occurred" is not the same claim as "nothing was
posted":

```text
DEFINITIVE_NON_DELIVERY = {
  slack_permission_denied,     # the API refused the call
  slack_rate_limited,          # 429 before the post was accepted
  slack_invalid_request,       # the request was rejected as malformed
  destination_unresolved,      # no destination was ever resolved
}
```

Everything else is `indeterminate`: a transport error (`slack_transport_error`), a timeout, a
connection lost mid-request, and — importantly — a response that carries no identity, no error, and
no timeout. A request whose reply never arrived may well have been received and published.

### 3.2 An indeterminate outcome never retries (GS-INV-12)

This is the rule that makes GS-FR-043 true rather than approximately true. On `indeterminate`:

1. The checkpoint **stays `in_flight`**. It is not marked failed, and no retry is scheduled.
2. Reconciliation (§5) runs immediately against the same evidence a restart would use.
3. If reconciliation finds **positive evidence of delivery**, the action becomes `delivered` and the
   workflow advances normally.
4. Otherwise — including when the thread is readable and the instruction is simply not in it — the
   checkpoint stays `in_flight`, the workflow moves to `waiting_human` with
   `dispatch_unreconciled`, and **no further send occurs**. Absence is not proof (§5).

The earlier reading of this contract mapped a timeout straight to `failed` and let `failed → pending`
retry from there. That was a duplicate-dispatch path in plain sight: a slow Slack post that
eventually succeeded would have been retried while it was still in flight, and the far end would
have received one instruction twice. For a coding bot that is a duplicate pull request, and for
Linear a duplicate work item — precisely the outcome `compatibility.md` §4 rule 5 refuses to accept
from a bot. Gist must not create it itself.

Asking a human is the correct answer when the alternative is guessing whether an external
instruction was already delivered. It is also the cheap answer: the cost of asking is one message,
and the cost of guessing wrong is duplicated work nobody asked for.

### 3.3 Retry is permitted only after a definitive failure

`failed → pending` requires all of:

1. the checkpoint's `delivery_state` is `failed`, which by §3.1 can only have been set by a
   **definitive pre-acceptance rejection** from Slack;
2. `consecutive_failures < max_consecutive_failures`;
3. the workflow is still `ready` and non-terminal.

There is no other route to `failed`, and therefore no route from an ambiguous attempt to a second
send at all. Reconciliation can promote an action to `delivered`; it can never demote one to
`failed` (§5).

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

## 5. Reconciliation (GS-FR-015, GS-NFR-002)

One mechanism, two callers. It runs **inline** whenever an attempt returns `indeterminate` (§3.2),
and again **at startup** for every checkpoint left in `pending` or `in_flight`, before the workflow
accepts new events. Using the same function for both is deliberate: a timeout mid-run and a crash
mid-send leave exactly the same question behind, and answering it two different ways is how the two
paths drift apart.

**Reconciliation is one-directional: it can only find evidence *of* delivery.** It never concludes
non-delivery, and it never produces a state a retry can start from.

| Found state | Evidence | Result |
|---|---|---|
| `pending`, no claim consumed | the send never started | → `abandoned`; workflow stays `ready`; no failure counted |
| `in_flight`, Gist's own outgoing record exists for this action | positive: it was delivered | → `delivered`; workflow advances normally |
| `in_flight`, an outgoing message with this action's `workflow_marker` exists in the bound thread | positive: it was delivered | → `delivered`; workflow advances normally |
| `in_flight`, no such evidence — whether or not the thread reads cleanly | **inconclusive** | → left `in_flight`; workflow → `waiting_human`, reason `dispatch_unreconciled`; **no send** |

Reconciliation reads Gist's **own** outgoing message record first — the send path persists
outgoing messages directly, so the local record is authoritative and does not depend on Slack echo
behavior. The thread scan is the fallback when the local record is absent because the process died
between the Slack call and the local write.

### 5.1 Absence is not proof of non-delivery

An earlier reading of this contract treated "the thread is readable and the instruction is not in
it" as proof that nothing was published, and let a retry start from there. That is not sound, and
the reason is ordinary rather than exotic: a Slack post can be accepted and still not be visible to
us yet. Delivery of the corresponding event can lag, `conversations.history` can be behind, our own
capture path can be mid-write, and a rate-limited read can return a short page. Every one of those
looks exactly like "it was never sent" at the moment we look.

Getting this wrong costs the invariant the whole section exists for. If absence licensed a retry,
then a post that landed while we were reading would be sent twice, and GS-INV-12 — restart and retry
cannot duplicate a dispatch — would hold only when the timing happened to cooperate. A duplicate
instruction to a coding bot is a duplicate pull request; to Linear, a duplicate work item.

So the asymmetry is deliberate: **positive evidence advances the workflow; the absence of evidence
stops it.** The two are not symmetric claims and the contract does not treat them as such.

The last row is therefore the honest one. It does not mark the action `failed`, because that would
make it retryable and nothing established a failure; it does not mark it `delivered`, because
nothing established that either; and it does not `abandon` it, because the instruction may be live
at the far end and the human deserves to hear about a real possibility rather than a tidy fiction.
`in_flight` is where the checkpoint stays, and a person decides what to do next.

The `thread_readable` observation is still recorded — it is useful evidence in an audit — but it no
longer changes the outcome.

**Recovery replays state, not effects.** No confirmed-delivered instruction is re-sent, and no
committed transition is re-applied.

## 6. `FailureClass` (GS-NFR-006)

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

Every value is a class, safe to log, and names nothing about content, channel, or person.

Fail-closed behavior by group:

| Group | Behavior |
|---|---|
| Definitive non-delivery (`slack_rate_limited`, `slack_permission_denied`, `slack_invalid_request`) | retry within `max_consecutive_failures`; workflow stays `ready` |
| Ambiguous transport (`slack_transport_error`) | **no retry from the failure itself.** The outcome is `indeterminate`, so the checkpoint stays `in_flight` and §5 reconciles it. A retry happens only if reconciliation proves non-delivery |
| Guard rejections (`state_*`, `version_*`, `illegal_*`, `terminal_*`, `approval_*`, `claim_*`, `in_flight_conflict`) | no retry; the decision was stale or unauthorized. Re-evaluate against current state |
| Capability (`destination_unresolved`, `compatibility_blocked`) | no retry; `waiting_human`. Never substitute another destination or transport (D023, D029) |
| Model/schema (`schema_invalid`, `runtime_controlled_field_present`, `model_unavailable`) | no action taken; the event is recorded as evaluated with no effect. Exact capture is unaffected |
| Storage (`storage_unavailable`) | no dispatch. If the checkpoint cannot be written, nothing is sent |
| Unresolvable (`dispatch_unreconciled`) | no retry and no send; `waiting_human` (§3.2) |

`slack_transport_error` moving out of the retryable group is the whole of fix 3. It reads like a
transport hiccup and it is the one error class that cannot tell you whether the post landed.

The storage row is the ordering guarantee that makes the rest work: **the checkpoint write precedes
the Slack call**. If durable state cannot record the intent to act, the act does not happen. A
process that sends first and records after cannot survive its own crash.

Under every failure class, exact message capture continues (GS-NFR-006). Supervision degrading
never costs the memory layer.

## 7. Where each rule is pinned

| Rule | Pinned by |
|---|---|
| §1 checkpoint shape; `destination_ref` not model-derived | `dispatch.test.ts` |
| §2 the event-global action claim; bound and unbound alike | `dispatch.test.ts` |
| §2 a continuation is claimed like any source event | `dispatch.test.ts`, `continuation.test.ts` |
| §2 one in-flight action per workflow | `dispatch.test.ts` |
| §3 delivery transition table; `delivered` only on confirmed identity | `dispatch.test.ts` |
| §3.1 the definitive / indeterminate split, per error class | `dispatch.test.ts` |
| §3.2 an indeterminate outcome never retries and never re-sends | `dispatch.test.ts` |
| §3.3 retry only after a definitive failure or proven non-delivery | `dispatch.test.ts` |
| §3 retry convergence to one action and one bot turn | `dispatch.test.ts` |
| §4 failed dispatch leaves the workflow in `ready` | `dispatch.test.ts`, `workflow-state.test.ts` |
| §5 all four reconciliation rows, inline and at restart | `dispatch.test.ts` |
| §5.1 absence never yields `failed` and never permits a resend | `dispatch.test.ts` |
| §6 failure classes are content-free; checkpoint precedes the send | `dispatch.test.ts`, `contract-safety.test.ts` |
