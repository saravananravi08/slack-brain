# Channel-context validation

- **Task:** T706
- **Acceptance scope:** CM-AC-08…11 plus recent-history and edit-refresh regressions
- **Offline status:** Pass
- **Live status:** Pending operator execution
- **P07 orchestrator-reuse gate:** Pending / NO-GO — do not declare GO until every live row below passes
- **Data posture:** Aggregate, content-free evidence only. Never record real workspace/channel/user/app IDs, message text, file names, URLs, tokens, database rows, prompts, model output, raw logs, event IDs, timestamps, traces, or screenshots containing them.

## Sanitized evidence rules

Use only channel aliases **A** and **B**. Record integer counts, deltas, section states, invocation counts, pass/fail booleans, and coarse UTC execution windows. Keep detailed source evidence in the approved ephemeral operator environment, then delete it after review.

Allowed examples: `semantic tool delta = 0`, `derived sections available = 2`, `cross-boundary evidence count = 0`, `exact row delta = 1`.

Forbidden examples: identifiers, copied source or answer text, event/message timestamps, observation payloads, Slack permalinks, database paths, tokens, full logs, prompts, responses, content-derived hashes, or screenshots.

## Runtime under validation

- Integration base: `76942db`
- Derived-invalidation fix: `f176f31`
- Implementation commit: `ef55108`
- Handoff commit: this report handoff commit
- Live execution window: `<UTC date/hour only>`
- Operator role: `<role only; no name or user ID>`
- Environment: `<internal test | internal production-like>`

## Acceptance matrix

| ID | Required aggregate result | Offline | Live |
|---|---|---|---|
| CM-AC-08 | Recent, summary, and observation context available; default-context semantic tool executions = 0 | Pass | Pending |
| CM-AC-09 | Old-detail semantic tool executions = 1; active-channel scope = true; sender/date citation = true | Pass | Pending |
| CM-AC-10 | Foreign exact, summary, observation, semantic, and answer evidence counts = 0 | Pass | Pending |
| CM-AC-11 | Observation failure count = 1; exact capture retained = true; history fallback succeeds; semantic tool executions = 0 | Pass | Pending |
| Edit refresh | Same exact source retained; derived refresh count = 1; stale derived evidence = 0; semantic tool executions = 0 | Pass | Pending |

## Offline evidence

Command: `npm test -- tests/e2e/channel-context`

- Test files: 1 passed
- Tests: 7 passed
- Acceptance IDs: 4 covered
- Synthetic channel boundaries: 2
- Default-context answer cases: 4
- Default-context semantic tool executions: 0
- Expected semantic-fallback executions: 3
- Scoped semantic executor mismatches: 0
- Cross-boundary evidence count: 0
- Observation failures injected: 1
- Exact records lost during observation failure: 0
- Edit refreshes settled: 1
- Stale derived evidence after edit: 0
- Deterministic offline model: true
- Real Gist tool loop: true
- Tool use classified from executor counts: true
- Tool use inferred from answer text: false
- Network/Slack/provider calls: 0
- Real identifiers/content used: 0

## Verification evidence

- `npm run typecheck`: Pass
- Focused suite: 1 passed file; 7 passed tests
- Full suite: 68 passed files; 3 skipped files; 1,033 passed tests; 5 skipped tests
- E2E suite: 7 passed files; 2 skipped files; 35 passed tests; 4 skipped tests
- `npm run build`: Pass
- `git diff --check`: Pass
- Scope violations: 0

## Live aggregate results

Fill only after checklist completion.

| Metric | Expected | Observed |
|---|---:|---:|
| Active enrolled channel count | 2 | `<pending>` |
| Distinct recent facts seeded | 2 | `<pending>` |
| Distinct old facts seeded | 2 | `<pending>` |
| Available derived sections across A/B | 4 | `<pending>` |
| Recent-answer semantic tool delta per channel | 0 | `<pending>` |
| Summary/observation answer semantic tool delta per channel | 0 | `<pending>` |
| Old-detail semantic tool delta per query | 1 | `<pending>` |
| Old-detail citations with sender/date | 2 | `<pending>` |
| Edit target exact-row delta | 0 | `<pending>` |
| Edit derived-refresh count | 1 | `<pending>` |
| Stale derived evidence after edit | 0 | `<pending>` |
| Observation failure count | 1 | `<pending>` |
| Exact capture delta during observation failure | 1 | `<pending>` |
| Failure-mode history answer semantic tool delta | 0 | `<pending>` |
| A evidence returned under B scope | 0 | `<pending>` |
| B evidence returned under A scope | 0 | `<pending>` |
| Cross-channel answer evidence count | 0 | `<pending>` |
| Raw evidence deletion complete | true | `<pending>` |

