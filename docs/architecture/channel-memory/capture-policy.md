# Contract — capture eligibility, separated from response eligibility

- **Contract set:** channel-memory
- **Contract version:** 1.0.0
- **Owner:** T601 (frozen); consumers T603, T604, T606
- **Implements:** D014
- **Satisfies:** CM-FR-007, CM-FR-012, CM-FR-013, CM-NFR-006
- **Enforces:** CM-INV-08, CM-INV-09

Two questions, two functions, two result types, no data path between them:

1. **Capture** — may this message be stored in this channel's boundary?
2. **Response** — may Gist generate and post a reply to this message?

D014 widens capture to every sender class. It does not widen response authorization at all. The separation below is structural rather than procedural, because "we remember to check twice" is precisely the discipline that erodes when a bot-to-bot loop is one refactor away.

## 1. Types

```ts
type CaptureDenyReason =
  | 'channel_not_enrolled'      // enrollment.md §2 — includes left, unknown, unconfirmed
  | 'before_capture_floor'      // enrollment.md §3 — no backfill
  | 'unapproved_workspace'
  | 'not_a_channel'             // dm: boundaries are out of this contract set
  | 'system_subtype'            // lifecycle noise, not message content
  | 'malformed_event'
  | 'duplicate_delivery';       // invariants.md CM-INV-05

interface CaptureDecision {
  contract_version: string;
  capture: boolean;
  reason: CaptureDenyReason | null;   // null iff capture
  boundary_id: BoundaryId | null;     // exactly one; null iff !capture
}
```

```ts
type ResponseDenyReason =
  | DenyReason                  // authorization.md §3, unchanged and still first
  | 'not_addressed'
  | 'non_human_sender'
  | 'self_authored';

interface ResponseDecision {
  contract_version: string;
  respond_allowed: boolean;
  reason: ResponseDenyReason | null;  // null iff respond_allowed
}
```

`CaptureDecision` carries **no** field a caller could read as permission to reply: no `addressed`, no `sender_class`, no scope, no policy echo. `boundary_id` is present because a capture that does not name exactly one boundary is a bug (CM-INV-01), and its type is a single `BoundaryId`, never a list.

## 2. Signatures — the separation is in the types

```ts
function captureDecision(
  e: NormalizedEvent,
  enrollment: ChannelEnrollment | null,
): CaptureDecision;

function responseDecision(
  e: NormalizedEvent,
  policy: PolicySnapshot,
  self: GistIdentity,
): ResponseDecision;
```

Binding rules:

1. **`responseDecision` does not accept a `CaptureDecision`,** and must not be given one in a later revision. A captured message is not an eligible message; if the two ever share an input, the compiler stops being able to tell them apart.
2. **`captureDecision` does not accept a `PolicySnapshot`.** Capture has no view of the response policy, so a policy change cannot silently alter what is stored.
3. Both are **pure and total** — no I/O, no clock, no Slack calls, no throw. `enrollment` is read once, before the call (`enrollment.md` §6).
4. Neither may be inferred from the other in either direction. `respond_allowed: false` never suppresses capture; `capture: false` never suppresses a response the response policy already authorized (in practice the two overlap, but the implication must not be coded).

## 3. Capture rules

Evaluated in order; first deny wins.

1. `conversation_type !== 'channel'` → `not_a_channel`. DM memory is unchanged v1 behavior and out of this set.
2. `workspace_id !== approved_workspace_id` → `unapproved_workspace`.
3. No enrollment, or `state !== 'enrolled'` → `channel_not_enrolled`.
4. `!withinCaptureFloor(...)` → `before_capture_floor`.
5. System lifecycle subtype (`slack-event.md` / `SYSTEM_SUBTYPES`) → `system_subtype`.
6. Unresolvable identity or unknown event shape → `malformed_event`.
7. `event_id` already accepted → `duplicate_delivery` (CM-INV-05).
8. Otherwise **capture**, with `boundary_id = ch:<workspace_id>:<channel_id>`.

**Sender class is not in this list.** Human, Gist, Kilo, other bot, and app messages all reach rule 8 identically (CM-FR-007, D014). A capture path that branches on sender class has reintroduced the v1 skip and fails `capture-policy.test.ts`.

Empty text is **not** a capture denial in this set. A file-share or attachment-only message carries `text: ""` and real content in `files` (`message-record.md` §3); the v1 `empty_text` skip would drop it. A message with neither text nor file/link metadata is captured as an empty record rather than being dropped, so the channel's message sequence stays complete.

## 4. Response rules

Unchanged from `authorization.md` §4 for humans. Added denials, evaluated before the v1 gates so a non-human sender never reaches policy evaluation at all:

1. `sender_class === 'gist'` (self) → `self_authored`. First, unconditionally. This is the loop stop.
2. `sender_class !== 'human'` (kilo, bot, app, system) → `non_human_sender` (CM-FR-013, v1 `bot_or_app_sender`).
3. `!addressed_to_gist` → `not_addressed` (INV-6: ambient messages never generate).
4. Then the v1 `authorization.md` §4 sequence, unchanged: workspace, external, guest, human, deactivated, allowlist, identity.

A malformed bot or app event denies at rule 2 or at v1 rule 8 and **cannot** reach generation or any outbound call (CM-NFR-006). Rule 1 is separate from rule 2 rather than folded into it because self-authored traffic is the loop risk with the shortest cycle, and it must deny even if the sender-class resolver is wrong about everything else.

## 5. Capture has no outward effect (CM-FR-012)

The capture path — decision, normalization, persistence, embedding — performs **zero** outbound Slack operations. No reply, no thread post, no `chat.*` call, no typing indicator, no reaction, no `assistant.threads.setStatus`, no automation trigger, no webhook.

```ts
type CaptureEffect = never;
```

Stated as a type so an implementation that wants to emit something from the capture path has nowhere to put it. `capture-policy.test.ts` asserts every capture fixture declares `expect_outbound_actions: []`, including the fixtures whose sender is a bot or app — the case where an accidental acknowledgement becomes a bot-to-bot loop.

Generation is likewise never invoked from the capture path. Embedding is a model call but not generation, and it is not an outbound Slack action; it may lag or fail without blocking persistence (CM-NFR-002).

## 6. The invariant this contract exists to hold

> **CM-INV-08 — capture never implies response.** For every event, `captureDecision(...).capture === true` places no constraint on `responseDecision(...)`, and for every sender class other than `human` the response decision is `false`.

Tested exhaustively, not by sampling: the fixture matrix pairs each sender class with each channel and asserts the capture/response pair. The pairing for non-human classes is always `capture: true, respond_allowed: false` — the pair that makes complete channel context safe.
