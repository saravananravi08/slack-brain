/**
 * requirements-map.md — the acceptance criterion that every CM-FR-001…019
 * requirement maps to a contract clause or a named integration rule.
 *
 * This suite reads the PRD as the requirement authority rather than trusting a
 * hand-maintained list, so a requirement added to the PRD in this range shows
 * up here as a failure instead of being quietly unmapped.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTRACT_DOCS, loadContractDoc } from './helpers.js';

const PRD = readFileSync(
  fileURLToPath(new URL('../../../GIST_CHANNEL_MEMORY_PRD.md', import.meta.url)),
  'utf8',
);
const map = loadContractDoc('requirements-map.md');

/** CM-FR-001…019 — P06's declared coverage range. */
const WAVE_ONE_REQUIREMENTS = Array.from({ length: 19 }, (_, index) =>
  `CM-FR-${String(index + 1).padStart(3, '0')}`,
);

/** Rows look like: `| CM-FR-007 | summary | contract | where | owner |`. */
function mappingRow(requirement: string): string | undefined {
  return map
    .split('\n')
    .find((line) => line.startsWith(`| ${requirement} |`));
}

describe('requirement authority', () => {
  it.each(WAVE_ONE_REQUIREMENTS)('%s is defined in the PRD', (requirement) => {
    expect(PRD, `${requirement} is not in the PRD`).toContain(`**${requirement}:**`);
  });

  it('maps the full range the PRD defines in P06 coverage', () => {
    const defined = [...PRD.matchAll(/\*\*(CM-FR-\d{3}):\*\*/g)].map((match) => match[1]);
    for (const requirement of WAVE_ONE_REQUIREMENTS) {
      expect(defined, `${requirement} missing from the PRD`).toContain(requirement);
    }
  });
});

describe('every CM-FR-001…019 requirement is mapped', () => {
  it.each(WAVE_ONE_REQUIREMENTS)('%s has a mapping row', (requirement) => {
    expect(mappingRow(requirement), `${requirement} has no row in requirements-map.md`).toBeDefined();
  });

  it.each(WAVE_ONE_REQUIREMENTS)('%s resolves to contract or integration', (requirement) => {
    const row = mappingRow(requirement);
    expect(row).toBeDefined();
    const cells = (row as string).split('|').map((cell) => cell.trim());
    // | req | summary | kind | where | owner |
    expect(['contract', 'integration']).toContain(cells[3]);
    expect(cells[4]?.length, `${requirement} has an empty "where"`).toBeGreaterThan(0);
    expect(cells[5]?.length, `${requirement} has no owning task`).toBeGreaterThan(0);
  });

  it.each(WAVE_ONE_REQUIREMENTS)('%s points at a contract file that exists', (requirement) => {
    const where = (mappingRow(requirement) as string).split('|').map((cell) => cell.trim())[4] ?? '';
    const referenced = [...where.matchAll(/`([a-z-]+\.md)`/g)].map((match) => match[1] as string);
    expect(referenced.length, `${requirement} cites no contract file`).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(CONTRACT_DOCS, `${requirement} cites unknown file ${file}`).toContain(file);
    }
  });

  it('names an owning task for every integration rule', () => {
    // An integration rule is behavior no single contract holds. If nobody owns
    // composing it, it falls between tasks — which is the failure this checks.
    const integrationRows = map
      .split('\n')
      .filter((line) => /^\| CM-FR-\d{3} \|/.test(line) && line.includes('| integration |'));
    expect(integrationRows.length).toBeGreaterThan(0);
    for (const row of integrationRows) {
      const cells = row.split('|').map((cell) => cell.trim());
      expect(cells[5]).toMatch(/T\d{3}/);
    }
  });
});

describe('P06 non-functional coverage', () => {
  it.each(['CM-NFR-001', 'CM-NFR-002', 'CM-NFR-004', 'CM-NFR-006'])('%s is mapped', (requirement) => {
    expect(map).toContain(requirement);
  });
});

describe('scope boundary with P07', () => {
  it('does not claim to freeze CM-FR-020…032', () => {
    for (const requirement of ['CM-FR-020', 'CM-FR-027', 'CM-FR-028', 'CM-FR-032']) {
      expect(mappingRow(requirement), `${requirement} must not be frozen in Wave 1`).toBeUndefined();
    }
    expect(map).toContain('Deliberately out of Wave 1');
  });

  it('hands CM-FR-026 to P07 with a P06-side signal', () => {
    // The one requirement that straddles the phases. Its P06 half must be
    // named, or P07 has no way to know which derived text is stale.
    expect(map).toContain('CM-FR-026');
    expect(loadContractDoc('mutations.md')).toContain('DerivedInvalidation');
  });
});
