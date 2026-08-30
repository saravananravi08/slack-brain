# Implementation Decision Register

Product decisions originate in PRD Section 15. Coordinator owns this file. Do not resolve assumptions silently in task branches.

## Status legend

`Open` → `Proposed` → `Accepted` | `Rejected` | `Superseded` | `Deferred`

- **Open:** no drafted resolution.
- **Proposed:** a reasoned resolution is drafted and awaiting the named human owner's approval. **A `Proposed` decision does not unblock a downstream task.**
- **Accepted:** the named owner approved it. Only then may downstream tasks implement it.
- **Deferred (accepted):** a sub-item whose final value cannot be fixed yet. The stated **safe default is in force** and downstream tasks implement against it; the named owner supplies the final value by the stated deadline. A deferral does not block the tasks its parent decision unblocks.

D001–D010 below were drafted as proposals by the T001 planner on 2026-08-30 and **accepted the same day** by **Coordinator (Augment), acting under decision authority delegated by product owner saravanan on 2026-08-30**. They were drafted to safe, deny-by-default settings and were accepted without amendment — so the deny-by-default posture recorded in each entry is the posture downstream tasks must implement.

Five sub-items are carried as **accepted deferrals** (D001 production channel IDs, D003 archive date floor, D004 legal/HR retention holds, D006 production authorization posture, D010 residency assumption). Each names an owner, a deadline, and a safe default that is in force now. They do not hold up the decisions that contain them.

| ID | Decision | Status | Owner | Required before | Outcome |
|---|---|---|---|---|---|
| D001 | Approved Slack channel IDs | Accepted | Coordinator (Augment) | T004, T203, T401 | Deny-by-default allowlist from config; alpha = one test channel, beta = one approved team channel; real IDs never in Git |
| D002 | DM access to shared channel knowledge | Accepted | Coordinator (Augment) | T004, T202, T203 | DMs use private conversation memory only; shared-channel recall from DMs stays off behind a flag until separately approved |
| D003 | Historical archive date range and completeness | Accepted | Coordinator (Augment) | T301 | Full archive for approved channels only, staged; authoritative range measured from source DB in T301, not assumed |
| D004 | Message/embedding/trace retention | Accepted | Coordinator (Augment) | T004, T103, T504 | Tiered: channel messages indefinite while approved; DMs 90d; traces 30d; logs 14d; backups 35d; embeddings follow their message |
| D005 | Edit/delete propagation policy | Accepted | Coordinator (Augment) | T004, T404 | Propagate both: edits re-embed, deletes hard-delete message + embedding, idempotent, content-free tombstones |
| D006 | Workspace membership vs user allowlist | Accepted | Coordinator (Augment) | T203 | Workspace membership sufficient for internal beta; guests and external/Connect denied; allowlist built but empty |
| D007 | Generation model/provider | Accepted | Coordinator (Augment) | T101, T105 | Anthropic via Mastra model provider, pinned `claude-opus-5`, tuned by effort; `claude-sonnet-5` pre-approved step-down |
| D008 | Embedding model/provider | Accepted | Coordinator (Augment) | T201 | OpenAI `text-embedding-3-small` (1536-d); second provider is unavoidable — Anthropic has no embeddings endpoint |
| D009 | Citation requirement | Accepted | Coordinator (Augment) | T004, T205 | Sender + date required for every historical claim; unattributable evidence must be omitted or explicitly marked |
| D010 | Data residency/provider restrictions | Accepted | Coordinator (Augment) | T101, T103, T201 | No jurisdiction constraint for internal beta beyond US/EU providers under no-training terms; new provider = amendment |

---

## D001 — Approved Slack channel set

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: product owner; drafted by T001 planner)
- Context: PRD Section 15.1, FR-SLK-010, FR-OPS-002, FR-PRV-001. Gist ingests and answers from a defined channel set; automatic access to every workspace channel is an explicit non-goal (Section 5). The legacy implementation used a single `SLACK_CHANNEL_ID` env var with a placeholder default, which is exactly the hardcoded-default pattern FR-OPS-002 forbids.
- Options considered:
  1. **All public channels the bot can see.** Rejected: contradicts Section 5 and makes the privacy boundary undefinable — every new channel silently joins the corpus.
  2. **Explicit deny-by-default allowlist of Slack channel IDs supplied by configuration.** Ingestion, retrieval, and generation all require membership in this list.
  3. **Allowlist plus per-channel policy metadata** (retention override, cross-channel sharing, citation rules). Rejected for v1 as premature: no second policy dimension is needed until D002 flips.
