# Requirement map — GS-FR-001…043 and GS-NFR-001…008

- **Contract set:** slack-supervisor
- **Contract version:** 1.0.0
- **Owner:** T801 (frozen)
- **Requirement authority:** [`GIST_SLACK_SUPERVISOR_PRD.md`](../../../GIST_SLACK_SUPERVISOR_PRD.md) §7, §8

Every requirement in the PRD resolves **exactly once** to a contract clause, an integration rule, or
a named later task. Nothing is unassigned and nothing is assigned twice.
`requirements-map.test.ts` reads the PRD as the authority — not this table — so a requirement added
to the PRD shows up here as a failure rather than being quietly unmapped, and a duplicated row fails
too.

Legend — **Kind:**

- `contract` — pinned by a clause in this set and executable in `tests/contracts/slack-supervisor/`.
- `integration` — a clause here plus a named task that must compose it; no single contract can hold
  the behavior alone.
- `later` — the clause here fixes the shape or the gate, but the requirement is satisfied by work a
  named later task performs (a live measurement, a policy module, or a validation suite).

Every row cites at least one file in this set, so there is no requirement whose only home is a task
description.

## 7.1 Intake and clarification

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-001 | Persist before supervisor evaluation | contract | `events.md` §2 step 1; `identity.md` §3.2 | T902 |
| GS-FR-002 | Addressed and active-workflow-thread messages always reach evaluation | contract | `events.md` §3 rows 1–2, §5 rule 3 | T902, T905 |
| GS-FR-003 | Unaddressed messages outside workflows may `no_action`, assist, or start a candidate | contract | `events.md` §3 row 3; `actions.md` §2 | T904 |
| GS-FR-004 | Use thread, history, summary, observations, scoped recall | integration | `events.md` §1 (content read through the bounded channel-context API, never copied into workflow state) | T904 + T905 |
| GS-FR-005 | Ask only for materially missing details | contract | `actions.md` §5 (required envelope fields); `approvals.md` §1 | T904, T1001 |
| GS-FR-006 | No redundant confirmation for reversible work | contract | `approvals.md` §1, §2.3; `actions.md` §1.2, §2.1 (the continuation that carries a clear assignment to dispatch); `workflow-state.md` §3.4 | T901 (queue), T904 (evaluation), T905 (composition), T1001 |
| GS-FR-007 | Ambiguity, conflict, destructive work, and scope expansion need a human | contract | `approvals.md` §2.1, §2.2 | T904, T1001 |

## 7.2 Trusted bot compatibility and identity

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-008 | Identity is exact configured bot/app IDs | contract | `identity.md` §1.1, §2; `invariants.md` GS-INV-04 | T902, T905 |
| GS-FR-009 | Live compatibility proof before implementation | later | `compatibility.md` §1, §2 (the measurement contract T802 must fill) | T802 |
| GS-FR-010 | Compatibility failure blocks that bot path; no connector fallback | later | `compatibility.md` §4 (seven GO rules; prose outcomes are not a block) | T802, T803 |
| GS-FR-011 | Unknown automation stays capture-only | contract | `identity.md` §3; `invariants.md` GS-INV-06 | T902 |

## 7.3 Durable workflow registry

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-012 | Collision-resistant ID and durable record | contract | `workflow-state.md` §1 | T901 |
| GS-FR-013 | Thirteen explicit states | contract | `workflow-state.md` §2.1 | T901 |
| GS-FR-014 | Compare-and-set, idempotent transitions | contract | `workflow-state.md` §3.2 | T901 |
| GS-FR-015 | Restart restores without losing pending commands or replaying completed effects | contract | `workflow-state.md` §4; `dispatch.md` §2, §5 crash matrix | T901, T903, T905 |
| GS-FR-016 | One owner; others discuss but cannot approve or redirect | contract | `approvals.md` §4 | T901, T904 |

## 7.4 Event routing and correlation

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-017 | Trusted bots persisted first, then a dedicated automation path | contract | `events.md` §2, §3; `identity.md` §3.3 | T902 |
| GS-FR-018 | Advance only on a full binding and state match | contract | `events.md` §4.2 | T902 |
| GS-FR-019 | Unmatched trusted event may notify but cannot mutate | contract | `events.md` §4.3 | T902 |
| GS-FR-020 | Echoes, duplicates, restart, and replay converge on one durable command/effect | contract | `events.md` §6; `dispatch.md` §2–§5 | T902, T903 |
| GS-FR-021 | Per-workflow serialization; cooldown never drops a workflow event | contract | `events.md` §5 rules 1–4 | T902, T905 |

## 7.5 Structured supervisor decisions

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-022 | Strict ten-member action union with exact fields/enums/version | contract | `actions.md` §1, §5 | T904 |
| GS-FR-023 | Model selects a logical target, never a Slack ID | contract | `actions.md` §3; `invariants.md` GS-INV-10 | T904, T903 |
| GS-FR-024 | One event creates at most one claimed bound/unbound outbox command | contract | `dispatch.md` §1–§2; `actions.md` §1.1, §2.4 | T903 |
| GS-FR-025 | Instruction envelope contents and exclusions | contract | `actions.md` §5 (model/runtime split), §5.1, §5.2 (derived deadline), §5.3 | T903, T904 |
| GS-FR-026 | Instructions and replies are untrusted content | contract | `identity.md` §4; `actions.md` §6 | T904, T803 |

