# Contract — channel enrollment and retention after leave

- **Contract set:** channel-memory
- **Contract version:** 1.0.0
- **Owner:** T601 (frozen); consumers T602, T606
- **Implements:** D013
- **Satisfies:** CM-FR-001, CM-FR-002, CM-FR-003, CM-FR-004, CM-FR-005, CM-FR-006, CM-FR-014
- **Enforces:** CM-INV-01, CM-INV-10

Enrollment answers one question — *may Gist capture in this channel right now, and from which point in time* — and it answers it from Slack membership, not from a configured list. This is the D013 change: the v1 static `approved_channel_ids` allowlist (`authorization.md` §4 rule 7) is not the channel gate for P06/P07 channel memory.

## 1. Types

```ts
type EnrollmentState = 'enrolled' | 'left';

type MembershipSource =
  | 'member_joined_channel'      // Slack event: Gist was added
  | 'member_left_channel'        // Slack event: Gist was removed or left
  | 'conversations_members'      // Slack API confirmation at startup or reconnect
  | 'operator_reconciliation';   // Operator-run repair; still a Slack-confirmed fact

interface ChannelEnrollment {
  contract_version: string;          // "1.0.0"

  boundary_id: BoundaryId;           // ch:<workspace_id>:<channel_id> — primary key
  workspace_id: string;
  channel_id: string;

  state: EnrollmentState;
  epoch: number;                     // 1 on first join, +1 on every re-join

  enrolled_at: string;               // RFC 3339 UTC — when membership was confirmed
  capture_floor_ts: string;          // Slack ts; verbatim string, never a float
  left_at: string | null;            // RFC 3339 UTC; null iff state === 'enrolled'

  membership_source: MembershipSource;
  membership_confirmed_at: string;   // RFC 3339 UTC of the last positive confirmation
  retention: 'retained';             // leaving never deletes (§5)
}
```

`retention` is a one-value union on purpose. It is the type-level statement that no enrollment transition carries a deletion mode, so a future "delete on leave" cannot be introduced by passing a different string — it requires a contract change and a new decision.

## 2. Membership is authoritative

An enrollment record may be created or moved to `enrolled` **only** from a Slack-confirmed membership fact: a `member_joined_channel` event for Gist's own bot user, or a positive `conversations.members` / `conversations.list` confirmation.

Rules:

1. **Configuration cannot enroll a channel.** A channel ID in an environment variable, a config file, or the v1 allowlist grants nothing. Configuration may still *deny* — an operator kill-switch narrows capture, never widens it.
2. **A message event is not membership evidence.** Receiving a message from a channel does not enroll it. Slack can deliver events for a channel whose membership state Gist has not confirmed, and inferring enrollment from traffic would make capture start from an unconfirmed boundary.
3. **Unknown means not enrolled.** No record, or a record whose membership check errored, timed out, or is stale, resolves to `capture_denied: 'channel_not_enrolled'`. Fail-closed, matching `authorization.md` §5 rule 5: a lookup failure never widens scope.
4. **The registry is durable.** It survives process restart and reconnect (CM-FR-001, CM-NFR-002). An in-memory set is not a registry; it re-enrolls at a new floor after every restart and silently loses the join time.
5. **Multiple channels are simultaneously enrolled** (CM-FR-003). Records are independent; one channel's failure, backlog, or leave has no effect on another's state.

## 3. The capture floor (no backfill)

`capture_floor_ts` is the Slack `ts` at which capture begins for the current epoch — the membership-confirming event's `ts`, or the `ts` of the confirming API observation.

```ts
function withinCaptureFloor(e: ChannelEnrollment, message_ts: string): boolean
  = compareMessageTs(message_ts, e.capture_floor_ts) >= 0;
```

- A message with `message_ts` **before** the floor is not captured: `capture_denied: 'before_capture_floor'` (CM-FR-006). No history backfill is performed or required.
- `compareMessageTs` compares Slack timestamps **without float conversion** (`slack-event.md` §2). Split on `.`, compare the integer seconds numerically, then compare the fractional parts as integers after right-padding both to 6 digits. `"1735689600.0002"` and `"1735689600.000200"` compare equal in ordering while remaining **distinct identities** — ordering and identity are different questions, and only ordering tolerates the padding.
- Rejection below the floor is **success, not an error**. It is counted (`capture_skipped{reason}`) and carries no message text.

## 4. Re-join and epochs

Re-joining a previously left channel keeps the same `boundary_id` — memory is continuous with the channel, not with the visit. It increments `epoch`, sets `state: 'enrolled'`, clears `left_at`, and sets a **new** `capture_floor_ts` at the re-join.

The gap between `left_at` and the new floor is **not** backfilled (CM-FR-006). This is a known and accepted hole in the record: Gist's memory of a channel it left and re-joined is discontinuous, and nothing in P06 fills it. It is visible in the registry — `epoch > 1` — so a later reconciliation feature can find affected channels without guessing.

## 5. Leaving retains memory

On a confirmed leave: `state: 'left'`, `left_at` set, `capture_floor_ts` and `epoch` unchanged.

| Concern | Behavior after leave |
|---|---|
| New capture | **Stops.** Every capture attempt denies with `channel_not_enrolled` (CM-FR-005) |
| Stored messages, embeddings, summary, observations | **Retained unchanged.** No implicit delete, no purge, no decay |
| Read/retrieval within that boundary | Remains possible for authorized channel-scoped requests; still never crosses into another boundary (CM-INV-01) |
| Deletion | Only through an explicit operator purge or a D004 retention sweep, using the v1 `deleteMessages` primitive (`storage.md` §3) |

The word "silently" in CM-FR-005 is the requirement: an operator may still purge a left channel deliberately, and D004's `channel_message` class still applies. What must not happen is memory disappearing as a side effect of a membership change.

Leaving does not delete, so it is also not a privacy control. A channel whose memory should be gone requires an explicit purge; the runbook (T504 lineage) must say so rather than implying that removing Gist removes the record.

## 6. Interface

```ts
function enrollmentFor(boundary_id: BoundaryId): ChannelEnrollment | null;   // durable read
function applyMembershipFact(f: MembershipFact): ChannelEnrollment;          // idempotent
function withinCaptureFloor(e: ChannelEnrollment, message_ts: string): boolean;
```

- `applyMembershipFact` is **idempotent**: replaying a join for an already-enrolled channel at the same `ts` is `unchanged`, not a new epoch and not a moved floor. Slack redelivers membership events on reconnect (CM-FR-014), and a floor that moves on replay silently drops every message in between.
- A join whose `ts` is **older** than the current epoch's floor does not move the floor backwards. Backwards movement would re-open the channel to pre-enrollment history, which is exactly what CM-FR-006 excludes.
- `enrollmentFor` is the only enrollment read. Capture must not consult Slack inline per message; a per-message membership API call turns a burst into a rate-limit incident and makes capture depend on Slack availability (CM-NFR-002).

## 7. Fixtures

[`../../../tests/contracts/channel-memory/fixtures/enrollment.v1.json`](../../../tests/contracts/channel-memory/fixtures/enrollment.v1.json) — join of `C0CHANTESTA` and `C0CHANTESTB` (two simultaneous enrollments), a replayed join, a message below the floor, a leave with retention expectations, a re-join epoch, and the unknown-channel fail-closed case.