- Decision: Adopt option 2. A single ordered allowlist of Slack channel IDs is supplied via configuration (configuration variable `GIST_APPROVED_CHANNEL_IDS`, comma-separated) with **no default value**; startup validation (T102) fails closed when it is absent, empty, or contains a malformed ID. The list is the sole authority for three separate gates — accept event, write to memory, retrieve from memory — and each gate is checked independently rather than inferred from the others.
  - Alpha: exactly one dedicated test channel provisioned by T003 in the separate test workspace.
  - Internal beta: exactly one approved team channel, named by the product owner before T505.
  - Production: the owner supplies the final list before T506; adding a channel later is a configuration change plus a re-import decision, not a code change.
  - Private channels are eligible only when Gist has been explicitly invited **and** the ID appears in the allowlist. Slack Connect / external shared channels are excluded regardless of allowlist contents (FR-PRV-006); the allowlist is not a way to opt one in.
  - Real channel IDs live in the operator's environment/secret store and in the deployment runbook (T504), never in Git, `.env.example`, tests, or fixtures. Test vectors use synthetic IDs.
- Consequences:
  - T004 must express the allowlist as a contract input to the authorization, ingestion, and retrieval interfaces, not as an ambient global.
  - T102 must reject startup on an empty or malformed list — this is the difference between "no channels approved" and "all channels approved," and the failure mode must be the safe one.
  - T203 implements the three gates with explicit deny reasons; T401/T402 filter events before any storage write.
  - Removing a channel from the allowlist triggers the D004 purge path (30 days), so allowlist edits are not free — the owner should treat the list as durable.
  - **Accepted deferral —** the safe default below is in force now: the concrete production channel IDs are not resolvable by the planner. This is a deferral with owner = product owner, deadline = before T505, safe default = the single beta channel only.
- Affected tasks/files: T004, T102, T203, T301, T401, T402, T504, T505, T506.

## D002 — DM access to shared channel knowledge

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: product owner / security owner; drafted by T001 planner)
- Context: PRD Section 15.2, Section 9 ("Direct-message memory"), UJ2 step 3, FR-PRV-003/004/005. A DM has two context types: the user's private conversation with Gist, and shared knowledge from approved channels. The PRD deliberately leaves the second one as a launch decision because a DM is the one surface with no channel-membership signal attached to the request — asking Gist privately is the cheapest way to probe a corpus the asker may not be entitled to.
- Options considered:
  1. **Private DM conversation memory only.** DMs recall only what that user and Gist have said to each other. Maximally safe; the DM becomes much less useful for historical recall.
  2. **Shared-channel knowledge, scoped to the asker's live channel membership.** Each DM request resolves the user's current channel memberships and restricts retrieval to the intersection with the approved list. Useful and defensible, but correctness depends on a live membership lookup on every request, its cache, and its failure mode — a lookup that fails open is a silent leak.
  3. **Shared-channel knowledge across all approved channels regardless of membership.** Rejected outright: any workspace member could extract the contents of a private approved channel they were never in, which fails NFR-SEC-004 and AC-11.
- Decision: Adopt option 1 for internal alpha and internal beta. **DMs may NOT read shared channel knowledge until this decision is explicitly re-approved with option 2.** The capability is built behind configuration (configuration flag `GIST_DM_SHARED_KNOWLEDGE`, default `false`) so enabling it later needs no code change, but the flag must remain `false` until all of the following hold: (a) the owner approves option 2 in writing as an amendment to this entry; (b) T203 implements membership resolution that **fails closed** — a failed or stale membership lookup denies retrieval rather than allowing it; (c) the T502 privacy suite covers the non-member, ex-member, guest, and deactivated-user cases and passes.
  - Independent of this flag and never configurable: private DM messages are never written into a channel knowledge boundary (FR-PRV-004), and one user's DM history is never readable by another user (FR-PRV-003).
