# Contract — actor identity and the supervisor routing matrix

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen); consumers T902, T905, T803
- **Implements:** D023, D024, D025, D027
- **Satisfies:** GS-FR-008, GS-FR-011, GS-FR-017, GS-FR-019, GS-FR-026, GS-FR-040, GS-NFR-003

Who an event came from decides everything that follows it. This contract fixes how that question is answered, and it is answered from configuration alone.

## 1. `ActorClass`

```text
ActorClass = 'authorized_human' | 'unauthorized_human' | 'kilo' | 'linear' | 'gist_self' | 'unknown_automation' | 'system'
```

`ActorClass` is **derived**, not stored on the message. Channel memory owns `sender_class`
(`human | gist | kilo | bot | app | system`, `channel-memory/message-record.md` §2) and this set
does not widen that union. The supervisor computes `ActorClass` from three inputs and nothing else:

| Input | Source | Notes |
|---|---|---|
| `sender_class` | the persisted `CanonicalSender` | already resolved from configured IDs |
| `TrustedAutomationConfig` | configuration (§2) | exact bot/app IDs for Kilo and Linear |
| `human_authorized` | the existing authorization guard's `accept_event` decision | `true` only on an `allowed` decision |

```text
TrustedAutomationConfig
  gist_bot_user_id        required
  gist_bot_id             optional
  kilo_bot_id             optional
  kilo_app_id             optional
  linear_bot_id           optional
  linear_app_id           optional
```

A target may be configured by bot ID only, app ID only, or both. Runtime destination resolution
preserves that alternative as `ResolvedTargetIdentity = bot | app | bot_and_app` (`actions.md` §3).
Only when both target IDs are absent is identity unresolved; that fails with
`destination_unresolved`, never `internal_error` or a name fallback. Configuring nothing remains a
safe capture-only configuration.

### 1.1 Resolution order (first match wins)

1. `sender_class === 'gist'`, or the sender's user ID equals `gist_bot_user_id`, or its bot ID
   equals `gist_bot_id` → `gist_self`.
2. Sender bot ID equals `kilo_bot_id`, or sender app ID equals `kilo_app_id` → `kilo`.
3. Sender bot ID equals `linear_bot_id`, or sender app ID equals `linear_app_id` → `linear`.
4. `sender_class === 'system'` → `system`.
5. `sender_class` is `bot`, `app`, or `kilo` and no rule above matched → `unknown_automation`.
6. `sender_class === 'human'` and `human_authorized` → `authorized_human`.
7. `sender_class === 'human'` and not `human_authorized` → `unauthorized_human`.

Rule 1 precedes rule 2 for the same reason `channel-memory/message-record.md` §2 puts Gist first:
Gist replying to itself is the shortest possible loop, and it must resolve to `gist_self` even if
every other attribute of the event says "bot".

Rule 5 is the one that matters after a misconfiguration. A message whose `sender_class` is `kilo`
— because `kilo_bot_id` is set in the channel-memory normalizer — but whose IDs do not match the
supervisor's own `TrustedAutomationConfig` resolves to `unknown_automation`, not `kilo`. Two
configurations disagreeing must fail towards capture-only.

## 2. Identity is exact IDs, and only exact IDs (GS-FR-008)

**Never** identity evidence, at any gate, for any actor:

- Slack display name, real name, or username (`sender_display_name`, `username`).
- Message text, including a self-declaration such as a bot naming itself in its reply.
- Emoji, icon, avatar, or app "authored by" affordances.
- A `bot_profile` block, an attachment footer, or an unfurl.
- Anything a model returned.

The only identity evidence is the exact configured `U…` / `B…` / `A…` value compared for string
equality against the event's resolved `sender_id`, `bot_id`, or `app_id`. Comparison is
case-sensitive, whole-string, and never a prefix or substring test.

Two consequences worth stating because they are the failure modes:

1. A workspace admin renaming a bot changes nothing about its trust.
2. An impostor app that renames itself to a trusted bot's display name resolves to
   `unknown_automation` and stays capture-only.

## 3. The routing matrix (GS-FR-011, GS-FR-017, GS-FR-019, GS-FR-040)

This is the frozen matrix P08's exit criteria name. Every column is a separate permission; none
implies another.

