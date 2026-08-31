# Channel-memory capture validation

- **Task:** T607
- **Acceptance scope:** CM-AC-01…07 and CM-AC-12
- **Offline status:** Pass
- **Live status:** Pending operator execution
- **P06 gate:** Pending — do not declare GO until every live row below passes
- **Data posture:** Aggregate, content-free evidence only. Never record real workspace/channel/user/app IDs, message text, file names, URLs, tokens, database rows, prompts, model output, raw logs, event IDs, timestamps, traces, or screenshots containing them.

## Sanitized evidence rules

Use only channel aliases **A** and **B**. Record integer counts, deltas, sender classes, pass/fail booleans, and coarse UTC execution windows. Keep detailed source evidence in the approved ephemeral operator environment, then delete it after review.

Allowed examples: `channel A row delta = 1`, `generation count = 0`, `same row = true`, `cross-boundary count = 0`.

Forbidden examples: identifiers, message/event timestamps, copied text, row/vector payloads, Slack permalinks, database paths, tokens, full logs, prompts, responses, or content-derived hashes.

## Runtime under validation

- Integration base: `45d2cac`
- Restart defect provenance: found by T607; fixed by `fix/p06-durable-delivery-dedup`; merged as `45d2cac` before re-verification.
- Implementation commit: `37a717a`
- Handoff commit: this report handoff commit
- Live execution window: `<UTC date/hour only>`
- Operator role: `<role only; no name or user ID>`
- Environment: `<internal test | internal production-like>`

## Acceptance matrix

| ID | Required aggregate result | Offline | Live |
|---|---|---|---|
| CM-AC-01 | Two enrolled channels; distinct boundaries; restart preserves two enrollments; cross-channel records = 0 | Pass | Pending |
| CM-AC-02 | Human root delta = 1; human reply delta = 1; unsolicited generation/typing/reply counts = 0 | Pass | Pending |
| CM-AC-03 | Kilo delta = 1; other-app delta = 1; generation/typing/reply counts = 0 | Pass | Pending |
| CM-AC-04 | One addressed response; outgoing Gist row delta = 1; echo adds 0 rows | Pass | Pending |
| CM-AC-05 | Retry deliveries ≥ 2; canonical row delta = 1; generation/post count ≤ 1; restart redelivery adds 0 | Pass | Pending |
| CM-AC-06 | Row count unchanged; same identity = true; edited text current = true; vector count unchanged; stale vector match = false | Pass | Pending |
| CM-AC-07 | Delete outcome ignored; row/vector/derived counts unchanged; tombstone delta = 0; accepted risk acknowledged | Pass | Pending |
| CM-AC-12 | Left-channel capture delta = 0; retained row/vector counts unchanged; still-joined channel delta = 1 | Pass | Pending |

## Offline evidence

Command: `npm test -- tests/e2e/channel-memory-capture`

- Test files: 1 passed
- Tests: 5 passed
- Covered channels: 2 synthetic boundaries
- Covered sender classes: human, Gist, Kilo, app
- Covered shapes: root, thread reply, outgoing response, echo, same-envelope retry, second-envelope redelivery, edit, delete, restart, leave
- Restart retry result: `duplicate_delivery`; second generation count = 0; second post count = 0
- Network/Slack/provider calls: 0
- Real identifiers/content used: 0

## Live aggregate results

Fill only after checklist completion.

| Metric | Expected | Observed |
|---|---:|---:|
| Enrolled channel count after two joins | 2 | `<pending>` |
| Channel A human root/reply row delta | 2 | `<pending>` |
| Channel B human root/reply row delta | 2 | `<pending>` |
| Kilo row delta | 1 | `<pending>` |
| Other-app row delta | 1 | `<pending>` |
| Non-human-triggered generation count | 0 | `<pending>` |
| Non-human-triggered typing/status count | 0 | `<pending>` |
| Non-human-triggered Slack post count | 0 | `<pending>` |
| Outgoing Gist canonical row delta | 1 | `<pending>` |
| Outgoing echo row delta | 0 | `<pending>` |
| Retry delivery count | ≥2 | `<pending>` |
| Retry canonical row delta | 1 | `<pending>` |
| Retry generation/post count | ≤1 | `<pending>` |
| Post-restart retry row/generation/post delta | 0/0/0 | `<pending>` |
| Edit row/vector count delta | 0/0 | `<pending>` |
| Old-vector match count after edit | 0 | `<pending>` |
| Delete row/vector/derived/tombstone delta | 0/0/0/0 | `<pending>` |
| Left-channel new row delta | 0 | `<pending>` |
| Left-channel retained row/vector delta | 0/0 | `<pending>` |
| Still-joined channel new row delta | 1 | `<pending>` |
| Cross-channel record count | 0 | `<pending>` |

## Live operator checklist

All steps require two real **internal, non-Slack-Connect** channels approved for validation. Refer to them only as A and B in this report. Use disposable test content and never copy it into evidence.

1. **Prepare instrumentation and baseline.** Start one Gist process with content-free counters enabled. Label the channels A/B outside this report. Record: UTC hour, process count, initial enrollment count, per-alias row/vector counts, generation count, typing/status count, and Slack post count.