- Consequences:
  - Beta users asking historical questions **in DMs** will frequently get "I could not verify that" (FR-RSP-006). This is correct behavior under this decision, not a retrieval bug, and it must be stated in the beta onboarding note (T505) or it will be reported as a defect.
  - The T205 retrieval benchmark must be scored against the **channel** surface. Benchmarking historical recall through DMs under this decision would measure the policy, not the retrieval quality.
  - T202 must produce resource identities where a DM thread can never resolve to a channel resource — the isolation should be structural, not a runtime filter over a shared namespace.
  - This is the decision most likely to be overturned by real beta usage. Overturning it is a re-approval of this entry plus the T502 gate, not a config edit.
- Affected tasks/files: T004, T202, T203, T204, T205, T502, T505.

## D003 — Historical archive scope and authoritative date range

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: product owner; drafted by T001 planner)
- Context: PRD Section 15.3, Section 10, G3, FR-MEM-005/006. The existing SQLite archive is product data, not migration scaffolding. Downstream (T301) needs a bounded, stated import contract; "import everything" is not a contract until someone has counted what everything is.
- Options considered:
  1. **Full archive, all channels.** Rejected: it would import channels outside the D001 allowlist, creating a corpus with no defensible boundary.
  2. **Full archive restricted to approved channels, imported in stages** (sample → benchmark → full).
  3. **Rolling window** (e.g. most recent 12 months). Cheaper and lower risk, but it discards exactly the old decisions that motivate the product (UJ3), so it trades away the main value to save storage that is not scarce.
- Decision: Adopt option 2. The import scope is *all messages in the source archive whose channel ID is in the D001 allowlist*, with no date floor beyond the D004 retention rules.
  - The **authoritative date range is measured, not assumed**: T301 must record `MIN(ts)` and `MAX(ts)`, message count, and thread count per approved channel from the source database, and publish those numbers in the import contract. T002's baseline capture supplies the pre-existing counts to reconcile against.
  - Record eligibility for v1: a record is imported when it has a channel ID in the allowlist, a parseable timestamp, a resolvable human sender, and non-empty text. Bot messages, join/leave and other system subtypes, and file-only messages with no text are skipped by design (FR-SLK-009, and they pollute recall without adding recallable knowledge).
  - Skipped and failed records are **counted and categorized** in the import report; counts are not silently dropped. Message content must not appear in that report (FR-PRV-008).
  - Staging: T306 imports a bounded sample — the most recent 30 days or 2,000 messages, whichever is larger — and T205's benchmark must pass on that sample before T307 imports the remainder (PRD Section 10, R4).
  - The source database stays read-only and is not deleted until the rollback window closes (FR-OPS-006).
- Consequences:
  - T301 cannot begin until D001 is Accepted; without the allowlist there is no scope expression. This is a real ordering constraint the coordinator should reflect.
  - If the measured range or counts differ materially from the T002 baseline, that is a blocker for T301, not a rounding difference to absorb — it means the source is not what the plan assumed.
  - Records skipped for a missing sender or timestamp are permanently uncitable under D009; the two decisions must stay consistent.
  - **Accepted deferral —** the safe default below is in force now: whether any date floor applies at all (e.g. "nothing before the company reorg") is a product judgment the planner cannot make. Deferral owner = product owner, deadline = before T301, safe default = no floor, import everything in the approved channels.
- Affected tasks/files: T002, T205, T301, T302, T303, T306, T307.

## D004 — Retention for messages, embeddings, and traces

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: product owner / security owner; drafted by T001 planner)
- Context: PRD Section 15.4, R7, FR-PRV-008/009, NFR-SEC-002. Gist creates at least three sensitive stores: message text, derived embeddings, and Mastra traces. Tracing in particular is a second copy of message content with different access controls, which is the risk R7 names.
- Options considered:
  1. **Indefinite retention for everything.** Simple, and matches the product's "remembers everything" premise for channel content — but applying it to traces and DMs means an ever-growing sensitive store with no justification.
  2. **Single short window for everything** (e.g. 12 months). Destroys the core product value: the decisions worth recalling are usually the old ones.
  3. **Tiered retention by data class,** matching each store's purpose.
