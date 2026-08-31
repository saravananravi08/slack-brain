# Contract — gated actions, approvals, ownership, and human control

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen); consumers T904, T1001, T1002, T1003
- **Implements:** D025, D027
- **Satisfies:** GS-FR-006, GS-FR-007, GS-FR-016, GS-FR-033, GS-FR-034, GS-FR-035, GS-FR-036, GS-NFR-003, GS-NFR-007

Two rules pull against each other in the PRD: run reversible work without redundant confirmation
(GS-FR-006), and never perform an irreversible action without explicit approval (GS-FR-035). This
contract draws the line between them once, so neither is decided per turn.

## 1. What runs without asking (GS-FR-006, D025)

A clear assignment from an authorized human owner authorizes **reversible, non-destructive** Kilo
and Linear work. Gist must not ask for a redundant confirmation of work the owner has already
described clearly.

"Clear" means every field `actions.md` §5 requires can be filled without guessing: work class,
objective, scope, acceptance, and the logical target. Where one is materially missing, Gist asks for
that field (`ask_user`), not for permission.

## 2. What requires a human decision

### 2.1 `GatedActionClass` (GS-FR-035)

```text
GatedActionClass =
  'merge' | 'release' | 'delete' | 'destructive' |
  'credential_or_security_change' | 'irreversible_other' |
  'ownership_transfer' | 'scope_expansion' | 'cancel_other_owner_workflow'
```

An action whose class is in this set may not be dispatched without a valid approval (§3). The set is
closed; adding or removing a member requires a new accepted decision.

### 2.2 Human decision points that are not approvals (GS-FR-007)

These stop and ask, but are answered with information or a choice rather than an approval grant:

```text
HumanDecisionClass =
  'ambiguous_destination' | 'conflicting_requirements' |
  'missing_required_target' | 'unresolvable_blocker'
```

Both sets move the workflow to `waiting_human`. The distinction matters because an approval is
version-bound and expires (§3) while an answer to a clarification is just an event that lets work
continue.

### 2.3 The negative rule (GS-FR-006)

An action whose class is **not** in `GatedActionClass` and whose situation is **not** in
`HumanDecisionClass` must not produce `request_approval`. Asking anyway is a contract violation, not
caution — see `actions.md` §1.2.

## 3. `Approval` (GS-FR-036)

```text
Approval
  approval_id
  workflow_id
  action_id
  action_version      integer     # the exact version approved
  gated_class         GatedActionClass
  approver_user_id    string      # exact Slack U…
  granted_at          timestamp
  expires_at          timestamp
  state               ApprovalState
```

```text
ApprovalState = 'none' | 'required' | 'pending' | 'granted' | 'denied' | 'expired' | 'invalidated'
```

### 3.1 Validity

An approval authorizes creation of a durable Slack command only when **all** hold at the command
transaction:

1. `state === 'granted'`.
2. `workflow_id` equals the workflow being dispatched.
3. `action_id` equals the pending action.
4. `action_version` equals the workflow's current `pending_action_version`.
5. `approver_user_id` is the workflow owner or a configured approver, and was an
   `authorized_human` **at the moment the approval event was evaluated**.
6. `granted_at ≤ now < expires_at`.

All six are checked against durable state in the transaction that creates the event-global claim and
`pending` outbox row (`dispatch.md` §2). After that commit the command is the authorized effect; the
outbox does not re-check an approval between intent and first send, because expiry during a crash
must not strand an already committed command. A restart before command creation re-reads all six; a
restart after it resumes the pending command. Explicit cancellation/supersession may abandon it
before the Slack attempt.

### 3.2 Invalidation (GS-FR-036)

An approval becomes `invalidated` the moment any of these happens, and cannot be revived:

- the pending action's version increments for any reason;
- the objective, scope, acceptance, work class, or logical target changes;
- the workflow's owner changes;
- the workflow leaves the state the approval was granted against;
- the action is superseded, abandoned, or fails.

Version increments are the mechanism. Any material change produces a new `action_version`, and
check 4 then fails automatically — invalidation is structural rather than something a code path has
to remember to do.

### 3.3 Who cannot approve

