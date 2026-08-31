# Gist channel-memory contract index

- **Contract set:** `channel-memory`
- **Contract version:** 1.0.0
- **Frozen by:** T601, 2026-08-31
- **Requirement authority:** [`GIST_CHANNEL_MEMORY_PRD.md`](../../../GIST_CHANNEL_MEMORY_PRD.md) — CM-FR-001…019, CM-NFR-001/002/004/006
- **Governing decisions:** D013 (enrollment, no backfill), D014 (capture every sender), D015 (edit fidelity, delete-ignore)
- **Change control:** after T601 merges, **any change to a file in this directory requires coordinator approval** and a version bump below. A task worker who finds a contract wrong must stop and mark their task `Blocked` rather than editing the contract in their own branch.

This set is the interface between T602, T603, T604, and T605, which run in parallel with disjoint code scopes and must still compose in T606.

## Files

| File | Defines | Primary consumers |
|---|---|---|
| [`enrollment.md`](./enrollment.md) | Membership-authoritative enrollment, capture floor, retention after leave | T602, T606 |
| [`capture-policy.md`](./capture-policy.md) | Capture eligibility, separated from response eligibility | T603, T604, T606 |
| [`message-record.md`](./message-record.md) | Canonical sender classes and the stored channel message record | T603, T604, T606 |
| [`mutations.md`](./mutations.md) | Edit replacement on original identity; accepted delete-ignore | T605, T606 |
| [`invariants.md`](./invariants.md) | CM-INV-01…12: channel isolation, idempotency, separation, retention | all |
| [`requirements-map.md`](./requirements-map.md) | CM-FR-001…019 → contract clause or integration rule | integrator, T607 |
| [`../../../tests/contracts/channel-memory/fixtures/`](../../../tests/contracts/channel-memory/fixtures/) | Versioned synthetic test vectors | all downstream tests |

Fixtures live under `tests/contracts/channel-memory/fixtures/` rather than beside these documents, because T601's declared write scope places them there. `fixtures/manifest.json` carries the same `contract_version` as this file and is the list of legal synthetic identifiers.

## 1. Relationship to the frozen v1 contract set

`docs/architecture/contracts/` (contract set version 1.0.0, frozen by T004) remains in force and is **not modified by T601**. This set is additive and, in four named places, superseding. Supersession applies **only** to `ch:` (channel) boundaries in P06/P07. DM boundaries, archive import, retrieval scoping, the error taxonomy, and the D004 retention and delete primitives are unchanged.

| v1 clause | Original behavior | P06/P07 behavior | Authority |
|---|---|---|---|
| `authorization.md` §4 rule 4 | `sender_type !== 'human'` denies at **every** gate | Denies **response** authorization only. Capture takes no sender-class input | D014 |
| `authorization.md` §4 rule 7 | Channel gated on static `approved_channel_ids` | Channel gated on Slack-confirmed membership (`enrollment.md` §2) | D013 |
| `slack-event.md` §5 | `bot_message`, `app_message`, `own_message` are normalizer skips | Capture-eligible; still response-ineligible (`capture-policy.md` §4) | D014 |
| `slack-event.md` §4, `storage.md` §3 | `message_deleted` hard-deletes record + embedding, leaves a tombstone | `message_deleted` is ignored; nothing is deleted and **no tombstone is written** (`mutations.md` §4) | D015 |

Everything the v1 set says that is not listed above still holds verbatim, and this set reuses its vocabulary rather than restating it:

- `MessageKey = workspace_id/channel_id/message_ts` and the rule that **`message_ts` is never parsed to a float** — `slack-event.md` §2, §3.
- `BoundaryId = ch:<workspace_id>:<channel_id>`, `ThreadId = <boundary_id>#<thread_root_ts>`, and root-encoding collapse — `identity.md` §2, §3.
- `StoredMessage`, `StoredEmbedding` (1536 dimensions), `upsertMessage`, and `deleteMessages` — `storage.md` §1, §2, §3, §5.
- Deny reasons and the "never log message text" rule — `authorization.md` §3, `errors.md`.

## 2. Versioning

One semantic version for the set, recorded in every file header and in `fixtures/manifest.json`.

- **Patch** — clarification, no shape change.
- **Minor** — additive optional field; existing consumers stay valid.
- **Major** — removal, rename, or semantic change; every consuming task re-verifies.

The channel-memory set versions **independently** of the v1 set. Both are at 1.0.0 today; that is a coincidence of freezing, not a coupling. Tests pin `contract_version` and fail loudly on a bump rather than silently drifting.

## 3. Synthetic identifiers

Every identifier in this set and its fixtures is invented. No real workspace, channel, user, bot, app, message body, URL, token, or trace appears here or in `tests/contracts/channel-memory/**` (FR-PRV-007, CM-NFR-004). `contract-safety.test.ts` enforces this by scanning the fixtures against the manifest allowlist, so a real ID pasted in later fails the suite rather than merging quietly.

The two-channel corpus is `C0CHANTESTA` and `C0CHANTESTB` in workspace `T0CHANTEST`; senders are listed in `fixtures/manifest.json`.

## 4. How to use these

1. Read the contract for your surface **before** writing code.
2. Import the fixture vectors rather than inventing your own — cross-task agreement is the point.
3. If a contract is wrong or silent on something you need, stop and record a blocker. Do not resolve product ambiguity in an implementation branch.