## 7.6 Kilo lifecycle

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-027 | Kilo may be asked to implement, investigate, test, fix, review | contract | `actions.md` §4 | T1002 |
| GS-FR-028 | Interpret progress, blocker, failure, completion, PR replies | integration | `events.md` §4.2 check 5 plus `actions.md` §5.2 `expected_signals`; `compatibility.md` §2.1 decides whether that reading is structural or textual; the reply→state policy is T1002's | T1002 |
| GS-FR-029 | Fresh review dispatch, not implementation self-review | contract | `workflow-state.md` §5 step 2 | T1002 |
| GS-FR-030 | Findings route to fixes; a PR URL is not acceptance | contract | `workflow-state.md` §5 steps 3–4 | T1002 |

## 7.7 Linear lifecycle

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-031 | Linear may be asked to find, create, update, comment, report | contract | `actions.md` §4 | T1003 |
| GS-FR-032 | Correlate Linear confirmation or failure to the workflow | contract | `events.md` §4.2 | T1003 |
| GS-FR-033 | Linear output cannot approve merge, release, destructive work, or ownership | contract | `approvals.md` §3.3 | T1003 |

## 7.8 Human control and approvals

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-034 | Status, pause, resume/continue, redirect, cancel, including at autonomy limits | contract | `approvals.md` §5–§6; `workflow-state.md` §7.3 | T1001 |
| GS-FR-035 | Irreversible actions require explicit approval | contract | `approvals.md` §2.1 | T904 |
| GS-FR-036 | Approval binds one workflow, one action, one version | contract | `approvals.md` §3.1, §3.2 | T904 |
| GS-FR-037 | Concise progress at meaningful transitions only | contract | `actions.md` §7 | T904, T1001 |

## 7.9 Resilience and loop prevention

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-FR-038 | Configurable turns, failures, inactivity, lifetime | contract | `workflow-state.md` §7.1 | T901 |
| GS-FR-039 | A limit stops autonomy; bounded authorized human control remains possible | contract | `workflow-state.md` §7.3; `approvals.md` §6 | T901, T1001 |
| GS-FR-040 | Never self-evaluate; bots cannot create, approve, or redirect | contract | `identity.md` §3, §3.1; `invariants.md` GS-INV-05 | T902 |
| GS-FR-041 | Concurrent replies are serialized and rechecked | contract | `events.md` §5 rules 1–2 | T902 |
| GS-FR-042 | Failed dispatch does not advance to a delivered-assuming state | contract | `dispatch.md` §4; `workflow-state.md` §2.3 | T903 |
| GS-FR-043 | Serial retry converges to one action and expected bot turn | contract | `dispatch.md` §3.2–§3.3 (new attempt only after prior definitive Slack pre-acceptance rejection) | T903 |

## 8. Non-functional requirements

| Req | Summary | Kind | Where | Owner |
|---|---|---|---|---|
| GS-NFR-001 | Isolation across workspace, channel, thread | contract | `invariants.md` GS-INV-01, GS-INV-02; `events.md` §4.4 | T902, T906 |
| GS-NFR-002 | Durable state resumes pending first sends without duplicate effects | contract | `workflow-state.md` §4; `dispatch.md` §2, §5; `invariants.md` GS-INV-12 | T901, T903, T906 |
| GS-NFR-003 | Authorization precedes creation and material action | contract | `events.md` §2 steps 2–4; `approvals.md` §3.1 | T902, T905 |
| GS-NFR-004 | Logs and records are content-free | contract | `events.md` §7; `invariants.md` GS-INV-14 | T901, T906 |
| GS-NFR-005 | Every transition and dispatch is auditable without content | contract | `workflow-state.md` §6.1; `dispatch.md` §1 | T901 |
| GS-NFR-006 | Failures fail closed and preserve exact capture | contract | `dispatch.md` §6; `identity.md` §3.2 | T905, T906 |
| GS-NFR-007 | Limits and approval gates survive restart and resist content | contract | `workflow-state.md` §7.1, §7.4; `actions.md` §5.2 (the deadline is derived, never model-supplied); `approvals.md` §3.1; `invariants.md` GS-INV-13 | T901, T906 |
| GS-NFR-008 | One-process Socket Mode/storage constraint remains | contract | `README.md` §5; `events.md` §5 | T905 |

## Deliberately not decided by T801

Three things are named here so they are not mistaken for omissions:

1. **Live bot behavior.** `compatibility.md` §5 lists the seven clauses whose final wording depends
   on T802's measurements. T801 froze the shape of the answer, not the answer.
2. **The threat model.** T803 owns `docs/security/slack-supervisor-threat-model.md`. This set states
   controls (`identity.md` §4, `actions.md` §3, `approvals.md` §3, `dispatch.md` §2) but does not
   enumerate abuse cases, severities, or residual-risk acceptance.
3. **Runtime implementation.** No file in `src/` is written or modified by T801. P09 owns
   `src/orchestration/**` per `FILE_OWNERSHIP.md`.

## Open item recorded against the PRD

**Reopen (PRD §5.1).** The PRD gives an authorized human the power to reopen a workflow, but
GS-FR-013 lists no `reopened` state and GS-FR-014 requires compare-and-set transitions.
`workflow-state.md` §2.4 resolves this as a **new linked workflow record** (`reopened_from`) rather
than a transition out of a terminal state, and records the reasoning. Flagged for T803 and the
product owner; if the intended behavior is a true reopen transition, that is a major bump to this
set and a change to the GS-FR-013 state list.
