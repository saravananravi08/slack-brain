/**
 * The slack-supervisor contract set is frozen at 1.0.0.
 *
 * T803 is the one task pre-authorized to amend it, and only where T802's
 * measured evidence requires it. A bump must be deliberate, so this suite
 * fails on drift rather than adopting a new version silently.
 */

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_DOCS,
  FIXTURE_FILES,
  SLACK_SUPERVISOR_CONTRACT_VERSION,
  loadContractDoc,
  loadFixture,
} from './helpers.js';

describe('slack-supervisor contract version', () => {
  it('pins the frozen set version', () => {
    expect(SLACK_SUPERVISOR_CONTRACT_VERSION).toBe('1.0.0');
  });

  it.each(FIXTURE_FILES)('%s declares the pinned contract_version', (file) => {
    expect(loadFixture(file).contract_version).toBe(SLACK_SUPERVISOR_CONTRACT_VERSION);
  });

  it.each(FIXTURE_FILES)('%s is marked synthetic', (file) => {
    expect(loadFixture(file).synthetic).toBe(true);
  });

  it.each(FIXTURE_FILES)('%s names the set it belongs to', (file) => {
    expect(loadFixture(file).contract_set).toBe('slack-supervisor');
  });

  it.each(CONTRACT_DOCS)('%s carries the pinned version in its header', (doc) => {
    expect(loadContractDoc(doc)).toContain(
      `- **Contract version:** ${SLACK_SUPERVISOR_CONTRACT_VERSION}`,
    );
  });

  it.each(CONTRACT_DOCS)('%s names its contract set', (doc) => {
    expect(loadContractDoc(doc)).toContain('slack-supervisor');
  });

  it('lists every fixture file in the manifest', () => {
    const manifest = loadFixture('manifest.json');
    const listed = (manifest.files as { file: string }[]).map((entry) => entry.file).sort();
    const expected = FIXTURE_FILES.filter((file) => file !== 'manifest.json').slice().sort();
    expect(listed).toEqual(expected);
  });

  it('versions independently of the sets below it', () => {
    // README §2. The channel-memory and v1 sets are also at 1.0.0/1.0.1; that
    // is a coincidence of freezing, not a coupling.
    expect(loadContractDoc('README.md')).toContain('versions **independently**');
  });

  it('is additive and supersedes nothing', () => {
    // The channel-memory set superseded four v1 clauses. This one must not:
    // it sits after capture and adds a layer, and a supersession here would
    // mean supervision had weakened an existing capture or authorization rule.
    const readme = loadContractDoc('README.md');
    expect(readme).toContain('purely additive');
    expect(readme).toContain('supersedes nothing');
  });

  it('names the accepted decisions it implements', () => {
    const readme = loadContractDoc('README.md');
    for (const decision of ['D023', 'D024', 'D025', 'D026', 'D027', 'D028', 'D029']) {
      expect(readme, `README does not cite ${decision}`).toContain(decision);
    }
  });

  it('records which clauses T802 may move', () => {
    // compatibility.md §5 exists so T803 amends a known list rather than
    // rediscovering the dependencies during review.
    const compatibility = loadContractDoc('compatibility.md');
    expect(compatibility).toContain('Clauses conditional on measurement');
    const conditional = loadFixture('compatibility.v1.json').conditional_clauses as unknown[];
    expect(conditional.length).toBeGreaterThanOrEqual(7);
  });
});
