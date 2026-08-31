/**
 * Fixture loading for the channel-memory contract suite.
 *
 * These tests pin the frozen contract set in
 * `docs/architecture/channel-memory/` (version 1.0.0, T601). They read the
 * fixtures and the contract documents; they perform no other I/O, hold no
 * credentials, and contain no real Slack identifiers or message content.
 *
 * T602–T605 implement the runtime. When they land they should extend this
 * suite to drive their implementations against the same fixtures rather than
 * writing a parallel corpus — cross-task agreement is the point of freezing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CHANNEL_MEMORY_CONTRACT_VERSION = '1.0.0';

const FIXTURE_BASE = new URL('./fixtures/', import.meta.url);
const CONTRACT_BASE = new URL('../../../docs/architecture/channel-memory/', import.meta.url);

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
  'enrollment.md',
  'capture-policy.md',
  'message-record.md',
  'mutations.md',
  'invariants.md',
  'requirements-map.md',
] as const;

export const FIXTURE_FILES = [
  'manifest.json',
  'enrollment.v1.json',
  'senders.v1.json',
  'capture-policy.v1.json',
  'messages.v1.json',
  'mutations.v1.json',
  'isolation.v1.json',
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
