# Gist baseline benchmark

Synthetic, reviewable seed for comparing legacy and Mastra retrieval behavior. It contains no copied workspace messages or production identifiers.

## Files

- `benchmark.schema.json` — machine-readable dataset contract.
- `synthetic-seed.json` — synthetic corpus and eight acceptance cases.

## Categories

| Category | What it tests | PRD scenario |
|---|---|---|
| Semantic paraphrase | Different wording retrieves the original decision and reason | AC-07 |
| Exact value | Exact address survives retrieval and generation | AC-07 |
| Speaker attribution | Owner, sender, and date remain available | AC-07 |
| Thread context | Root cause and nearby reply are both available | AC-03, AC-07 |
| Unknown history | No evidence produces an explicit unverifiable answer | AC-08 |
| Channel isolation | Another channel cannot retrieve protected context | AC-11 |
| DM isolation | One user's private history cannot reach another user | AC-10 |
| Restart recall | Durable context remains after a process restart | AC-05 |

D009 still controls final product-wide citation policy. This seed requires sender/date only where historical metadata is present so attribution can be measured now without deciding broader launch policy.

## Repeatable run

1. Start from empty test storage.
2. Import only `corpus` records, preserving every ID and boundary.
3. For each case, clear transient process state. If `restart_before_query` is true, restart after import and before the query.
4. Submit `query` through the normal DM or channel request path described by `requester`. Do not use an explicit search command.
5. Record retrieved message IDs in rank order, answer text, milliseconds to first answer content, milliseconds to completed answer, response count, and reply location.
6. Score against `expected`. Two reviewers must evaluate the same saved output independently; resolve only claim-support disagreements, not system output.

Never run this seed against production storage. Never replace synthetic records with copied workspace text.

## Deterministic scoring

Score each case on four values in `[0,1]`.

### Relevance (`R`)

For cases with expected evidence:

```text
recall = expected evidence IDs retrieved / expected evidence ID count
precision = expected evidence IDs retrieved / retrieved ID count
R = (recall + precision) / 2
```

If no IDs were retrieved, precision is `0`. For cases with no expected evidence, `R = 1` only when no IDs are retrieved; otherwise `R = 0`. Any retrieved forbidden ID sets `R = 0` and triggers a privacy gate failure.

### Grounding (`G`)

Treat each `required_claims` entry as one atomic claim.

```text
G = max(0, supported required claim count - unsupported factual claim count)
    / required claim count
```

A required claim is supported only when the answer states an equivalent fact and expected evidence supports it. Stylistic wording does not matter. A factual statement not supported by expected evidence is unsupported. For `refuse_if_unverified: true`, the required unverifiable statement must be present and any asserted answer makes `G = 0`.

### Attribution (`A`)

- If `attribution.required` is false: `A = 1`.
- If required: sender and date present and correct → `1`; exactly one correct → `0.5`; neither correct or either wrong → `0`.

### Latency (`L`)

```text
L = (first answer content within budget + completed answer within budget) / 2
```

Each comparison is boolean. An unavailable first-content measurement scores `0` for that half. A typing/thinking indicator is not answer content.

### Overall

```text
case score = 0.35R + 0.35G + 0.15A + 0.15L
benchmark score = arithmetic mean of all case scores
```

Report retrieval rate separately as the percentage of cases with `R = 1`, grounded-answer accuracy as the percentage with `G = 1`, and unsupported-claim rate as unsupported factual claims divided by all factual answer claims. Also report p50/p90 first-content and completion latency.

Hard gates override averages:

- Any forbidden evidence retrieval or disclosure fails privacy.
- More than one final response fails the case.
- Wrong DM/channel/thread placement fails the case.
- A restart case run without the required restart is invalid, not failed.

Target comparison thresholds come from PRD Section 12: at least 85% grounded-answer accuracy, at least 80% relevant-retrieval rate, fewer than 5% unsupported factual claims, and no privacy leak.
