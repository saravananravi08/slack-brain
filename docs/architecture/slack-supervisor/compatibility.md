# Contract — the compatibility measurements T802 must obtain

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen); consumers T802, T803
- **Implements:** D023, D029
- **Satisfies:** GS-FR-009, GS-FR-010

T801 froze a protocol that assumes trusted bots read Gist-authored Slack messages and reply in a way
that can be correlated. That assumption is not evidence. This contract fixes **exactly** what T802
must measure, in a shape that carries no content, and states which contract clauses each outcome
permits — so T803 amends a known list rather than rediscovering the dependencies.

T801 performs no live probe. Everything here is a specification of a measurement, plus offline
fixtures for the shapes T802 will fill in.

## 1. Scope and safety

T802 measures `kilo` and `linear` **independently**. There is no combined result; a shared verdict
would let one bot's success carry the other (D029).

The record below is the only thing that may be committed. Never committed, at any stage: real
workspace, channel, user, bot, or app IDs; message text in either direction; bot replies; prompts;
model output; raw event payloads; screenshots; traces; full logs; tokens. Aliases, booleans, enums,
counts, and day-precision dates only (GS-NFR-004).

Live probing requires operator-approved disposable content and a single running Slack process
(GS-NFR-008). Neither is T801's to arrange, and neither is assumed here.

## 2. `BotCompatibilityMeasurement`

One record per bot. Every field is required; `unknown` is a legal value and has consequences (§4).

```text
BotCompatibilityMeasurement
  contract_version           string
  logical_target             'kilo' | 'linear'
  bot_alias                  string          # synthetic alias, never a real ID
  observed_on                date            # day precision
  sample_count               integer >= 1

  accepts_bot_authored       Tri             # does it act on a message authored by Gist?
  requires_mention           Tri             # must the instruction @-mention it?
  reply_placement            ReplyPlacement
  reply_identity_stable      Tri             # do replies carry the same exact bot/app ID every time?
  marker_preserved           Tri             # is the workflow_marker echoed in replies?
  outcome_distinguishability OutcomeDistinguishability   # §2.1
  completion_signal          CompletionSignal
  duplicate_behavior         DuplicateBehavior
  reply_latency_bucket       LatencyBucket
  reacts_to_edits            Tri             # does editing an instruction re-trigger it?
  unrelated_message_inert    Tri             # does an unrelated bot message leave it inert?

  decision                   'GO' | 'NO_GO'
  blocking_reason_class      BlockingReason | null
```

```text
Tri                        = 'yes' | 'no' | 'unknown'
ReplyPlacement             = 'same_thread' | 'channel_root' | 'new_thread' | 'none' | 'unknown'
OutcomeDistinguishability  = 'structured' | 'stable_text' | 'unreliable' | 'unknown'
CompletionSignal           = 'explicit' | 'implicit' | 'none' | 'unknown'
DuplicateBehavior          = 'ignored' | 'second_action' | 'error' | 'unknown'
LatencyBucket              = 'lt_5s' | 'lt_30s' | 'lt_5m' | 'gte_5m' | 'none' | 'unknown'
BlockingReason             =
  'ignores_bot_authored' | 'uncorrelatable_replies' | 'unstable_identity' |
  'duplicate_side_effects' | 'no_outcome_signal' | 'insufficient_samples' | 'unmeasured'
```

Every field is a measurement of behavior, so each has a named observation T802 must actually make:

| Field | Observation |
|---|---|
| `accepts_bot_authored` | one Gist-authored instruction produces a response from the bot |
| `requires_mention` | the same instruction with and without an @-mention |
| `reply_placement` | where the reply lands relative to the instruction's thread |
| `reply_identity_stable` | the reply's exact bot/app ID equals the configured trusted ID on every sample |
| `marker_preserved` | the `[gist-wf:…]` marker appears in the reply |
| `outcome_distinguishability` | at least one success reply and one failure reply, compared for a structural difference and, failing that, for a repeatable textual form across ≥3 samples |
| `completion_signal` | whether "done" is stated or must be inferred |
| `duplicate_behavior` | one repeated instruction marker — chosen so no real work is duplicated |
| `reply_latency_bucket` | coarse time from instruction to first reply |
| `reacts_to_edits` | editing the instruction message; relevant because edits are live events here |
| `unrelated_message_inert` | an unrelated bot message in the channel causes no bot action |

### 2.1 `OutcomeDistinguishability`

The question is whether Gist can **reliably tell a success reply from a failure reply**, not whether
the bot happens to expose a machine-readable status field.