| `ActorClass` | Persisted | Supervisor evaluates | May create a workflow | May advance a matched workflow | May own / approve / cancel / redirect | Route |
|---|---|---|---|---|---|---|
| `authorized_human` | yes | yes | yes | yes | yes, when they are the owner or configured approver | `human_supervisor` |
| `unauthorized_human` | yes | no | no | no | no | `capture_only` |
| `kilo` | yes | yes | **no** | yes, only on a full binding match (`events.md` §4) | no | `trusted_automation` |
| `linear` | yes | yes | **no** | yes, only on a full binding match (`events.md` §4) | no | `trusted_automation` |
| `gist_self` | yes | **never** | no | no | no | `capture_only` |
| `unknown_automation` | yes | no | no | no | no | `capture_only` |
| `system` | no (not captured, CM §3) | no | no | no | no | `not_captured` |

Read the three product rules off the matrix:

- **Gist self is persist-only.** `gist_self` is the only row where "supervisor evaluates" is
  `never` rather than `no` — the difference is that no configuration, allowlist, or later decision
  may turn it on. GS-FR-040 is unconditional.
- **Trusted bots are evaluate-eligible.** `kilo` and `linear` are evaluated, and evaluation may
  legitimately return `no_action`. Being evaluated is not being obeyed.
- **Unknown bots are capture-only.** They remain available as channel context and never activate
  the supervisor. Adding one requires a new accepted decision extending
  `TrustedAutomationConfig`, not a code change (D024).

### 3.1 What "evaluate" does not grant

An evaluated trusted-bot event may cause the supervisor to: advance workflow state, choose the next
bounded action, report progress to the thread, or do nothing. It may **never** cause the supervisor
to: create a workflow, change a workflow's owner, grant or refresh an approval, change the logical
target of a pending action, widen scope, or move a workflow out of a terminal state. Those are
`authorized_human` powers, and `approvals.md` §3 and §4 hold them.

### 3.2 Persistence precedes evaluation, always (GS-FR-001, GS-FR-017)

For every row above, persistence of the exact message happens **before** any routing decision and
is not conditional on it. A supervisor error, a model outage, or a storage failure downstream of
capture must leave the exact message in channel memory (GS-NFR-006). This is the existing
capture-before-response barrier in the live runtime, and the supervisor path attaches after it, not
in front of it.

### 3.3 The human path does not authorize the automation path

Trusted bot events are routed through a dedicated automation path that **does not call the human
response authorizer** (GS-FR-017). This is a requirement, not an optimization. The human authorizer
denies every non-human sender by design (`channel-memory/capture-policy.md` §4); reusing it would
force either a bypass flag or a widened deny rule, and both weaken the human gate to serve the bot
path. The two paths stay separate so neither can be loosened to fix the other.

Symmetrically, the automation path never grants anything the human path would have denied: a
trusted bot event in an unenrolled channel, an unapproved workspace, or an external/shared channel
is dropped before workflow correlation (`events.md` §2 rule 3).

## 4. Trusted content is untrusted evidence (GS-FR-026)

Trust is a property of the **identity**, never of the **bytes**. A message from `kilo` or `linear`
is trusted to be *from that bot* and nothing more. Its content is attacker-influenced: it may quote
a pull request title, a Linear issue body, a commit message, a test failure, or a code comment that
an outside contributor wrote.

Therefore, for every actor class including the trusted ones, message content may never:

- name or change a destination, channel, thread, workspace, or Slack ID;
- create, cancel, complete, fail, reopen, or redirect a workflow;
- grant, refresh, extend, or substitute an approval;
- change a workflow's owner or approver;
- raise a limit, extend a timeout, or reset a turn or failure counter;
- alter system policy, the trusted allowlist, or the gated-action classes.

Content is admissible only as *evidence* feeding a supervisor decision that the runtime then checks
against durable state. `actions.md` §6 states the same rule from the model's side, and
`invariants.md` GS-INV-10 pins that the model never emits a Slack ID at all.

## 5. Where each rule is pinned

| Rule | Pinned by |
|---|---|
| §1.1 resolution order, including bot-only/app-only/both/neither | `identity-routing.test.ts`, `actions.test.ts` |
| §2 no display name, text, or model output as identity | `identity-routing.test.ts`, `contract-safety.test.ts` |
| §3 the full routing matrix, every cell | `identity-routing.test.ts` |
| §3.1 trusted bots cannot create, own, approve, or redirect | `identity-routing.test.ts`, `approvals.test.ts` |
| §3.2 persistence precedes evaluation | `events.test.ts` |
| §4 trusted content is untrusted | `actions.test.ts`, `events.test.ts` |
