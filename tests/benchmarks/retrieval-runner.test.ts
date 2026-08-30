import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateDataset,
  loadDataset,
  runCli,
  scoreCase,
  type BenchmarkCase,
  type BenchmarkDataset,
} from '../../benchmarks/retrieval/runner.js';

const datasetPath = fileURLToPath(
  new URL('../../benchmarks/retrieval/synthetic', import.meta.url),
);

function referenceDataset(): BenchmarkDataset {
  return structuredClone(loadDataset(datasetPath));
}

function caseById(dataset: BenchmarkDataset, id: string): BenchmarkCase {
  const benchmarkCase = dataset.cases.find((candidate) => candidate.id === id);
  if (!benchmarkCase) throw new Error(`Missing test case ${id}`);
  return benchmarkCase;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retrieval benchmark runner', () => {
  it('loads all baseline categories and passes the synthetic reference run', () => {
    const dataset = referenceDataset();
    const report = evaluateDataset(dataset, 'commit-a');

    expect(dataset.cases).toHaveLength(8);
    expect(new Set(dataset.cases.map(({ category }) => category))).toEqual(
      new Set([
        'semantic_paraphrase',
        'exact_value',
        'speaker_attribution',
        'thread_context',
        'unknown_history',
        'channel_isolation',
        'dm_isolation',
        'restart_recall',
      ]),
    );
    expect(report.passed).toBe(true);
    expect(report.metrics).toMatchObject({
      retrieval_score: 1,
      answer_score: 1,
      benchmark_score: 1,
      relevant_retrieval_rate: 1,
      grounded_answer_accuracy: 1,
      unsupported_claim_rate: 0,
    });
    expect(report.metrics.latency_ms).toEqual({
      first_content_p50: 700,
      first_content_p90: 1100,
      complete_p50: 1200,
      complete_p90: 1800,
    });
  });

  it('scores retrieval separately from answer quality', () => {
    const dataset = referenceDataset();
    const benchmarkCase = caseById(dataset, 'case-semantic-decision');
    benchmarkCase.observed.retrieved_evidence_ids = ['msg-lantern-decision'];
    benchmarkCase.observed.attribution_date = '2026-01-13';

    const score = scoreCase(benchmarkCase);

    expect(score.retrieval_score).toBe(0.75);
    expect(score.answer_score).toBeLessThan(1);
    expect(score.grounding_score).toBe(1);
  });

  it('penalizes invention in no-answer cases without trusting reviewer counts', () => {
    const dataset = referenceDataset();
    const benchmarkCase = caseById(dataset, 'case-unknown-history');
    benchmarkCase.observed.refusal_confirmed = false;
    benchmarkCase.observed.asserted_answer = true;
    benchmarkCase.observed.unsupported_factual_claims = 0;
    benchmarkCase.observed.factual_claims = 0;

    const score = scoreCase(benchmarkCase);
    const report = evaluateDataset(dataset, 'commit-b');

    expect(score.grounding_score).toBe(0);
    expect(score.unsupported_factual_claims).toBe(1);
    expect(score.factual_claims).toBe(1);
    expect(report.gates.unsupported_claims_passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('treats forbidden retrieval or disclosure as a privacy hard-gate failure', () => {
    const retrievalDataset = referenceDataset();
    const retrievalCase = caseById(retrievalDataset, 'case-channel-isolation');
    retrievalCase.observed.retrieved_evidence_ids = ['msg-protected-alpha'];

    const retrievalReport = evaluateDataset(retrievalDataset, 'commit-c');
    const retrievalScore = retrievalReport.cases.find(({ id }) => id === retrievalCase.id);
    expect(retrievalScore).toMatchObject({ privacy_leak: true, retrieval_score: 0 });
    expect(retrievalReport.gates.privacy_passed).toBe(false);

    const disclosureDataset = referenceDataset();
    caseById(disclosureDataset, 'case-dm-isolation').observed.forbidden_disclosure = true;
    const disclosureReport = evaluateDataset(disclosureDataset, 'commit-c');
    expect(disclosureReport.gates.privacy_passed).toBe(false);
    expect(disclosureReport.passed).toBe(false);
  });

  it('fails invalid restart, response-count, and placement hard gates', () => {
    const dataset = referenceDataset();
    caseById(dataset, 'case-restart-recall').observed.restart_performed = false;
    caseById(dataset, 'case-exact-url').observed.response_count = 2;
    caseById(dataset, 'case-thread-context').observed.reply_location_correct = false;

    const report = evaluateDataset(dataset, 'commit-d');

    expect(report.gates).toMatchObject({
      validity_passed: false,
      response_passed: false,
      placement_passed: false,
    });
    expect(report.passed).toBe(false);
  });

  it('emits stable content-free reports for commit comparison', () => {
    const dataset = referenceDataset();
    const first = evaluateDataset(dataset, 'fixed-commit');
    const second = evaluateDataset(dataset, 'fixed-commit');
    const serialized = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(first.source_commit).toBe('fixed-commit');
    expect(serialized).not.toContain('Where should Lantern output live');
    expect(serialized).not.toContain('Generated reports belong');
    expect(serialized).not.toContain('answer_text');
  });

  it('returns nonzero from the CLI when a threshold fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 't205-benchmark-'));
    const dataset = referenceDataset();
    caseById(dataset, 'case-semantic-decision').observed.retrieved_evidence_ids = [];
    caseById(dataset, 'case-exact-url').observed.retrieved_evidence_ids = [];
    const file = join(directory, 'failure.benchmark.json');
    writeFileSync(file, JSON.stringify(dataset));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(runCli(['--dataset', file, '--commit', 'fixed-commit'])).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects datasets not explicitly marked synthetic', () => {
    const dataset = {
      ...referenceDataset(),
      synthetic: false,
    } as unknown as BenchmarkDataset;

    expect(() => evaluateDataset(dataset)).toThrow('synthetic must be true');
  });
});