- Decision: Adopt option 3, with these tiers:

  | Data class | Retention | Rationale |
  |---|---|---|
  | Approved-channel messages | Indefinite while the channel remains approved; reviewed annually | This is the product (G3, UJ3) |
  | Embeddings of channel messages | Same lifetime as their source message, deleted in the same operation | An orphaned embedding is recallable content that no longer exists |
  | Private DM conversation memory | 90 days rolling | Supports follow-ups and thread continuity without accumulating a private corpus |
  | Mastra traces | 30 days, operator-restricted access | Long enough to debug a bad answer (FR-OPS-004); short enough to bound R7 |
  | Application logs | 14 days, no message bodies or tokens | FR-PRV-008 |
  | Backups of persistent storage | 35 days rotating | Covers the pre-import and pre-cutover backups (FR-OPS-003) with one cycle of margin |

  - Channel removed from the D001 allowlist: its messages and embeddings are purged within 30 days.
  - Retention deletion uses the **same delete primitive as D005** — one code path, so a retention purge cannot leave behind rows that a deletion would have removed.
- Consequences:
  - T103 configures trace retention and access restriction at storage setup; T504 documents the purge job, its schedule, and backup rotation in the runbook.
  - T404 owns the retention sweep. If Mastra's storage/vector API exposes no supported delete for embedding rows, T404 must **stop and record a blocker** (per its own step 5) rather than leaving orphaned vectors — orphaned embeddings would let Gist recall deleted content, breaking both this decision and D005.
  - Backups contain data past its retention window by design; the runbook must state that restoring an old backup reintroduces purged records and requires re-running the purge.
  - **Accepted deferral —** the safe default below is in force now: whether any legal, contractual, or HR-related hold obligates a different channel-message retention. Deferral owner = security owner, deadline = before T504, safe default = the table above.
- Affected tasks/files: T004, T103, T404, T502, T503, T504.

## D005 — Slack edit and delete propagation

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: product owner; drafted by T001 planner)
- Context: PRD Section 15.5, FR-MEM-006/007. Slack is the system of record for its own messages. If a user edits or deletes a message and Gist can still quote the original, Gist is leaking content the user has retracted — the most likely real-world privacy complaint in an internal tool.
- Options considered:
  1. **Ignore mutations.** Cheapest, and wrong: Gist quotes deleted text back to the team.
  2. **Propagate edits and deletes into Mastra memory,** keeping Slack's user-visible state authoritative.
  3. **Content tombstones** retaining the original text for audit. Rejected: it preserves exactly the content the user asked to remove, and no requirement calls for an audit trail of message content.
- Decision: Adopt option 2.
  - `message_changed`: update the stored text in place and re-embed. The record keeps its identity (message ID, channel, thread, sender, original timestamp) and gains an edit timestamp. Stale embeddings from the pre-edit text must not survive the update.
  - `message_deleted`: hard-delete the message record **and** its embedding. What remains is a content-free tombstone — message ID plus deletion timestamp — retained only so a late redelivery of the original message is not re-ingested (FR-SLK-008, NFR-REL-002).
  - Both handlers are idempotent, keyed on Slack message identity: replaying a mutation is a no-op success, and a mutation for a message Gist never stored is a no-op success, not an error (Gist may legitimately have skipped it under D003 eligibility rules).
  - Authorization runs **before** lookup (T404 step 2): a mutation event for an unapproved channel is denied without touching storage, so mutation events cannot be used to probe what Gist has stored.
  - Channel-level removal (channel deleted, or dropped from the D001 allowlist) triggers the D004 purge path, sharing the same delete primitive.
  - Out of scope for v1: reconciling deletions that happened while Gist was offline or that predate the archive import. Slack does not replay them, and back-filling would require re-reading history. This is a known, stated gap — the practical mitigation is that a user who notices stale content can re-delete or ask the operator to purge.
- Consequences:
  - T402 must surface `message_changed` / `message_deleted` subtypes distinctly rather than collapsing them into generic message events; T004's event contract must carry the mutation shape and the prior message reference.
  - T404's tests must cover: edit, delete, replayed mutation, mutation for a missing original, mutation from an unapproved channel, and a late retry arriving after a delete.
  - The offline-gap exclusion should be listed as a known limitation in the T504 runbook so operators can answer the question when it comes up.
- Affected tasks/files: T004, T402, T404, T405, T504.

## D006 — Authorization: workspace membership vs user allowlist

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: product owner / security owner; drafted by T001 planner)
- Context: PRD Section 15.6, FR-SLK-002 ("authorized workspace users"), FR-PRV-006, Section 14 (internal beta is a limited group of team users). The question is whether being in the workspace is enough to talk to Gist.
- Options considered:
  1. **Workspace membership is sufficient.** Any full member of the approved workspace may DM Gist and mention it in an approved channel.
  2. **Explicit user allowlist.** Only enumerated user IDs may interact. Tighter, but it adds an operator maintenance burden and a new failure mode (legitimate user silently denied) for a bot whose corpus is already bounded to channels the same people can read in Slack directly.
  3. **Derive per-request authorization from channel membership.** This is really D002's mechanism, not a separate posture for v1.
