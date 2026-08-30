# Gist contract index

- **Contract set version:** 1.0.0
- **Frozen by:** T004, 2026-08-30
- **Change control:** after T004 merges, **any change to a file in this directory requires coordinator approval** and a version bump below. A task worker who finds a contract wrong must stop and mark their task `Blocked` (task procedure step 7) rather than editing the contract in their own branch.

These contracts are the interface between tasks that run in parallel. They are written so that T104, T105, T201, T202, T203, T301, and T401–T404 can be implemented independently and still compose.

## Files

| File | Defines | Primary consumers |
|---|---|---|
| [`slack-event.md`](./slack-event.md) | Normalized Slack event and message shape, skip reasons, mutation events, idempotency key | T104, T401, T402, T403, T404 |
| [`identity.md`](./identity.md) | Resource / thread / boundary ID contract and the DM–channel separation | T201, T202, T204, T403 |
| [`authorization.md`](./authorization.md) | Authorization request/decision, deny reasons, retrieval scope | T203, T402, T404, T502 |
| [`storage.md`](./storage.md) | Stored record shape, vector dimension, retention classes, delete primitive | T103, T201, T304, T403, T404 |
| [`retrieval.md`](./retrieval.md) | Retrieval request/result, citation metadata, mechanism independence | T201, T105, T205 |
| [`errors.md`](./errors.md) | Error taxonomy, user-facing vs internal, logging rules | all |
| [`fixtures/`](./fixtures/) | Versioned JSON test vectors | all downstream tests |

## Reserved — not owned by T004

| Path | Owner | Note |
|---|---|---|
| `archive-import.md` | **T301** | `docs/architecture/contracts/archive-import.md` falls inside T004's write-scope glob but is listed as T301's exclusive write scope in `FILE_OWNERSHIP.md`. T004 has deliberately **not** created it. T301 authors it and must conform to `identity.md`, `storage.md`, and `slack-event.md` §3. |

## Versioning

The contract set carries one semantic version, recorded in each file's header and in `fixtures/manifest.json`.

- **Patch** — clarification with no shape change.
- **Minor** — additive optional field. Existing consumers stay valid.
- **Major** — removal, rename, or semantic change. Requires re-verification of every consuming task.

Fixtures are versioned with the set. A test pins `contract_version` and fails loudly on a major bump instead of silently drifting.

## How to use these

1. Read the contract for your surface **before** writing code, not after.
2. Import the fixture vectors rather than inventing your own — cross-task agreement is the point.
3. Any identifier that appears in a fixture is synthetic. Never add a real workspace, channel, user ID, or message body to this directory (FR-PRV-007, D001).
