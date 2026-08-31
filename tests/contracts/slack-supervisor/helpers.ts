/**
 * Fixture loading for the slack-supervisor contract suite.
 *
 * These tests pin the frozen contract set in
 * `docs/architecture/slack-supervisor/` (version 1.0.0, T801). They read the
 * fixtures and the contract documents; they perform no other I/O, hold no
 * credentials, make no network call, and contain no real Slack identifiers,
 * message content, prompts, or model output.
 *
 * T802 measures the `compatibility.md` fields against real bots in its own
 * branch. T901–T904 implement the runtime. When they land they should extend
 * this suite to drive their work against the same fixtures rather than writing
 * a parallel corpus — cross-task agreement is the point of freezing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SLACK_SUPERVISOR_CONTRACT_VERSION = '1.0.0';

const FIXTURE_BASE = new URL('./fixtures/', import.meta.url);
const CONTRACT_BASE = new URL('../../../docs/architecture/slack-supervisor/', import.meta.url);

export type Json = Record<string, unknown>;

export function loadFixture(name: string): Json {
  const path = fileURLToPath(new URL(name, FIXTURE_BASE));
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

export function loadContractDoc(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, CONTRACT_BASE)), 'utf8');
}

export const CONTRACT_DOCS = [
  'README.md',
  'identity.md',
  'events.md',
  'workflow-state.md',
  'actions.md',
  'approvals.md',
  'dispatch.md',
  'compatibility.md',
  'invariants.md',
  'requirements-map.md',
] as const;

export const FIXTURE_FILES = [
  'manifest.json',
  'identity.v1.json',
  'events.v1.json',
  'workflow.v1.json',
  'actions.v1.json',
  'approvals.v1.json',
  'dispatch.v1.json',
  'limits.v1.json',
  'compatibility.v1.json',
] as const;

/** Array member lookup by `name`, throwing rather than returning undefined. */
export function byName(cases: readonly unknown[], name: string): Json {
  const found = cases.find(
    (candidate): candidate is Json =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as Json).name === name,
  );
  if (found === undefined) {
    throw new Error(`Missing fixture case: ${name}`);
  }
  return found;
}

export function asArray(value: unknown, label: string): readonly Json[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected an array at ${label}`);
  }
  return value as readonly Json[];
}

export function asRecord(value: unknown, label: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected an object at ${label}`);
  }
  return value as Json;
}

export function asStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Expected an array of strings at ${label}`);
  }
  return value as readonly string[];
}

/** Case names, for `it.each` titles. */
export function names(cases: readonly Json[]): readonly string[] {
  return cases.map((testCase) => String(testCase.name));
}