- Decision: Adopt option 1 for internal alpha and internal beta: **workspace membership is sufficient**, subject to these exclusions, which are not optional:
  - Slack Connect / external / cross-workspace users: denied (FR-PRV-006), before any retrieval or generation.
  - Single-channel and multi-channel **guests**: denied. A guest is not a full member and the "they could read it in Slack anyway" argument does not hold for them.
  - Bots, apps, and Gist itself: ignored (FR-SLK-009).
  - Deactivated users: denied.
  - The rationale is that under D002 (DMs are private-memory-only) and D001 (channel answers require the asker to be in an approved channel), workspace membership does not by itself grant access to any channel corpus. If D002 is later flipped to membership-scoped shared knowledge, this decision must be revisited in the same review — the two are only safe together.
  - **T203 must still implement the allowlist mechanism** (configuration variable `GIST_USER_ALLOWLIST`, empty meaning "all full workspace members"), so tightening to option 2 for production is a configuration change, not new code under time pressure.
- Consequences:
  - T203 needs table-driven tests covering full member, guest (both kinds), external/Connect user, deactivated user, bot, and malformed identity — with an explicit deny reason for each that is safe to log and safe to show a user (FR-RSP-007/008).
  - T502 must confirm no path grants access on a *failed* identity lookup; identity resolution failures deny.
  - **Accepted deferral —** the safe default below is in force now: production posture. This accepted decision covers alpha and beta only; the owner should decide before T506 whether production keeps membership-based access or switches on the allowlist. Deferral owner = security owner, deadline = before T506, safe default = enable the allowlist for production cutover.
- Affected tasks/files: T203, T204, T404, T502, T505, T506.

## D007 — Generation model and provider

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: technical owner; drafted by T001 planner)
- Context: PRD Section 15.7, G5, NFR-MNT-001/004, NFR-PERF-002/003, success metric of ≥85% grounded-answer accuracy. The legacy implementation shelled out to the Claude CLI as a child process; the migration removes that entirely and calls one model through Mastra's model provider. Model choice is bounded by three PRD constraints at once: grounding quality, first-token latency under 5s for 90% of requests, and cost during a full-archive beta.
- Options considered:
  1. **Anthropic Claude via Mastra's model provider.** Keeps the existing model lineage (the current bot is Claude-based), so the persona and grounding behavior are the closest to the baseline T002 measures.
  2. **A different commercial provider.** No advantage identified for this workload, and it would make T002's baseline non-comparable — the benchmark would be measuring a provider change and a framework change at once.
  3. **Self-hosted open-weights model.** Rejected for v1: it adds inference infrastructure to a project whose stated goal (G5) is operational simplicity.
- Decision: Adopt option 1, Anthropic via Mastra's configured model provider, with `GIST_MODEL` pinned to an exact model ID and no default value (FR-OPS-002, NFR-MNT-001).
  - Selected model: **`claude-opus-5`** (1M context; $5 / $25 per million input / output tokens). Quality is the binding constraint here — the ≥85% grounded-accuracy and <5% unsupported-claim targets are what the release is judged on, and the cheaper choice is only cheaper if it clears them.
  - Cost and latency are tuned **first** by request shape rather than by downgrading: adaptive thinking with a low or medium effort setting for ordinary Slack Q&A, streaming responses (which NFR-PERF-002 requires anyway), and prompt caching on the stable persona/instruction prefix, which is identical across nearly every request and is the single largest cheap win available.
  - **Pre-approved step-down:** if T205 shows the accuracy targets are met and T503 shows cost or latency pressure, the technical owner may switch to `claude-sonnet-5` ($2 / $10 per million, same 1M context) without reopening this decision — provided the full T205 benchmark is re-run on the new model and the result recorded. Any move to a *different provider* is a new decision, not a step-down.
  - Model IDs are used exactly as written, with no date suffix appended. Changing the pinned ID at any time requires re-running T205, because the benchmark thresholds are model-specific.
  - No `claude` child process, CLI invocation, or MCP memory dependency may appear in the production request path (NFR-MNT-004).