## Live operator checklist

All steps require two real **internal, non-Slack-Connect** channels approved for validation. Refer to them only as A and B in this report. Use disposable test content and never copy it into evidence.

1. **Prepare instrumentation and baseline.** Start one Gist process with content-free counters for exact capture, observation success/failure/lag, derived refresh, semantic-tool execution, scoped semantic result count, and response count. Record only UTC hour, process count, enrollment count, and per-alias aggregate counts.

2. **Confirm two active boundaries.** Verify Gist is enrolled in A and B and both are internal. Record enrolled count and distinct-boundary boolean. Expected: `2`, `true`. Stop if either channel is external, Slack Connect, shared with another workspace, or not approved.

3. **Seed distinct recent and old facts.** Post one disposable recent fact and one disposable old fact in each channel. Add enough later disposable traffic that each old fact falls outside bounded recent context while remaining semantically recallable. Record only per-alias accepted-row deltas. Expected: recent `+1`, old `+1`, no cross-boundary writes.

4. **Wait for derived context.** Allow background observation work to settle. Record summary-available and observations-available booleans plus observation lag bucket for A/B. Expected: both derived sections available in both channels; no observation failure.

5. **Check recent context first.** Ask one addressed recent-work question in each source channel. Record response count, semantic-tool delta, and grounded-answer boolean. Expected per alias: response `1`, semantic delta `0`, grounded `true`.

6. **Check rolling summary and observations.** Ask one addressed question whose available support is represented in derived context. Record available derived-section count and semantic-tool delta. Expected per alias: derived sections `2`, semantic delta `0`, grounded `true`.

7. **Check semantic fallback and citation.** Ask for the old fact in its source channel. Record semantic-tool delta, scoped-result count, active-scope-match boolean, and sender/date-citation boolean. Expected per alias: tool delta `1`, result count `>=1`, scope match `true`, citation `true`.

8. **Check edit refresh.** Edit one previously observed source in A. Wait for the derived-refresh counter to settle, then ask for the current wording. Record exact-row delta, same-identity boolean, refresh count, stale-evidence count, current-evidence boolean, and semantic-tool delta. Expected: row delta `0`, same identity `true`, refresh `1`, stale `0`, current `true`, semantic delta `0`.

9. **Inject observation-only failure.** Through the approved ephemeral validation control, fail one observation generation without disabling exact storage, answer generation, or semantic retrieval. Post one disposable recent source in B. Record observation-failure delta and exact-row delta. Expected: failure `1`, exact row `+1`. If no observation-only failure control exists, record `Not run` and keep gate NO-GO.

10. **Check history fallback during failure.** Before restoring observation generation, ask about the just-captured recent source in B. Record history-section availability, derived-section availability, response count, semantic-tool delta, and grounded-answer boolean. Expected: history available, derived unavailable or lagging, response `1`, semantic delta `0`, grounded `true`.

11. **Probe cross-channel leakage in both directions.** Ask in B for A's distinct recent and old facts, then ask in A for B's. Record foreign exact, summary, observation, semantic-result, and answer-evidence counts. Expected for every category and direction: `0`. A refusal or unverifiable response is acceptable; foreign evidence is not.

12. **Restore and sanitize.** Restore observation generation, confirm failure counter stops increasing, delete all temporary raw logs, prompts, responses, notes, screenshots, database copies, and traces created for validation, then record deletion-complete boolean and operator role. Expected: restored `true`, deletion complete `true`.

13. **Decide gate.** Mark GO only if every acceptance row and checklist expectation passed with zero cross-channel evidence. Otherwise record NO-GO with one aggregate, content-free reason and route the failing row to its owning task.

## Exceptions and findings

| Finding | Aggregate evidence | Disposition |
|---|---|---|
| Live execution pending | Checklist completed steps = `0/13` | Operator action required |

## Gate decision

- **Offline:** GO
- **Current overall:** Pending / NO-GO for orchestrator reuse
- **GO requires:** all four acceptance scenarios and edit refresh pass live, semantic invocation counts match policy, cross-channel evidence remains zero in both directions, observation failure preserves exact capture, sanitation passes, and no unresolved exception remains.
- **Final decision:** `<GO | NO-GO>`
- **Reason:** `<aggregate, content-free statement>`
