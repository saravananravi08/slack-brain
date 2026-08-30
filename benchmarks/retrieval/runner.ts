import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface BenchmarkThresholds {
  relevant_retrieval_rate_min: number;
  grounded_answer_accuracy_min: number;
  unsupported_claim_rate_max_exclusive: number;
  privacy_leaks_max: number;
}

export interface BenchmarkCase {
  id: string;
  category: string;
  query: string;
  expected: {
    evidence_ids: string[];
    forbidden_evidence_ids: string[];
    required_claims: string[];
    refuse_if_unverified: boolean;
    attribution: {
      required: boolean;
      sender: string | null;
      date: string | null;
    };
  };
  latency_budget_ms: {
    first_content: number;
    complete: number;
  };
  restart_before_query?: boolean;
  observed: {
    retrieved_evidence_ids: string[];
    supported_required_claims: number;
    unsupported_factual_claims: number;
    factual_claims: number;
    forbidden_disclosure: boolean;
    refusal_confirmed: boolean;
    asserted_answer: boolean;
    attribution_sender: string | null;
    attribution_date: string | null;
    first_content_ms: number | null;
    complete_ms: number;
    response_count: number;
    reply_location_correct: boolean;
    restart_performed?: boolean;
  };
}

export interface BenchmarkDataset {
  schema_version: 1;
  dataset_id: string;
  dataset_version: string;
  synthetic: true;
  model_id: string;
  embedding_model: string;
  thresholds: BenchmarkThresholds;
  cases: BenchmarkCase[];
}

export interface CaseReport {
  id: string;
  category: string;
  retrieval_score: number;
  grounding_score: number;
  attribution_score: number;
  latency_score: number;
  answer_score: number;
  overall_score: number;
  unsupported_factual_claims: number;
  factual_claims: number;
  privacy_leak: boolean;
  response_gate_passed: boolean;
  placement_gate_passed: boolean;
  valid: boolean;
}

export interface BenchmarkReport {
  report_version: 1;
  source_commit: string;
  dataset: {
    id: string;
    version: string;
    synthetic: true;
    model_id: string;
    embedding_model: string;
  };
  thresholds: BenchmarkThresholds;
  metrics: {
    retrieval_score: number;
    answer_score: number;
    benchmark_score: number;
    relevant_retrieval_rate: number;
    grounded_answer_accuracy: number;
    unsupported_claim_rate: number;
    latency_ms: {
      first_content_p50: number | null;
      first_content_p90: number | null;
      complete_p50: number;
      complete_p90: number;
    };
  };
  gates: {
    relevance_passed: boolean;
    grounding_passed: boolean;
    unsupported_claims_passed: boolean;
    privacy_passed: boolean;
    response_passed: boolean;
    placement_passed: boolean;
    validity_passed: boolean;
  };
  passed: boolean;
  cases: CaseReport[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid benchmark dataset: ${message}`);
}

function finiteNumber(value: unknown, label: string): asserts value is number {
  invariant(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number`);
}

function rate(value: unknown, label: string): asserts value is number {
  finiteNumber(value, label);
  invariant(value >= 0 && value <= 1, `${label} must be in [0,1]`);
}