2. **Add Gist to channel A.** Invite Gist through Slack and wait for membership confirmation. Record: enrollment-count delta, A state = enrolled, A epoch, and capture-floor-present boolean. Expected: `+1`, `enrolled`, epoch `1`, `true`.

3. **Add Gist to channel B.** Repeat the Slack invite. Record the same observations for B plus total enrolled count. Expected: B `+1`, `enrolled`, epoch `1`, floor present, total `2`; A remains enrolled and unchanged.

4. **Post human roots.** A full internal human member posts one ordinary root in A and one in B without mentioning Gist. Record per alias: human-row delta, vector delta, generation delta, typing/status delta, Slack-post delta. Expected per alias: `1/1/0/0/0`.

5. **Post human thread replies.** The same member posts one reply under each root without mentioning Gist. Record per alias: reply-row delta, vector delta, root/reply classification counts, generation delta, typing/status delta, Slack-post delta. Expected per alias: row/vector `+1/+1`, roots/replies correctly classified, outbound deltas `0/0/0`.

6. **Post as Kilo.** Trigger one approved Kilo action that posts in A. Do not impersonate Kilo with a display name. Record: Kilo sender-class row delta, vector delta, generation delta, typing/status delta, Slack-post delta. Expected: `1/1/0/0/0`.

7. **Post as another app.** Trigger one non-Gist, non-Kilo internal app post in B. Record: app sender-class row delta, vector delta, generation delta, typing/status delta, Slack-post delta. Expected: `1/1/0/0/0`.

8. **Create one Gist response.** A human sends one authorized addressed question in A. Record: accepted human row delta, generation count, Gist Slack-post count, direct `outgoing_self` row delta, later Slack-echo row delta, total canonical outgoing rows. Expected: `1/1/1/1/0/1`.

9. **Exercise Slack retry/redelivery.** Through the approved test-workspace transport/retry control, cause Slack to deliver the same accepted human envelope at least twice; do not create a second Slack message and do not replay Web API history. Confirm retry metadata in the ephemeral environment but do not copy it. Record: delivery-attempt count, canonical row delta, vector delta, generation count, Slack-post count, duplicate-delivery count. Expected: attempts `≥2`, row/vector `1/1`, generation/post `≤1/≤1`, duplicate count `≥1`. If no genuine retry/redelivery control is available, record `Not run` and keep gate NO-GO.

10. **Restart and replay the accepted delivery.** Stop Gist cleanly, start a new process on the same persistent store, confirm both enrollments, then use the approved retry control to redeliver the previously accepted envelope. Record: enrollment counts before/after, row/vector counts before/after, redelivery outcome, generation delta, Slack-post delta. Expected: enrollments unchanged at `2`, data deltas `0/0`, outcome `duplicate_delivery`, generation/post `0/0`.

11. **Edit one captured human source.** In Slack, edit one previously captured human message once. Record: target-row count before/after, target-vector count before/after, same-identity boolean, immutable sender/channel/thread/sent-time booleans, edited-time-present boolean, new-vector-match count, old-vector-match count, generation/post deltas. Expected: counts `1→1`, all immutable booleans `true`, edited time present, new/old matches `1/0`, outbound deltas `0/0`.

12. **Delete that edited source.** Acknowledge the temporary D015 risk before deleting: Slack deletion does not remove Gist memory. Delete the source in Slack. Record before/after target row count, vector count, derived-state count, tombstone count, delete outcome, generation/post deltas. Expected: all counts unchanged, tombstone delta `0`, outcome `ignored`, outbound deltas `0/0`. Do not record retained content.

13. **Leave channel A.** Remove Gist from A through Slack and wait for confirmation. Record: A state, left-time-present boolean, epoch, retained row/vector counts before/after, B state/counts. Expected: A `left`, left time present, epoch unchanged, retained deltas `0/0`; B unchanged and enrolled.

14. **Prove capture stopped only in A.** After leave confirmation, a human posts one disposable root in A and one in B. Record per alias: new row/vector deltas and outbound deltas. Expected: A `0/0/0`; B row/vector `1/1` with unsolicited outbound `0`. If Slack no longer delivers A traffic after removal, record observed delivery count `0` and use registry state plus unchanged A storage as the stop-capture evidence.

15. **Prove two-channel isolation.** Run boundary-pinned aggregate queries in both directions. Record: A records returned under B scope, B records returned under A scope, same-timestamp distinct-record boolean, and any cross-boundary operation count. Expected: `0`, `0`, `true`, `0`.

16. **Sanitize and close.** Remove all temporary raw logs, database copies, screenshots, prompts, and message notes. Record only the aggregates above, deletion-complete boolean, operator sign-off role, and final GO/NO-GO. Expected: deletion complete `true`; GO only if every expected observation passed.

## Exceptions and findings

| Finding | Aggregate evidence | Disposition |
|---|---|---|
| Durable retry claims were initially lost across process restart | Offline restart case observed one unexpected capture before fix | Fixed in `45d2cac`; re-verification passed |
| Live execution pending | Checklist completed steps = `0/16` | Operator action required |

## Gate decision

- **Current:** Pending / NO-GO for live phase gate.
- **GO requires:** all eight acceptance rows pass live, cross-channel records/responses remain zero, counts match expectations, sanitation step passes, and no unresolved exception remains.
- **Final decision:** `<GO | NO-GO>`
- **Reason:** `<aggregate, content-free statement>`
