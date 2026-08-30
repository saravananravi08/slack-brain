# P01 — Mastra and Slack Foundation

- **Status:** Planned
- **Depends on:** P00
- **Phase integrator:** Unassigned
- **PRD coverage:** FR-SLK-001–011, FR-OPS-001–002, NFR-MNT-001–004

## Outcome

A minimal Gist agent runs through Mastra and Slack Socket Mode with validated configuration, persistent storage, tracing, streaming, and no Claude CLI/Bolt request path.

## Entry criteria

- [ ] P00 completed.
- [ ] Model/provider and data-residency decisions accepted.
- [ ] Development Slack credentials available outside Git.

## Parallel execution plan

1. **PG-01A:** T101 runs alone because it owns manifests and build config.
2. **PG-01B:** T102, T103, T104, and T105 branch only after T101 merges; they run concurrently on isolated paths.
3. **PG-01C:** T106 runs after all PG-01B tasks merge and owns composition files.

## Tasks

| Task | Status | Depends on | Parallel group | Owner | Completion commit |
|---|---|---|---|---|---|
| [T101](../tasks/T101-PROJECT-SCAFFOLD.md) | Completed | P00 | PG-01A | pi-coder | 872bd8b |
| [T102](../tasks/T102-CONFIG-VALIDATION.md) | Completed | T101 | PG-01B | pi-coder-2 | 6d6c3c3 |
| [T103](../tasks/T103-STORAGE-TRACING.md) | Completed | T101 | PG-01B | pi-coder-3 | 9f701a5 |
| [T104](../tasks/T104-SLACK-CHANNEL.md) | Completed | T101, T003, T004 | PG-01B | claude-planner | 5b211d0 |
| [T105](../tasks/T105-GIST-AGENT.md) | Completed | T101, T004 | PG-01B | pi-coder | 5a3f443 |
| [T106](../tasks/T106-FOUNDATION-INTEGRATION.md) | Completed | T102–T105 | PG-01C | pi-coder-4 | cffce23 |

## Integration procedure

1. Merge T101 and verify clean install/build.
2. Merge PG-01B one at a time; run unit tests after each.
3. Resolve composition only in T106—never in component branches.
4. Run Slack smoke test after T106.

## Exit criteria

- [ ] Gist responds to DM and mention in correct thread.
- [ ] Streaming/typing appears.
- [ ] Duplicate event smoke test produces one reply.
- [ ] Restart reconnects Socket Mode.
- [ ] Persistent store and tracing initialize.
- [ ] No Slack Bolt or Claude CLI is used by new runtime.

## Phase verification

```bash
npm ci
npm run typecheck
npm test
npm run build
git diff --check
```

Manual: DM, channel mention, thread follow-up, disconnect/reconnect.

## Completion record

- Gate approved by: —
- Gate date: —
- Commit: —
