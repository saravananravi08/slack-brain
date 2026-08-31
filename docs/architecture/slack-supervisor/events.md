# Contract — supervisor events, correlation, and serialization

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen); consumers T902, T905
- **Implements:** D024, D026, D028
- **Satisfies:** GS-FR-001, GS-FR-002, GS-FR-003, GS-FR-017, GS-FR-018, GS-FR-019, GS-FR-020, GS-FR-021, GS-FR-032, GS-FR-041, GS-NFR-001, GS-NFR-003

`identity.md` says who may act. This contract says which workflow, if any, an event belongs to, and
in what order events are allowed to touch it.

## 1. `SupervisorEvent`

A **discriminated union** on `source`, not one record with optional halves:

```text
SupervisorEvent = SlackSupervisorEvent | ContinuationEvent
```

The two arrive by different routes, carry different evidence, and enter the pipeline at different
steps. Collapsing them into a single shape would mean every Slack-only field is nullable, and a
nullable `actor_class` is exactly the field a later reader defaults to something safe-looking.

### 1.1 `SlackSupervisorEvent`

Built **from** a persisted channel message; it never re-parses a raw Slack payload and never carries
one.

```text
SlackSupervisorEvent
  contract_version      string
  source                'slack'
  event_key             MessageKey            # workspace_id/channel_id/message_ts, verbatim
  delivery_event_id     string                # Slack envelope event ID, for delivery dedup
  boundary_id           BoundaryId            # ch:<workspace_id>:<channel_id>
  thread_id             ThreadId              # <boundary_id>#<thread_root_ts>
  workspace_id          string
  channel_id            string
  thread_root_ts        string
  message_ts            string                # verbatim; never parsed to a float
  actor_class           ActorClass            # identity.md §1
  actor_id              string                # exact U…/B…/A… of the sender
  is_thread_reply       boolean
  addressed_to_gist     boolean               # syntactic addressing only; never permission
  sent_at               string                # RFC 3339 UTC
```

Every field is required. Deliberately **absent**: message text, file names, link URLs, display
names, and any derived summary. The supervisor decision layer reads content through the bounded
channel-context API (`src/channel-memory/context/`), which already labels it
`untrusted_slack_content`. Workflow state references messages by `event_key`; it never copies them
(GS-NFR-004, D026).

`event_key` is content identity and `delivery_event_id` is delivery identity. Both are required.
This is the same split channel memory uses (CM-INV-05), and the supervisor reuses the durable claims
rather than keeping a second ledger.

### 1.2 `ContinuationEvent`

```text
ContinuationEvent
  contract_version      string
  source                'continuation'
  event_key             ContinuationKey       # cont:<workflow_id>:<continuation_seq>
  workflow_id           string
  continuation_seq      integer >= 1
  origin_event_key      SourceEventKey        # the immediate origin (actions.md §2.1)
  root_message_key      MessageKey            # the Slack message the chain started from
  enqueued_at           timestamp
```

It carries **none** of the Slack-only fields, and that is the point of the union rather than an
omission to be patched later. It has no `actor_class` because no actor produced it; no
`delivery_event_id` because Slack delivered nothing; no `message_ts`, `boundary_id`, or
`thread_root_ts` because it is bound by `workflow_id`, and the workflow record already holds the
one immutable binding (§4.1). Reading the binding from the record rather than copying it onto the
event also means a continuation cannot disagree with its own workflow about where the work lives.

Both halves are content-free, and everything downstream — serialization, the transition audit, the
external-action claim when one is produced — treats them identically. An internal turn must be as
bounded and as replay-safe as a message from the outside.

`SourceEventKey = MessageKey | ContinuationKey` is the union the rest of the set writes against
(`dispatch.md` §1, §2).

## 2. Admission order (GS-FR-001, GS-FR-017, GS-NFR-003)

Fixed, and every step fails closed:

1. **Persist the exact message.** Capture completes first, unconditionally. If capture skipped or
   failed, no supervisor event exists — there is no path that supervises a message Gist did not
   store.
