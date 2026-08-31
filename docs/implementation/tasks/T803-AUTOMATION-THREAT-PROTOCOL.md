# T803 — Finalize automation protocol and threat model

- **Status:** Planned
- **Phase:** [P08](../phases/P08-SLACK-AUTOMATION-CONTRACTS.md)
- **Owner:** Unassigned
- **Branch:** `task/T803-finalize-automation-threat-protocol`
- **Parallel group:** PG-08C
- **Depends on:** T802
- **Blocks:** P09
- **Can run parallel with:** None
- **Conflicts with:** T801 contract paths; serialized by dependency
- **Write scope:**
  - `docs/architecture/slack-supervisor/**`
  - `docs/security/slack-supervisor-threat-model.md`
  - `tests/contracts/slack-supervisor/**`
  - `tests/security/slack-supervisor/**`
- **Read-only references:** T801 contracts, T802 report, existing security design review, D023–D029.
- **Task log:** [`../logs/T803.md`](../logs/T803.md)

## Objective

Incorporate measured Kilo/Linear Slack behavior into the final protocol and prove the planned runtime fails closed against spoofing, prompt injection, replay, cross-boundary routing, stale approval, and bot-loop threats.

## Deliverables

- Final live-informed Slack automation protocol.
- Threat model with trust boundaries, abuse cases, severity, controls, residual risks, and owners.
- Security/contract tests for every high-risk invariant.
- Explicit P08 GO/NO-GO recommendation.

## Required procedure

1. Read T802 report and do not generalize beyond measured behavior.
2. Patch contracts only where live evidence requires it; keep PRD decisions authoritative.
3. Threat-model Slack content as attacker-controlled even when sent by a trusted bot identity.
4. Treat ID mapping, authorization, ownership, approval, and state transition as runtime controls.
5. Stop on unresolved high-severity issue.
6. Run verification, scope audit, secret scan, and handoff.

## Implementation steps

1. Freeze correlation marker/thread/reply rules from T802.
2. Model human impersonation, bot/app spoofing, display-name confusion, wrong thread/workspace/channel, prompt injection, replay, concurrency, stale approvals, action duplication, and self-loop.
3. Pin mitigations in executable tests.
4. Record accepted residual limits of Slack-only orchestration.
5. Issue phase GO/NO-GO.

## Verification

```bash
npm run typecheck
npm test -- tests/contracts/slack-supervisor tests/security/slack-supervisor tests/security/access
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Protocol exactly matches both live bots' measured behavior.
- [ ] Every high/critical threat is fixed or blocks P09.
- [ ] Trusted bot content cannot authorize, redirect, or widen work.
- [ ] Wrong-boundary, duplicate, stale-state, and self-loop tests fail closed.
- [ ] Residual risks have owners and explicit acceptance requirements.
- [ ] P08 recommendation is explicit.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
