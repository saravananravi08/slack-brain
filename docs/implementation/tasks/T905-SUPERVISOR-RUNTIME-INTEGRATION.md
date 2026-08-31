# T905 — Integrate durable supervisor runtime

- **Status:** Planned
- **Phase:** [P09](../phases/P09-DURABLE-SUPERVISOR.md)
- **Owner:** Unassigned
- **Branch:** `task/T905-integrate-durable-supervisor-runtime`
- **Parallel group:** PG-09B
- **Depends on:** T901, T902, T903, T904
- **Blocks:** T906
- **Can run parallel with:** None
- **Conflicts with:** Exclusive shared runtime composition
- **Write scope:**
  - `src/config.ts`
  - `.env.example`
  - `src/mastra/channels/**`
  - `src/mastra/agents/**`
  - `src/mastra/index.ts`
  - `src/orchestration/index.ts`
  - `tests/config/**`
  - `tests/channels/**`
  - `tests/agents/**`
  - `tests/integration/slack-supervisor/**`
- **Read-only references:** T901–T904 modules/logs, P08 contracts/threat model, current capture/proactive/context runtime.
- **Task log:** [`../logs/T905.md`](../logs/T905.md)

## Objective

Compose workflow storage, trusted event routing, supervisor decisions, and Slack dispatch into the live runtime while preserving exact capture, human authorization, Gist self-exclusion, existing mention/context behavior, and single-process shutdown.

## Deliverables

- Validated Kilo/Linear bot/app identity configuration.
- Dedicated post-persistence trusted automation continuation path.
- Human assignment path that bypasses proactive cooldown in active workflow threads.
- Transactional/checkpointed supervisor action loop.
- Startup/restart/shutdown integration and content-free metrics.
- Integration tests through real adapter event seams.

## Required procedure

1. Confirm all four component tasks are merged and Completed.
2. Own shared files exclusively; no parallel writer.
3. Register workflow domain on existing FactoryStorage connection.
4. Keep bot continuation separate from generic human authorizer and Chat bot-ignore path.
5. Persist exact message before supervisor/model execution.
6. Recheck workflow state immediately before and after external dispatch.
7. Preserve all P06/P07/T608/T609 regressions.
8. Verify full suite/build and hand off.

## Implementation steps

1. Add strict Linear/Kilo identity config without logging values.
2. Compose workflow registry and supervisor engine.
3. Route human and trusted automation events after capture/dedup.
4. Dispatch logical bot actions in bound thread through adapter port.
5. Persist action/transition checkpoints and outgoing message references.
6. Replace temporary all-human test mode with unified supervisor eligibility while preserving ordinary proactive behavior.
7. Add lifecycle drain/recovery and operational metrics.

## Verification

```bash
npm run typecheck
npm test -- tests/integration/slack-supervisor tests/channels tests/agents tests/config
npm run test:ingestion
npm test
npm run build
git diff --check
```

## Acceptance criteria

- [ ] Authorized human assignment and trusted bot reply both reach supervisor.
- [ ] Trusted bot path works despite Chat SDK bot-ignore behavior.
- [ ] Gist/self and unknown bots never reach supervisor/model.
- [ ] Active workflow messages are not dropped by proactive cooldown.
- [ ] One external action follows one durable checkpoint.
- [ ] Capture/context/mention/proactive/edit/retry behavior remains green.
- [ ] Shutdown drains in-flight supervisor checkpoints safely.

## Completion record

- Implementation commit: —
- Handoff commit: —
- Merge commit: —
- Integration metadata commit: —
- Completed at: —
