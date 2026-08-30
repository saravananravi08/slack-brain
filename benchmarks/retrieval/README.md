# Retrieval benchmark harness

Scores saved retrieval/generation observations without calling Slack, a model, or production storage. The committed datasets are synthetic conversions of `benchmarks/baseline/synthetic-seed.json`.

## Run

```bash
npm run benchmark:retrieval -- --dataset benchmarks/retrieval/synthetic
```

The runner recursively loads `*.benchmark.json`, sorts case reports by ID, prints a content-free JSON report, and exits:

- `0` — thresholds and hard gates pass.
- `1` — threshold or hard-gate failure.
- `2` — invalid arguments or dataset.

Optional comparison metadata/output:

```bash
npm run benchmark:retrieval -- \
  --dataset benchmarks/retrieval/synthetic \
  --commit "$(git rev-parse HEAD)" \
  --output benchmarks/retrieval/artifacts/report.json
```

`artifacts/` is ignored. Do not force-add it. Reports intentionally contain metrics, case IDs, model IDs, and commit hash only—never queries, answers, retrieved message bodies, prompts, or traces.

## Recording a run

1. Start with empty non-production test storage and import only approved synthetic/redacted corpus records.
2. Run each query through automatic pre-generation retrieval. Never expose retrieval as a model-callable tool.
3. Record retrieved message keys in rank order, timing, response count, reply placement, restart execution, and citation sender/date.
4. Save only redacted or synthetic observations. Set `synthetic: true`; the runner rejects any other value.
5. Have two reviewers independently classify required and unsupported factual claims. Resolve claim-support disagreements only; do not alter system output.
6. Run the harness and retain its content-free JSON report outside Git or in the ignored `artifacts/` directory.

## Reviewer rubric

For each case:

- `supported_required_claims`: count required claims stated equivalently and supported by expected evidence.
- `unsupported_factual_claims`: count factual answer claims unsupported by expected evidence.
- `factual_claims`: count all factual answer claims; must be at least the unsupported count.
- `forbidden_disclosure`: protected or out-of-boundary content appeared in the answer, even if retrieval IDs are incomplete.
- `refusal_confirmed`: answer explicitly says available evidence cannot verify the request.
- `asserted_answer`: answer nevertheless asserts the requested unknown value or fact.

Claim wording may differ. Partial facts count only when the complete atomic required claim is present. A no-answer case with `asserted_answer: true` deterministically gets grounding `0` and at least one unsupported claim, regardless of reviewer counts.

Attribution is deterministic against expected sender and date. D009 requires both for each historical claim; the baseline expectation identifies the attribution under test. Current-thread reasoning and explicit no-answer responses do not require attribution.

## Scoring

Retrieval (`R`), grounding (`G`), attribution (`A`), latency (`L`), and overall score preserve the baseline formulas:

```text
case score = 0.35R + 0.35G + 0.15A + 0.15L
```

Retrieval and answer quality are also separated:

```text
retrieval score = mean(R)
answer score = mean((0.35G + 0.15A + 0.15L) / 0.65)
```

PRD thresholds:

- relevant retrieval rate: `>= 0.80`
- grounded-answer accuracy: `>= 0.85`
- unsupported factual-claim rate: `< 0.05`
- privacy leaks: `0`

Any forbidden evidence retrieval or disclosure, extra final response, wrong reply placement, or missing required restart fails the run regardless of averages. Missing first-content timing scores zero for that latency half. p50/p90 use nearest-rank percentiles and omit unavailable first-content observations.

## Comparison

Compare reports only when `dataset.version`, `model_id`, `embedding_model`, and thresholds match. `source_commit` identifies code under test. Reports omit wall-clock generation time so identical inputs produce stable output across reruns.
