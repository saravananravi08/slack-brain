# P08 — Slack Automation Contracts and Compatibility

- **Status:** In Progress
- **Depends on:** Channel-memory/context baseline through `5fdf8e2`; accepted D023–D029
- **Phase integrator:** herdr orchestrator
- **PRD coverage:** GS-FR-001–011, GS-FR-017–026, GS-NFR-003/004/007

## Outcome

Gist has an accepted, testable supervisor protocol and live proof that exact configured Kilo and Linear bots accept Gist-authored Slack instructions and return correlatable replies. Unsafe or unsupported Slack-only assumptions fail before runtime implementation begins.

## Entry criteria

- [x] P06/P07 implementation and offline suites are merged.
- [x] All-sender persistence identifies Kilo by exact bot/app IDs.
- [x] Product owner selected Slack-only bot steering with no direct connectors.
- [x] D023–D029 are recorded as accepted on the feature branch.

## Parallel execution plan

1. **PG-08A:** T801 freezes supervisor requirements, action/state contracts, and synthetic fixtures.
2. **PG-08S (product-owner priority):** T804 adds the durable Channel Supervisor answer/status foundation before compatibility work resumes.
3. **PG-08B:** T802 resumes the real Kilo/Linear compatibility decision against the supported transport options.
4. **PG-08C:** T803 incorporates measured behavior into the protocol and threat model.

The phase is intentionally serial. Runtime work must not start from assumed Slack bot behavior.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T801](../tasks/T801-SUPERVISOR-CONTRACTS.md) — Freeze Slack supervisor contracts | Completed | D023–D029, baseline `5fdf8e2` | PG-08A | claude-contracts-1 | `73821b5` |
| [T804](../tasks/T804-CHANNEL-SUPERVISOR-SESSION.md) — Implement durable Channel Supervisor session | In Progress | T609d, T801 invariants | PG-08S | pi-t804-channel-supervisor | — |
| [T802](../tasks/T802-BOT-COMPATIBILITY-SPIKE.md) — Prove Kilo and Linear bot compatibility | Blocked | T804 priority, transport decision | PG-08B | pi-t802-compatibility | — |
| [T803](../tasks/T803-AUTOMATION-THREAT-PROTOCOL.md) — Finalize automation protocol and threat model | Planned | T802 | PG-08C | Unassigned | — |

## Integration procedure

1. Merge T801 and run contract/safety tests.
2. Run T802 only with approved disposable content; merge sanitized aggregate evidence.
3. Stop the affected bot path if compatibility fails; do not invent a connector fallback.
4. Merge T803 and rerun contract/security tests.
5. Update phase, status, and global log metadata.

## Exit criteria

- [x] Human/trusted-bot/self/unknown-bot routing is frozen.
- [x] Workflow state and structured action contracts are versioned.
- [ ] Kilo accepts Gist-authored tasks and replies correlatably.
- [ ] Linear accepts Gist-authored tasks and replies correlatably.
- [ ] Thread/workflow correlation strategy matches live bot behavior.
- [ ] Threat model covers prompt injection, identity spoofing, replay, loops, approvals, destination control, and restart.
- [ ] No real IDs, content, credentials, prompts, or raw events are committed.

## Phase verification

```bash
npm run typecheck
npm test -- tests/contracts/slack-supervisor tests/security/slack-supervisor
npm run build
git diff --check
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