function validateDataset(dataset: BenchmarkDataset): void {
  invariant(dataset.schema_version === 1, 'schema_version must be 1');
  invariant(dataset.synthetic === true, 'synthetic must be true');
  invariant(Boolean(dataset.dataset_id), 'dataset_id is required');
  invariant(Boolean(dataset.dataset_version), 'dataset_version is required');
  invariant(Boolean(dataset.model_id), 'model_id is required');
  invariant(Boolean(dataset.embedding_model), 'embedding_model is required');
  invariant(Array.isArray(dataset.cases) && dataset.cases.length > 0, 'cases must not be empty');

  rate(dataset.thresholds.relevant_retrieval_rate_min, 'relevant_retrieval_rate_min');
  rate(dataset.thresholds.grounded_answer_accuracy_min, 'grounded_answer_accuracy_min');
  rate(dataset.thresholds.unsupported_claim_rate_max_exclusive, 'unsupported_claim_rate_max_exclusive');
  invariant(dataset.thresholds.privacy_leaks_max === 0, 'privacy_leaks_max must be 0');

  const ids = new Set<string>();
  for (const benchmarkCase of dataset.cases) {
    invariant(Boolean(benchmarkCase.id) && !ids.has(benchmarkCase.id), `case id ${benchmarkCase.id} must be unique`);
    ids.add(benchmarkCase.id);
    invariant(Boolean(benchmarkCase.query), `${benchmarkCase.id}.query is required`);
    invariant(benchmarkCase.expected.required_claims.length > 0, `${benchmarkCase.id} requires at least one claim`);
    invariant(benchmarkCase.latency_budget_ms.first_content > 0, `${benchmarkCase.id} first-content budget must be positive`);
    invariant(benchmarkCase.latency_budget_ms.complete > 0, `${benchmarkCase.id} completion budget must be positive`);

    const observed = benchmarkCase.observed;
    for (const [label, value] of [
      ['supported_required_claims', observed.supported_required_claims],
      ['unsupported_factual_claims', observed.unsupported_factual_claims],
      ['factual_claims', observed.factual_claims],
      ['complete_ms', observed.complete_ms],
      ['response_count', observed.response_count],
    ] as const) {
      finiteNumber(value, `${benchmarkCase.id}.${label}`);
      invariant(Number.isInteger(value) && value >= 0, `${benchmarkCase.id}.${label} must be a non-negative integer`);
    }
    invariant(observed.supported_required_claims <= benchmarkCase.expected.required_claims.length, `${benchmarkCase.id} supports more required claims than exist`);
    invariant(observed.unsupported_factual_claims <= observed.factual_claims, `${benchmarkCase.id} unsupported claims exceed factual claims`);
    if (observed.first_content_ms !== null) {
      finiteNumber(observed.first_content_ms, `${benchmarkCase.id}.first_content_ms`);
      invariant(observed.first_content_ms >= 0, `${benchmarkCase.id}.first_content_ms must not be negative`);
    }
  }
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function scoreCase(benchmarkCase: BenchmarkCase): CaseReport {
  const expectedIds = new Set(benchmarkCase.expected.evidence_ids);
  const retrievedIds = new Set(benchmarkCase.observed.retrieved_evidence_ids);
  const forbiddenIds = new Set(benchmarkCase.expected.forbidden_evidence_ids);
  const privacyLeak = benchmarkCase.observed.forbidden_disclosure
    || [...retrievedIds].some((id) => forbiddenIds.has(id));

  const relevantCount = [...retrievedIds].filter((id) => expectedIds.has(id)).length;
  let retrievalScore: number;
  if (expectedIds.size === 0) {
    retrievalScore = retrievedIds.size === 0 ? 1 : 0;
  } else {
    const recall = relevantCount / expectedIds.size;
    const precision = retrievedIds.size === 0 ? 0 : relevantCount / retrievedIds.size;
    retrievalScore = (recall + precision) / 2;
  }
  if (privacyLeak) retrievalScore = 0;

  const invention = benchmarkCase.expected.refuse_if_unverified && benchmarkCase.observed.asserted_answer;
  const unsupportedClaims = Math.max(
    benchmarkCase.observed.unsupported_factual_claims,
    invention ? 1 : 0,
  );
  const factualClaims = Math.max(benchmarkCase.observed.factual_claims, unsupportedClaims);

  let groundingScore: number;
  if (benchmarkCase.expected.refuse_if_unverified) {
    groundingScore = benchmarkCase.observed.refusal_confirmed && !benchmarkCase.observed.asserted_answer ? 1 : 0;
  } else {
    groundingScore = Math.max(
      0,
      benchmarkCase.observed.supported_required_claims - unsupportedClaims,
    ) / benchmarkCase.expected.required_claims.length;
  }

  let attributionScore = 1;
  if (benchmarkCase.expected.attribution.required) {
    const senderCorrect = benchmarkCase.observed.attribution_sender === benchmarkCase.expected.attribution.sender;
    const dateCorrect = benchmarkCase.observed.attribution_date === benchmarkCase.expected.attribution.date;
    attributionScore = (Number(senderCorrect) + Number(dateCorrect)) / 2;
  }

  const firstContentPassed = benchmarkCase.observed.first_content_ms !== null
    && benchmarkCase.observed.first_content_ms <= benchmarkCase.latency_budget_ms.first_content;
  const completePassed = benchmarkCase.observed.complete_ms <= benchmarkCase.latency_budget_ms.complete;
  const latencyScore = (Number(firstContentPassed) + Number(completePassed)) / 2;
  const answerScore = (0.35 * groundingScore + 0.15 * attributionScore + 0.15 * latencyScore) / 0.65;
  const overallScore = 0.35 * retrievalScore + 0.35 * groundingScore + 0.15 * attributionScore + 0.15 * latencyScore;
  const valid = !benchmarkCase.restart_before_query || benchmarkCase.observed.restart_performed === true;

  return {
    id: benchmarkCase.id,
    category: benchmarkCase.category,
    retrieval_score: round(retrievalScore),
    grounding_score: round(groundingScore),
    attribution_score: round(attributionScore),
    latency_score: round(latencyScore),
    answer_score: round(answerScore),
    overall_score: round(overallScore),
    unsupported_factual_claims: unsupportedClaims,
    factual_claims: factualClaims,
    privacy_leak: privacyLeak,
    response_gate_passed: benchmarkCase.observed.response_count === 1,
    placement_gate_passed: benchmarkCase.observed.reply_location_correct,
    valid,
  };
}

export function evaluateDataset(dataset: BenchmarkDataset, sourceCommit = 'unknown'): BenchmarkReport {
  validateDataset(dataset);
  const cases = dataset.cases.map(scoreCase).sort((left, right) => left.id.localeCompare(right.id));
  const unsupportedClaims = cases.reduce((sum, item) => sum + item.unsupported_factual_claims, 0);
  const factualClaims = cases.reduce((sum, item) => sum + item.factual_claims, 0);
  const relevantRetrievalRate = cases.filter((item) => item.retrieval_score === 1).length / cases.length;
  const groundedAnswerAccuracy = cases.filter((item) => item.grounding_score === 1).length / cases.length;
  const unsupportedClaimRate = factualClaims === 0 ? 0 : unsupportedClaims / factualClaims;
  const privacyLeaks = cases.filter((item) => item.privacy_leak).length;

  const relevancePassed = relevantRetrievalRate >= dataset.thresholds.relevant_retrieval_rate_min;
  const groundingPassed = groundedAnswerAccuracy >= dataset.thresholds.grounded_answer_accuracy_min;
  const unsupportedClaimsPassed = unsupportedClaimRate < dataset.thresholds.unsupported_claim_rate_max_exclusive;
  const privacyPassed = privacyLeaks <= dataset.thresholds.privacy_leaks_max;
  const responsePassed = cases.every((item) => item.response_gate_passed);
  const placementPassed = cases.every((item) => item.placement_gate_passed);
  const validityPassed = cases.every((item) => item.valid);

  const firstContentLatencies = dataset.cases.flatMap(({ observed }) => observed.first_content_ms === null ? [] : [observed.first_content_ms]);
  const completeLatencies = dataset.cases.map(({ observed }) => observed.complete_ms);

  return {
    report_version: 1,
    source_commit: sourceCommit,
    dataset: {
      id: dataset.dataset_id,
      version: dataset.dataset_version,
      synthetic: true,
      model_id: dataset.model_id,
      embedding_model: dataset.embedding_model,
    },
    thresholds: dataset.thresholds,
    metrics: {
      retrieval_score: round(mean(cases.map((item) => item.retrieval_score))),
      answer_score: round(mean(cases.map((item) => item.answer_score))),
      benchmark_score: round(mean(cases.map((item) => item.overall_score))),
      relevant_retrieval_rate: round(relevantRetrievalRate),
      grounded_answer_accuracy: round(groundedAnswerAccuracy),
      unsupported_claim_rate: round(unsupportedClaimRate),
      latency_ms: {
        first_content_p50: percentile(firstContentLatencies, 0.5),
        first_content_p90: percentile(firstContentLatencies, 0.9),
        complete_p50: percentile(completeLatencies, 0.5) ?? 0,
        complete_p90: percentile(completeLatencies, 0.9) ?? 0,
      },
    },
    gates: {
      relevance_passed: relevancePassed,
      grounding_passed: groundingPassed,
      unsupported_claims_passed: unsupportedClaimsPassed,
      privacy_passed: privacyPassed,
      response_passed: responsePassed,
      placement_passed: placementPassed,
      validity_passed: validityPassed,
    },
    passed: relevancePassed
      && groundingPassed
      && unsupportedClaimsPassed
      && privacyPassed
      && responsePassed
      && placementPassed
      && validityPassed,
    cases,
  };
}

function jsonFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) return jsonFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.benchmark.json') ? [entryPath] : [];
    })
    .sort();
}