- Consequences:
  - T102 must require `GIST_MODEL` and the provider API key at startup with no defaults, and must fail closed.
  - T105 configures the agent; the persona prompt must be stable enough to be cache-eligible, which argues for keeping volatile content (timestamps, user IDs, retrieved context) after the stable prefix rather than interleaved.
  - T205 records the benchmark result **against the pinned model ID**; T503 tracks per-response cost and latency and is the trigger for the step-down clause.
  - Sending message content to a third-party model provider is the residual privacy exposure; it is bounded by D010's no-training / limited-retention requirement.
- Affected tasks/files: T101, T102, T105, T205, T503.

## D008 — Embedding model and provider

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: technical owner; drafted by T001 planner)
- Context: PRD Section 15.7 (second half), FR-MEM-002/009, `EMBEDDING_MODEL` in the migration plan's target environment. Semantic recall over the full archive depends entirely on this choice, and unlike the generation model it is **expensive to change after import**.
- Options considered:
  1. **OpenAI `text-embedding-3-small`** (1536 dimensions). Widely supported across frameworks, inexpensive at archive scale, strong paraphrase retrieval — which is precisely what FR-MEM-009 and the ≥80% paraphrased-retrieval target measure.
  2. **A dedicated retrieval-embedding provider** (e.g. Voyage). Potentially better recall quality; adds a third vendor and a third residency review for a benefit that is unmeasured until T205 exists.
  3. **Local/self-hosted embeddings.** Removes the third-party exposure for message text, but adds inference infrastructure against G5 and is slow for a full-archive backfill.
- Decision: Adopt option 1 as the default: `EMBEDDING_MODEL=openai/text-embedding-3-small`, 1536 dimensions, configured with no default value and validated at startup.
  - **A second provider is unavoidable and should be recorded as such rather than treated as an oversight:** Anthropic exposes no embeddings endpoint, so D007 cannot supply embeddings. Choosing option 1 means message text is sent to two providers, and D010 must cover both.
  - T201 must confirm the exact provider/model identifier against the pinned Mastra version's supported embedder list before committing to it; if Mastra does not support this embedder cleanly, T201 stops and records a blocker rather than substituting one silently — an undocumented substitution would change the vector dimension underneath the whole corpus.
  - **The vector dimension is locked before T307.** The libSQL vector index is built for a fixed dimension, so changing the embedding model after the full import requires re-embedding and re-indexing the entire archive. If option 2 is ever to be evaluated, it must happen during T205 on the T306 sample, not after T307.
  - Option 2 remains the named fallback if T205 misses the ≥80% paraphrased-retrieval target and tuning (chunking, recall depth, nearby-context window) does not close the gap.
- Consequences:
  - T201 owns the memory/embedder configuration and the dimension constant; T004's storage contract should state the dimension explicitly so a mismatch fails loudly rather than at query time.
  - A second provider API key enters configuration and the runbook (T102, T504).
  - The embedding provider is also a re-embedding dependency for D005 edits — every edit costs an embedding call, which is negligible per message but relevant to T503's cost tracking during a busy channel's backfill.
- Affected tasks/files: T004, T102, T201, T205, T304, T307, T503, T504.

## D009 — Citation requirement for historical answers

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: product owner; drafted by T001 planner)
- Context: PRD Section 15.8, FR-MEM-011/012, FR-RSP-005, UJ3 step 4, and the <5% unsupported-factual-claims metric. FR-MEM-012 says Gist "should cite sender and date when reliable metadata is available," which leaves open what happens when it is not available — and that gap is exactly where an unsupported claim gets presented as fact.
- Options considered:
  1. **Citation always required, no exceptions.** Would force Gist to cite or refuse even for statements about the current conversation, making normal replies stilted.
  2. **Citation required for every claim drawn from retrieved history; unattributable evidence must be omitted or explicitly marked.** Closes the gap without touching conversational replies.
  3. **Citation optional / best-effort.** Rejected: it makes the <5% unsupported-claims metric unenforceable, because an uncited claim and a hallucinated one look identical to a reviewer.