2. **Resolve `ActorClass`** per `identity.md` §1.1, including the human `accept_event` decision for
   human senders. A failed or unavailable authorization lookup yields `unauthorized_human`, never
   `authorized_human`.
3. **Check the boundary.** The event is dropped unless the workspace is the approved workspace, the
   channel is enrolled, the conversation is a channel (never a DM), and the channel is not external
   or Slack-Connect shared. Supervision has no DM surface in this scope.
4. **Route** per the `identity.md` §3 matrix. `capture_only` and `not_captured` stop here.
5. **Deduplicate.** A repeated `delivery_event_id`, or a second delivery of the same `event_key`
   already processed by the supervisor, stops here (§6).
6. **Correlate** to a workflow binding (§4).
7. **Serialize** on the correlated workflow, or on the channel when there is none (§5).
8. **Evaluate**, producing exactly one action from the `actions.md` §1 union, which may be
   `no_action`.

Steps 1–5 are pure policy over the record and the durable ledger. No model call happens before
step 8, so an unauthorized, unknown, duplicate, or uncorrelated event costs no model call and can
produce no outward effect.

### 2.1 Continuations enter at step 6

A `ContinuationEvent` (§1.2, `actions.md` §2.1) is created by the runtime from a committed
transition, not received from Slack. Steps 1–4 have nothing to decide for it, and the union in §1 is
why: it has no message to persist, no sender to classify, no boundary to check beyond the binding it
was born with, and no actor to route. Those steps do not merely skip — there is no field for them to
read. It therefore enters the pipeline at **step 6**, and runs steps 6, 7, and 8 in full:

- **Correlate** — it names its workflow directly. The §4.2 checks that concern a *sender*
  (checks 4 and 5) do not apply; the checks that concern the *binding* are satisfied by
  construction, because the continuation was written in the same commit as the transition.
- **Serialize** — on its workflow, in the same queue as Slack events, and it re-reads durable state
  and re-checks limits after the queue exactly as §5 rule 2 requires. A continuation enqueued
  before a human cancelled the workflow finds the cancellation when it runs, and does nothing.
- **Evaluate** — producing at most one action, under its own claim.

Deduplication (step 5) is not skipped so much as relocated, and it protects a different thing.
Continuation processing is **at-least-once**: a crash can cause one to be evaluated twice
(`actions.md` §2.4). What is deduplicated is the *effect*, by the transition compare-and-set on the
continuation's `event_key` and by the external-action claim if it posts. A continuation may
legitimately produce no externally visible action at all — `draft → ready` is silent — so neither
claim alone decides whether it has been handled; its durable processing state does.

Continuations are the **only** events that may enter below step 4. Nothing received from Slack can
take this path, and a continuation can never be constructed from a Slack message, from bot content,
or from model output (`actions.md` §2.3).

## 3. Evaluation eligibility (GS-FR-002, GS-FR-003, D024)

| Event | Reaches evaluation | Why |
|---|---|---|
| `authorized_human`, addressed to Gist | always | GS-FR-002 |
| `authorized_human`, in a thread bound to a non-terminal workflow | always | GS-FR-002 — a workflow thread is an active conversation regardless of addressing |
| `authorized_human`, unaddressed, no active workflow in the thread | subject to the existing proactive gate | GS-FR-003; may yield `no_action`, ordinary assistance, or a new work-intent candidate |
| `kilo` / `linear` | always, via the automation path | GS-FR-017; may yield `no_action` |
| `gist_self` | never | GS-FR-040 |
| `unauthorized_human`, `unknown_automation`, `system` | never | `identity.md` §3 |
| a `continuation` | always, on its own workflow | `actions.md` §2.1; it exists precisely to be evaluated, and may yield `no_action` |

Row 2 is the one that must not be lost in implementation: **an active workflow thread does not
depend on proactive relevance classification or on the channel cooldown** (GS-FR-002, GS-FR-021).
The existing proactive gate in `src/mastra/channels/proactive.ts` governs unsolicited channel
commentary only. §5 states the separation as a rule.

