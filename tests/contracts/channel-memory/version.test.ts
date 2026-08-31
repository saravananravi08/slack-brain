/**
 * The channel-memory contract set is frozen at 1.0.0. A version bump must
 * break this suite loudly rather than letting consumers drift onto new
 * semantics they were never re-verified against (README.md §2).
 */

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_MEMORY_CONTRACT_VERSION,
  CONTRACT_DOCS,
  FIXTURE_FILES,
  loadContractDoc,
  loadFixture,
} from './helpers.js';

describe('channel-memory contract version', () => {
  it('pins the frozen set version', () => {
    expect(CHANNEL_MEMORY_CONTRACT_VERSION).toBe('1.0.0');
  });

  it.each(FIXTURE_FILES)('%s declares the pinned contract_version', (file) => {
    expect(loadFixture(file).contract_version).toBe(CHANNEL_MEMORY_CONTRACT_VERSION);
  });

  it.each(FIXTURE_FILES)('%s is marked synthetic', (file) => {
    expect(loadFixture(file).synthetic).toBe(true);
  });

  it.each(CONTRACT_DOCS)('%s carries the pinned version in its header', (doc) => {
    expect(loadContractDoc(doc)).toContain(
      `- **Contract version:** ${CHANNEL_MEMORY_CONTRACT_VERSION}`,
    );
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