- Decision: Adopt option 2.
  - Every factual claim Gist makes **about the past, drawn from retrieved messages**, carries a sender and a date. Accepted inline form: `— @alice, 12 Mar 2026`. A Slack permalink is included where it can be derived from workspace domain, channel, and timestamp; its absence is not a blocker.
  - If a retrieved item lacks a reliable sender or timestamp, Gist must either omit the claim or state it as unattributed ("I have a note about this but can't confirm who said it or when"). It must not present it as an established fact.
  - Statements about the current thread or DM, clarifying questions, and Gist's own reasoning need no citation — they are not historical claims.
  - When evidence is insufficient, FR-RSP-006 governs: say it could not verify, rather than citing something adjacent and hoping.
  - Citations must never expose internal identifiers, storage paths, resource/thread IDs, or trace IDs (FR-RSP-007). A citation is a human-readable attribution, not a debug handle.
- Consequences:
  - T004's retrieval contract must carry sender display name, timestamp, and channel on every retrieved item — a retrieval result that returns text alone cannot satisfy this decision, which makes this a contract requirement rather than a prompt requirement.
  - T105's instructions encode the citation rule; T205's benchmark scores attribution presence and correctness as a distinct dimension from grounding, since a correct answer with a wrong attribution is its own failure mode.
  - T301/T303 must preserve sender and timestamp through import; records lacking them are skipped under D003, which is what keeps this decision satisfiable.
  - Responses get slightly longer, which interacts with the 300-word guidance in FR-RSP-003. Attribution wins where they conflict; T105 should keep citations terse rather than dropping them.
- Affected tasks/files: T004, T105, T205, T301, T303, T501.

## D010 — Data residency and provider restrictions

- Status: Accepted
- Date: 2026-08-30
- Owner: Coordinator (Augment) — delegated by product owner saravanan 2026-08-30 (accountable role: security owner; drafted by T001 planner)
- Context: PRD Section 15.9, NFR-SEC-001/002, R7. Under D007 and D008, message text and its embeddings leave the operator's infrastructure for two third-party providers. The question is whether any jurisdictional constraint applies to where that processing and storage happen.
- Options considered:
  1. **No residency constraint at all.** Rejected: it leaves nothing for T101/T103/T201 to check, and makes adding an arbitrary provider a silent decision.
  2. **No jurisdiction-specific requirement, but a bounded provider and storage rule** — US/EU-operated providers under contractual no-training and limited-retention terms, with primary storage on operator-controlled infrastructure.
  3. **Strict single-jurisdiction residency** (e.g. all processing in one region). Would constrain provider choice significantly for an internal tool holding the company's own Slack messages, with no identified obligation requiring it.
- Decision: Adopt option 2. For internal alpha and beta there are **no special residency constraints beyond using US/EU-operated providers**, subject to:
  - Model and embedding providers must operate in the US or EU and must be under commercial terms that do not train on submitted data and that bound retention (abuse-monitoring windows are acceptable; indefinite retention for training is not).
  - Primary storage — the Mastra store and vector store — stays on infrastructure the operator controls: a libSQL file outside the Git repository for single-process deployment, or a managed database with restricted network access if the service becomes multi-instance. It must not be publicly accessible (NFR-SEC-002), and database files, embeddings, and imported Slack data are never committed (FR-PRV-007).
  - Traces are treated as a residency-relevant store, not as ordinary telemetry: they carry message content, so their location and access restriction fall under this decision and their retention under D004.
  - **Introducing any new provider that receives message text or embeddings — including a change of embedding provider under D008's fallback — requires an amendment to this entry approved by the security owner.** Two providers is the approved count.
- Consequences:
  - T101 (provider wiring), T103 (storage and tracing location/access), and T201 (embedder) each inherit a concrete constraint to check rather than an open question.
  - T502's security review verifies the storage is not publicly reachable, the database is outside version control, and no third provider has been introduced.
  - **Accepted deferral —** the safe default below is in force now, on this stated assumption: the planner assumes this corpus is the company's own internal Slack discussion, with no customer PII, regulated data, or contractual residency obligation attached. The operating entity is Australian, so if a customer contract, a compliance program, or a future external-facing use ever imposes AU or other residency requirements, this decision must be revisited before that use — it is scoped to an internal tool over internal conversation. Deferral owner = security owner, deadline = before T506, safe default = the constraints above.
- Affected tasks/files: T101, T103, T201, T502, T504, T506.

---

## Decision entry template

```text
## Dxxx — Title
- Status: Proposed | Accepted | Rejected | Superseded | Deferred (accepted)
- Date:
- Owner:
- Context:
- Options considered:
- Decision:
- Consequences:
- Affected tasks/files:
```