export function loadDataset(path: string): BenchmarkDataset {
  const resolvedPath = resolve(path);
  invariant(existsSync(resolvedPath), `dataset path does not exist: ${path}`);
  const files = jsonFiles(resolvedPath);
  invariant(files.length > 0, `no *.benchmark.json files found under ${path}`);
  const datasets = files.map((file) => JSON.parse(readFileSync(file, 'utf8')) as BenchmarkDataset);
  datasets.forEach(validateDataset);

  if (datasets.length === 1) return datasets[0] as BenchmarkDataset;
  const [first] = datasets;
  invariant(first !== undefined, 'dataset is empty');
  for (const dataset of datasets.slice(1)) {
    invariant(dataset.dataset_version === first.dataset_version, 'dataset versions must match');
    invariant(dataset.model_id === first.model_id, 'model IDs must match');
    invariant(dataset.embedding_model === first.embedding_model, 'embedding models must match');
    invariant(JSON.stringify(dataset.thresholds) === JSON.stringify(first.thresholds), 'thresholds must match');
  }

  const combined: BenchmarkDataset = {
    ...first,
    dataset_id: basename(resolvedPath),
    cases: datasets.flatMap((dataset) => dataset.cases),
  };
  validateDataset(combined);
  return combined;
}

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function usage(): string {
  return 'Usage: npm run benchmark:retrieval -- --dataset <path> [--output <report.json>] [--commit <hash>]';
}

export function runCli(args: string[]): number {
  let datasetPath: string | undefined;
  let outputPath: string | undefined;
  let sourceCommit = currentCommit();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--dataset' && value) {
      datasetPath = value;
      index += 1;
    } else if (argument === '--output' && value) {
      outputPath = value;
      index += 1;
    } else if (argument === '--commit' && value) {
      sourceCommit = value;
      index += 1;
    } else {
      throw new Error(`${usage()}\nUnknown or incomplete argument: ${argument ?? ''}`);
    }
  }

  if (!datasetPath) throw new Error(usage());
  const dataset = loadDataset(datasetPath);
  const report = evaluateDataset(dataset, sourceCommit);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) writeFileSync(resolve(outputPath), serialized, { flag: 'wx' });
  process.stdout.write(serialized);
  return report.passed ? 0 : 1;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