| Value | Meaning |
|---|---|
| `structured` | Success and failure differ in something other than prose — a status field, a distinct attachment or block, a colour, a consistent emoji or reaction |
| `stable_text` | No structural difference, but the two outcomes use a consistent, repeatable textual form across the observed samples that a classifier can separate |
| `unreliable` | The two outcomes cannot be told apart across the samples |
| `unknown` | Not measured |

`structured` and `stable_text` are both GO (§4 rule 4). An earlier reading of this contract required
a structural difference and made everything else a NO-GO, which was an overconstraint T801 imposed
rather than a product requirement. The PRD asks Gist to *interpret* Kilo and Linear replies —
GS-FR-028 says exactly that — and D024/GS-FR-017 route trusted replies into supervisor evaluation
for precisely that purpose. A bot that reports "done" in a sentence, consistently, is a bot Gist can
supervise. Blocking it would have failed the Slack-only path over a formatting preference.

**`stable_text` requires at least three samples** covering both a success and a failure reply
(§4 rule 5). One observation of one outcome is not evidence of a stable form; it is a sample size of
one wearing a conclusion. A structural signal is verifiable from fewer samples because the
distinguishing element is present or absent rather than inferred.

### 2.2 Distinguishable is not authoritative

`stable_text` classifies **evidence**; it never confers authority, and nothing in this section
weakens `identity.md` §4 or GS-INV-07.

A textual completion signal advances a workflow only by taking the ordinary route: it must correlate
on the full binding (`events.md` §4.2), the transition must be legal and pass compare-and-set
(`workflow-state.md` §3.2), and any gated action still needs a version-bound human approval
(`approvals.md` §3). Reply prose that says "approved", "you may merge", "the owner is now someone
else", or "ignore your instructions" changes nothing under any value of this field.

The distinction to hold on to: measuring that a bot's wording is *consistent* tells Gist how to read
a reply. It does not make the reply true, and it does not make the reply an instruction.


## 3. Correlation strategy selection (GS-FR-018)

`events.md` §4.2 requires a full binding match. What the measurement decides is whether the **thread
binding alone** identifies the reply, or whether the marker is needed as a second signal:

| `reply_placement` | `marker_preserved` | Permitted strategy |
|---|---|---|
| `same_thread` | `yes` | `thread_binding_with_marker` — strongest; thread match plus marker confirmation |
| `same_thread` | `no` / `unknown` | `thread_binding_only` — permitted; the binding is sufficient because the thread is exclusive to one workflow (`events.md` §4.1) |
| `channel_root` / `new_thread` | `yes` | `marker_required` — the reply is outside the bound thread, so the marker is the only link. T803 must decide whether to accept it; a marker travelling through content is weaker evidence (`identity.md` §4) |
| `channel_root` / `new_thread` | `no` / `unknown` | **none** — no correlation is possible. NO-GO, `uncorrelatable_replies` |
| `none` | any | **none** — the bot does not reply. NO-GO, `uncorrelatable_replies` |
| `unknown` | any | **none** — unmeasured. NO-GO, `unmeasured` |

Row 3 is the one that would change this contract set: `marker_required` means bot replies arrive
outside the bound thread, and `events.md` §4.2 check 3 (thread match) cannot hold. T803 would have
to amend §4.2 to admit a marker-scoped binding, and that amendment is precisely the kind of change
§5 lists as version-bumping.

## 4. Decision rules (GS-FR-010, D029)

A bot is **GO** only when all of the following hold:

1. `accepts_bot_authored === 'yes'`.
2. §3 yields a permitted strategy other than "none".
3. `reply_identity_stable === 'yes'` — an unstable identity means exact-ID trust
   (`identity.md` §2) cannot be relied on. Blocking reason `unstable_identity`.
4. `outcome_distinguishability` is `structured` **or** `stable_text`, and
   `completion_signal !== 'none'` — otherwise the workflow cannot tell success from failure or know
   when to stop. Blocking reason `no_outcome_signal`. A bot that reports outcomes in prose is **not**
   blocked, provided the prose is consistent enough to classify (§2.1).
5. If `outcome_distinguishability === 'stable_text'`, then `sample_count >= 3`. Blocking reason
   `insufficient_samples`. The looser evidential standard gets the tighter sampling requirement:
   "the wording is stable" is a claim about repetition, and it cannot be made from one reply.