Evaluation returning `no_action` is a normal, expected outcome for every eligible row. "Evaluated"
and "answered" are different words in this set on purpose.

## 4. Workflow correlation (GS-FR-018, GS-FR-019, GS-FR-032)

### 4.1 The binding

A workflow binds to exactly one tuple, fixed at creation and immutable for the workflow's life:

```text
WorkflowBinding = (workspace_id, channel_id, thread_root_ts, owner_user_id, workflow_id)
```

"One workflow, one Slack thread" (PRD §6.3). A thread holds **at most one non-terminal workflow**.
An attempt to create a second non-terminal workflow in a thread that already has one is refused;
the human is asked to finish, cancel, or move the existing one. This is a contract rule rather than
a convenience: two live workflows in one thread makes every subsequent bot reply ambiguous, and
ambiguity here means dispatching the wrong instruction.

### 4.2 Matching a trusted bot event (GS-FR-018)

A `kilo` or `linear` event may advance a workflow only when **all five** hold:

1. `event.workspace_id` equals the binding's workspace.
2. `event.channel_id` equals the binding's channel.
3. `event.thread_root_ts` equals the binding's thread root.
4. `event.actor_class` equals the workflow's current `expected_actor`.
5. The workflow's current `state` accepts an event from that actor (`workflow-state.md` §3).

All five, evaluated against **durable workflow state read at correlation time**. Not four; not
"thread matches and the bot looks right". A Linear reply arriving in a thread whose workflow expects
Kilo fails check 4 and advances nothing, even though the thread is correct — which is exactly PRD
acceptance scenario 6 (interleaved Kilo and Linear replies in one thread).

Correlation is by **durable binding first**. A workflow marker echoed in a bot's reply
(`actions.md` §5) is a *secondary* confirmation used to match a reply to a specific dispatched
action version; it is never sufficient on its own, because marker text is content and content is
attacker-influenced (`identity.md` §4). `compatibility.md` §3 records which of the two signals
T802 must prove is available for each bot, and the fallback when threads alone are not enough.

### 4.3 Unmatched trusted bot events (GS-FR-019)

A trusted bot event that fails any of the five checks:

- is already persisted and remains full channel context;
- **may** be evaluated for a notification — for example, telling the owner that Kilo replied in a
  thread the supervisor is not driving;
- **may not** create a workflow, mutate any workflow record, advance state, produce a dispatch,
  refresh an approval, or reset a limit counter.

The permitted outcome set for an unmatched trusted event is exactly
`{ no_action, reply_user }`, and `reply_user` here carries no workflow ID.

### 4.4 Wrong-boundary events

Wrong workspace, wrong channel, wrong thread, a DM, an external/shared channel, and a Gist echo all
resolve to "no workflow matched" and produce no state change. They are distinct **reason classes**
for logging (§7) so a misrouting shows up as a count rather than as silence, but they share one
outcome: nothing moves (GS-NFR-001).

## 5. Serialization and cooldown separation (GS-FR-021, GS-FR-041, D028)

**Rule 1 — per-workflow serialization.** Events correlated to the same `workflow_id` are processed
one at a time, in arrival order. Concurrent trusted bot replies for one workflow do not interleave.
Continuations share that queue rather than running beside it: an internal turn racing a bot reply
would reintroduce exactly the interleaving this rule exists to remove.

**Rule 2 — recheck after the queue.** Serialization alone is not enough: an event that waited in the
queue must **re-read** durable workflow state and re-run the §4.2 checks before acting. State may
have changed while it waited — a human may have cancelled, an approval may have expired, a limit
may have been reached. A queued event acting on the state it saw on arrival is a stale-state write,
and GS-FR-041 exists to forbid exactly that.

