# P06 — Complete Multi-Channel Capture

- **Status:** Planned
- **Depends on:** T406, accepted D013–D015
- **Phase integrator:** Unassigned
- **PRD coverage:** CM-FR-001…019, CM-NFR-001/002/004/006

## Outcome

Every message posted after Gist joins any internal Slack channel is persisted once in that channel's isolated boundary. Human, Kilo, Gist, bot, and app messages are captured without becoming response triggers. Edits replace source text and embeddings; deletes are deliberately ignored.

## Entry criteria

- [ ] T406 is completed and merged.
- [ ] D013–D015 are accepted.
- [ ] Slack test workspace permits adding Gist to at least two internal channels.

## Parallel execution plan

T601 freezes contracts. T602, T603, T604, and T605 then run in parallel with disjoint primary scopes. T606 integrates registry, authorization, capture, outgoing persistence, and edits. T607 performs offline and live multi-channel validation.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| T601 — Freeze channel-memory contracts | Completed | T406 | PG-06A | claude-opus5 | d8206d1 |
| T602 — Implement joined-channel registry | Completed | T601 | PG-06B | pi-coder-16 | 35da11a |
| T603 — Normalize all message senders | Completed | T601 | PG-06B | pi-coder-17 | 7dfd075 |
| T604 — Persist all live channel messages | Planned | T601 | PG-06B | Unassigned | — |
| T605 — Enforce edit fidelity and delete-ignore policy | Planned | T601 | PG-06B | Unassigned | — |
| T606 — Integrate multi-channel capture runtime | Planned | T602, T603, T604, T605 | PG-06C | Unassigned | — |
| T607 — Validate complete multi-channel capture | Planned | T606 | PG-06D | Unassigned | — |

## Integration procedure

1. Merge T601 and freeze contracts.
2. Merge T602–T605 one at a time; run their focused suites after each merge.
3. Merge T606; run ingestion, security, typecheck, and full regression.
4. Run T607 against two approved test channels with human, Gist, Kilo/app, root, reply, retry, and edit cases.
5. Update task, phase, status, and global log metadata.

## Exit criteria

- [ ] Joined-channel registry is durable and membership-authoritative.
- [ ] Two joined channels capture all sender classes without cross-channel leakage.
- [ ] Capture and response policies are independently tested.
- [ ] Gist outgoing messages persist exactly once.
- [ ] Edits replace source text and vectors idempotently.
- [ ] Delete events leave stored state unchanged, with accepted-risk tests.
- [ ] No backfill dependency exists.

## Phase verification

```bash
npm run typecheck
npm run test:ingestion
npm test
npm run build
```

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