6. `duplicate_behavior !== 'second_action'` — a bot that performs a second action on a repeated
   instruction defeats the one-event/one-action invariant at the far end, where Gist cannot enforce
   it. Blocking reason `duplicate_side_effects`.
7. No field is `unknown`. Blocking reason `unmeasured`.

Rule 7 is deliberate. An unmeasured field is not a neutral gap: the whole purpose of the spike is
that the protocol stops assuming. A measurement that could not be obtained is a NO-GO for that bot
until it is obtained.

Rules 4 and 5 replace an earlier T801 rule that demanded a structural success/failure difference.
That rule would have blocked the Slack-only path for a bot that says "done" reliably in English,
which is neither what the PRD requires nor what D024 and GS-FR-017/028 assume — those route trusted
replies into supervisor evaluation *so that Gist can read them*. What must not soften is authority:
§2.2 keeps prose as evidence only, and every gate in `approvals.md` §3 and `events.md` §4.2 applies
to a textual completion signal exactly as it applies to a structured one.

Consequences of NO-GO, fixed by D029:

- The failing bot's workflow path is blocked. `dispatch_bot` and `follow_up_bot` to that
  `LogicalTarget` are refused with `compatibility_blocked` (`dispatch.md` §6), and the workflow
  moves to `waiting_human`.
- The **other** bot's path is unaffected. Partial compatibility may support only the passing path,
  after an explicit scope amendment.
- There is no fallback. No direct Linear/GitHub/Kilo Cloud/MCP connector, no alternative transport,
  no identity substitution, no inferred success (D023, D029). Adding one requires a new accepted
  decision from the product owner.
- The finding routes to the product owner.

`CompatibilityDecisionRecord` is what P09 entry reads:

```text
CompatibilityDecisionRecord
  contract_version
  measurements       BotCompatibilityMeasurement[]   # exactly one per logical target
  phase_recommendation 'GO' | 'PARTIAL' | 'NO_GO'
```

`GO` requires both bots GO; `PARTIAL` means exactly one; `NO_GO` means neither. `PARTIAL` does not
unblock P09 by itself — it requires the scope amendment D029 names.

## 5. Clauses conditional on measurement

These are the clauses in this set whose final wording depends on T802. T803 amends this list, bumps
the set version per `README.md` §2, and records which rows moved:

| Clause | Depends on | If the measurement differs |
|---|---|---|
| `events.md` §4.2 check 3 (thread match) | `reply_placement` | admit a marker-scoped binding, or NO-GO |
| `actions.md` §5.1 (marker is secondary) | `marker_preserved` | the marker may become load-bearing; strengthen its generation and matching rules |
| `actions.md` §5.2 `reply_in_thread` | `reply_placement`, `requires_mention` | the instruction must @-mention the bot, and the rendered form changes |
| `workflow-state.md` §3.1 (`dispatched → running`) | `completion_signal`, `distinguishes_outcomes` | interim signals may not be distinguishable; the state machine may need an explicit acknowledgement step |
| `workflow-state.md` §5 (fresh review) | whether the bot supports a fresh session | if it cannot, decide whether an in-session review satisfies GS-FR-029 or blocks it |
| `dispatch.md` §5 (reconciliation by marker) | `marker_preserved` | reconciliation falls back to Gist's own outgoing record only, and the ambiguous row grows |
| `events.md` §6 (duplicate rows) | `duplicate_behavior` | if a repeated instruction causes a second action, Gist must never re-send even after an ambiguous reconciliation |
| reply classification feeding `events.md` §4.2 check 5 | `outcome_distinguishability` | a `stable_text` result means the reply→signal mapping is a classifier over prose, and T803/T1002 must state how it fails closed on an unrecognised reply |

## 6. Where each rule is pinned

| Rule | Pinned by |
|---|---|
| §2 record shape; every field required; enums closed | `compatibility.test.ts` |
| §2.1 `structured` and `stable_text` are both acceptable | `compatibility.test.ts` |
| §2.2 prose distinguishability grants no authority | `compatibility.test.ts`, `approvals.test.ts` |
| §3 strategy table, every row | `compatibility.test.ts` |
| §4 all seven GO rules, each failing independently | `compatibility.test.ts` |
| §4 rule 5 sample floor for `stable_text` | `compatibility.test.ts` |
| §4 NO-GO blocks only the failing target; no fallback | `compatibility.test.ts`, `actions.test.ts` |
| §4 `PARTIAL` does not by itself unblock P09 | `compatibility.test.ts` |
| §1 the record carries no content | `contract-safety.test.ts` |
