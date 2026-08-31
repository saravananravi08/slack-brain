/**
 * The channel-memory contract set is frozen at 1.0.0. D018 authorizes the
 * mutations.md clarification patch at 1.0.1; every other contract remains on
 * the frozen base version.
 */

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_MEMORY_CONTRACT_VERSION,
  CONTRACT_DOCS,
  FIXTURE_FILES,
  loadContractDoc,
  loadFixture,
} from './helpers.js';

const MUTATION_PATCH_VERSION = '1.0.1';

describe('channel-memory contract version', () => {
  it('pins the frozen set version', () => {
    expect(CHANNEL_MEMORY_CONTRACT_VERSION).toBe('1.0.0');
  });

  it.each(FIXTURE_FILES)('%s declares the pinned contract_version', (file) => {
    const expected = file === 'mutations.v1.json'
      ? MUTATION_PATCH_VERSION
      : CHANNEL_MEMORY_CONTRACT_VERSION;
    expect(loadFixture(file).contract_version).toBe(expected);
  });

  it.each(FIXTURE_FILES)('%s is marked synthetic', (file) => {
    expect(loadFixture(file).synthetic).toBe(true);
  });

  it.each(CONTRACT_DOCS)('%s carries the pinned version in its header', (doc) => {
    const expected = doc === 'mutations.md'
      ? MUTATION_PATCH_VERSION
      : CHANNEL_MEMORY_CONTRACT_VERSION;
    expect(loadContractDoc(doc)).toContain(`- **Contract version:** ${expected}`);
  });

  it('pins the D018 mutation clarification patch', () => {
    expect(loadContractDoc('mutations.md')).toContain('D018');
    expect(loadFixture('mutations.v1.json').contract_version).toBe(MUTATION_PATCH_VERSION);
  });

  it('lists every fixture file in the manifest', () => {
    const manifest = loadFixture('manifest.json');
    const listed = (manifest.files as { file: string }[]).map((entry) => entry.file).sort();
    const expected = FIXTURE_FILES.filter((file) => file !== 'manifest.json').slice().sort();
    expect(listed).toEqual(expected);
  });

  it('versions independently of the v1 contract set', () => {
    // Both sets read 1.0.0 today. README §2 says that is a coincidence of
    // freezing, not a coupling — this asserts the statement is present so a
    // later bump of one set is not read as a bump of the other.
    expect(loadContractDoc('README.md')).toContain('versions **independently**');
  });
});