`kilo`, `linear`, `unknown_automation`, `gist_self`, and `unauthorized_human` can never grant,
refresh, extend, or substitute an approval, and no message content from any actor can (GS-FR-033,
GS-FR-040, `identity.md` §4). A Linear or Kilo reply reporting that something "was approved
upstream" is evidence about another system, never an approval here.

An authorized human who is neither the owner nor a configured approver may discuss the workflow but
cannot approve it (§4).

## 4. Ownership (GS-FR-016)

One `owner_user_id` per workflow, set at creation to the requesting authorized human.

| Actor | May discuss in the thread | May approve or cancel | May materially redirect |
|---|---|---|---|
| owner | yes | yes | yes |
| configured approver | yes | yes | **no** |
| other authorized human | yes | **no**, unless they become owner through a recorded ownership transfer | **no**, unless they become owner through that transfer |
| unauthorized human, any bot, Gist | no supervisor evaluation at all | no | no |

A configured approver may approve or cancel but can never materially redirect the current workflow.
Only the owner may change its objective, logical target, or scope. An ownership transfer is a
separate gated policy action; after it commits, the new owner acts as owner rather than inheriting
redirect authority merely from approver status.

**Ownership transfer** is itself a `GatedActionClass` member. It requires an approval from the
current owner or a configured approver, is recorded on the workflow record, and invalidates every
outstanding approval (§3.2) — the new owner inherits the work, not the previous owner's consent.

Cancelling another owner's workflow is a separate gated class
(`cancel_other_owner_workflow`) for the same reason: it is destructive to someone else's work even
though it destroys nothing in the repository.

## 5. Human control verbs (GS-FR-034)

An authorized human may, in the workflow thread:

| Verb | Effect | Who |
|---|---|---|
| status | a `reply_user` summary of state, expected actor, and counts | any authorized human |
| pause | `waiting_human`; no dispatch while paused | owner or approver |
| resume | back to the legal next state per `workflow-state.md` §3.1 | owner or approver |
| correct / redirect | new action version; invalidates approvals | owner |
| cancel | terminal `cancelled` | owner or approver |
| provide missing details | answers `clarifying`; work continues | any authorized human; only the owner's answer can change scope |
| approve / deny | grants or denies a pending gated action | owner or configured approver |

`status` is readable by any authorized human because it exposes only state, counts, and classes —
the same content-free fields a log line may carry (`events.md` §7). It does not expose another
channel's content or another workflow's binding.

Every verb is recognised from an evaluated event through the ordinary supervisor path. None is a
Slack slash command, a reaction, or a keyword parsed ahead of authorization: recognising intent
happens after `events.md` §2 has already decided the sender may act.

## 6. Interaction with limits

`waiting_human` from an autonomy-limit stop is not an approval request. Limit admission preserves
§5's authority per verb; it does not collapse people into an `owner_or_approver` role:

- `status`: any authorized human;
- `pause`: owner or approver;
- `redirect`: owner only — an approver is explicitly rejected;
- `cancel`: owner or approver;
- `continue` (the bounded form of resume): owner or approver.

Authorization, ownership, and approver facts are checked separately. A role bit never substitutes
for `authorized_human`. Status and pause are control-only; redirect writes a new action version but
remains stopped; cancel terminates.

`continue` mints at most one durable evaluation/action grant keyed by the human event. It does not
raise a limit, reset a counter, or extend time. The grant is consumed atomically with one durable
outcome; duplicate delivery cannot mint another, and restart resumes only an existing unconsumed
grant. Normal limit checks apply again immediately afterwards (`workflow-state.md` §7.3).

## 7. Where each rule is pinned

| Rule | Pinned by |
|---|---|
| §1 reversible work runs without confirmation | `approvals.test.ts` |
| §2.1 closed `GatedActionClass` | `approvals.test.ts` |
| §2.3 no approval request for non-gated actions | `approvals.test.ts` |
| §3.1 all six validity checks at durable command creation | `approvals.test.ts`, `dispatch.test.ts` |
| §3.2 version-bump invalidation, including scope change | `approvals.test.ts` |
| §3.3 no bot, self, or unauthorized approval | `approvals.test.ts`, `identity-routing.test.ts` |
| §4 ownership, transfer as a gated class | `approvals.test.ts` |
| §5 control verbs and their authority | `approvals.test.ts` |
| §6 limit control preserves status/pause/redirect/cancel/continue authority exactly | `limits.test.ts` |