**Rule 3 — the cooldown never applies to workflow events.** The proactive channel cooldown may
never drop, delay, or suppress an event correlated to a non-terminal workflow. The two mechanisms
have different jobs: the cooldown limits *unsolicited commentary*; workflow limits
(`workflow-state.md` §7) bound *supervised work*. A valid workflow continuation being dropped by a
commentary rate limiter is a correctness bug, not conservative behavior.

**Rule 4 — uncorrelated events keep the existing channel behavior.** An event with no workflow match
is queued per channel exactly as the current runtime already does, and the proactive gate and
cooldown continue to apply to it unchanged.

**Rule 5 — one in-flight action per workflow.** At most one action per workflow may be in a
non-terminal delivery state at any time (`dispatch.md` §2). Serialization gives ordering; this gives
the invariant that ordering is meant to protect.

Under GS-NFR-008 (single process) rules 1 and 5 are an in-process queue plus a durable
compare-and-set. The compare-and-set is what survives restart; the queue only makes the common case
orderly.

## 6. Duplicates, retries, and echoes (GS-FR-020)

| Case | Detected by | Outcome |
|---|---|---|
| Slack retry of one delivery | repeated `delivery_event_id` | dropped before correlation; zero actions |
| Second envelope for one message | `event_key` already supervised | dropped before correlation; zero actions |
| Replayed bot completion message | `event_key` already supervised | dropped; the workflow does not re-complete |
| Bot repeats an equivalent status in a **new** message | new `event_key`; state check in §4.2 rule 5 | correlates, but the transition is a no-op if it does not change state; no second dispatch |
| Gist's own echo of an instruction it sent | `actor_class === 'gist_self'` | never evaluated (GS-FR-040) |
| Restart mid-processing | durable claim already held | not re-evaluated; `dispatch.md` §5 reconciles the action |

The last two rows are the loop-prevention core. Gist's outgoing instruction is persisted directly
by the send path and also arrives as a Slack echo; both are `gist_self` and neither is ever
evaluated, so an instruction cannot trigger the supervisor that wrote it.

Duplicate suppression is **durable** and survives restart, and it is keyed on identity, never on
content. Two genuinely distinct bot messages with identical text are two events.

## 7. Observability (GS-NFR-004, GS-NFR-005)

Every dropped or uncorrelated event is counted by reason class. The legal reason classes are:

```text
not_captured | unauthorized_human | unknown_automation | gist_self |
wrong_workspace | unenrolled_channel | external_channel | direct_message |
duplicate_delivery | duplicate_event | no_workflow_match | actor_mismatch |
state_rejects_actor | terminal_workflow | limit_reached |
continuation_superseded | continuation_already_processed
```

The last two are continuation outcomes: `continuation_superseded` when the workflow left the state
the continuation was enqueued for, and `continuation_already_processed` when a replay after restart
finds the claim already held.

Every one of these strings is safe to log. A supervisor log line may carry `workflow_id`,
`action_id`, prior and new state, event class, action class, outcome, reason class, and a coarse
timestamp. It may never carry message text, a display name, a file name, a link URL, a prompt,
model output, a raw payload, or a credential.

## 8. Where each rule is pinned

| Rule | Pinned by |
|---|---|
| §1 the `slack` / `continuation` union; no Slack-only field on a continuation | `events.test.ts`, `continuation.test.ts` |
| §1.1 Slack record shape; no content fields | `events.test.ts` |
| §2 admission order; fail-closed steps | `events.test.ts` |
| §2.1 continuations enter at step 6 and nothing else may | `continuation.test.ts` |
| §3 eligibility table, including the active-thread row | `events.test.ts` |
| §4.2 all five correlation checks, each failing independently | `events.test.ts` |
| §4.3 unmatched trusted event outcome set | `events.test.ts` |
| §5 serialization, recheck-after-queue, cooldown separation | `events.test.ts`, `dispatch.test.ts` |
| §6 duplicate/retry/echo/restart table | `events.test.ts`, `dispatch.test.ts` |
| §7 reason classes are content-free | `contract-safety.test.ts` |
