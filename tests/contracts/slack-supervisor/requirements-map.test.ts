/**
 * requirements-map.md — the acceptance criterion that every GS requirement maps
 * exactly once to implementation or validation ownership.
 *
 * This suite reads the PRD as the requirement authority rather than trusting a
 * hand-maintained list, so a requirement added to the PRD shows up here as a
 * failure instead of being quietly unmapped, and a requirement mapped twice
 * fails too.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTRACT_DOCS, loadContractDoc } from './helpers.js';

const PRD = readFileSync(
  fileURLToPath(new URL('../../../GIST_SLACK_SUPERVISOR_PRD.md', import.meta.url)),
  'utf8',
);
const map = loadContractDoc('requirements-map.md');

/** GS-FR-001…043 and GS-NFR-001…008 — the PRD's complete requirement range. */
const FUNCTIONAL = Array.from(
  { length: 43 },
  (_, index) => `GS-FR-${String(index + 1).padStart(3, '0')}`,
);
const NON_FUNCTIONAL = Array.from(
  { length: 8 },
  (_, index) => `GS-NFR-${String(index + 1).padStart(3, '0')}`,
);
const ALL_REQUIREMENTS = [...FUNCTIONAL, ...NON_FUNCTIONAL];

const KINDS = ['contract', 'integration', 'later'];

const MAP_LINES = map.split('\n');

function mappingRows(requirement: string): readonly string[] {
  return MAP_LINES.filter((line) => line.startsWith(`| ${requirement} |`));
}

function cellsOf(row: string): readonly string[] {
  return row.split('|').map((cell) => cell.trim());
}

describe('requirement authority (the PRD, not this table)', () => {
  it.each(FUNCTIONAL)('%s is defined in the PRD', (requirement) => {
    expect(PRD, `${requirement} is not in the PRD`).toContain(`**${requirement}:**`);
  });

  it.each(NON_FUNCTIONAL)('%s is defined in the PRD', (requirement) => {
    expect(PRD, `${requirement} is not in the PRD`).toContain(`**${requirement} —`);
  });

  it('maps the complete range the PRD defines', () => {
    const defined = [...PRD.matchAll(/\*\*(GS-FR-\d{3}):\*\*/g)].map((match) => match[1]);
    expect(new Set(defined).size).toBe(FUNCTIONAL.length);
    for (const requirement of FUNCTIONAL) {
      expect(defined, `${requirement} missing from the PRD`).toContain(requirement);
    }
  });

  it('finds no requirement in the PRD that the map does not cover', () => {
    const defined = new Set([
      ...[...PRD.matchAll(/\*\*(GS-FR-\d{3}):\*\*/g)].map((match) => match[1] as string),
      ...[...PRD.matchAll(/\*\*(GS-NFR-\d{3}) —/g)].map((match) => match[1] as string),
    ]);
    for (const requirement of defined) {
      expect(mappingRows(requirement).length, `${requirement} is unmapped`).toBe(1);
    }
  });
});

describe('every GS requirement is mapped exactly once', () => {
  it.each(ALL_REQUIREMENTS)('%s has exactly one mapping row', (requirement) => {
    const rows = mappingRows(requirement);
    expect(rows.length, `${requirement} has ${rows.length} rows, expected 1`).toBe(1);
  });

  it.each(ALL_REQUIREMENTS)('%s resolves to a known kind', (requirement) => {
    const row = mappingRows(requirement)[0];
    expect(row).toBeDefined();
    // | req | summary | kind | where | owner |
    const cells = cellsOf(row as string);
    expect(KINDS, `${requirement} has kind "${cells[3]}"`).toContain(cells[3]);
  });

  it.each(ALL_REQUIREMENTS)('%s names where it is frozen and who owns it', (requirement) => {
    const cells = cellsOf(mappingRows(requirement)[0] as string);
    expect(cells[2]?.length, `${requirement} has an empty summary`).toBeGreaterThan(0);
    expect(cells[4]?.length, `${requirement} has an empty "where"`).toBeGreaterThan(0);
    expect(cells[5]?.length, `${requirement} has no owning task`).toBeGreaterThan(0);
    expect(cells[5], `${requirement} owner is not a task ID`).toMatch(/T\d{3,4}/);
  });

  it.each(ALL_REQUIREMENTS)('%s cites a contract file that exists', (requirement) => {
    const where = cellsOf(mappingRows(requirement)[0] as string)[4] ?? '';
    const referenced = [...where.matchAll(/`([a-z-]+\.md)`/g)].map((match) => match[1] as string);
    expect(referenced.length, `${requirement} cites no contract file`).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(CONTRACT_DOCS, `${requirement} cites unknown file ${file}`).toContain(file);
    }
  });
});

describe('ownership is complete and honest about what is deferred', () => {
  it('names an owning task for every integration rule', () => {
    // An integration rule is behavior no single contract holds. If nobody owns
    // composing it, it falls between tasks — which is the failure this checks.
    const rows = MAP_LINES.filter(
      (line) => /^\| GS-(FR|NFR)-\d{3} \|/.test(line) && line.includes('| integration |'),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(cellsOf(row)[5]).toMatch(/T\d{3,4}/);
    }
  });

  it('defers exactly the two requirements a live probe must answer', () => {
    const deferred = MAP_LINES.filter(
      (line) => /^\| GS-FR-\d{3} \|/.test(line) && line.includes('| later |'),
    ).map((row) => cellsOf(row)[1]);
    expect(deferred.slice().sort()).toEqual(['GS-FR-009', 'GS-FR-010']);
  });

  it('hands the deferred requirements to T802', () => {
    for (const requirement of ['GS-FR-009', 'GS-FR-010']) {
      const cells = cellsOf(mappingRows(requirement)[0] as string);
      expect(cells[5], `${requirement} must be owned by T802`).toContain('T802');
      expect(cells[4], `${requirement} must point at the measurement contract`).toContain(
        'compatibility.md',
      );
    }
  });

  it('assigns every P09 and P10 runtime owner a contract to build against', () => {
    const owners = new Set(
      ALL_REQUIREMENTS.flatMap((requirement) => {
        const cells = cellsOf(mappingRows(requirement)[0] as string);
        return [...(cells[5] ?? '').matchAll(/T\d{3,4}/g)].map((match) => match[0]);
      }),
    );
    for (const task of ['T901', 'T902', 'T903', 'T904', 'T905', 'T1001', 'T1002', 'T1003']) {
      expect(owners, `${task} owns no requirement`).toContain(task);
    }
  });
});

describe('scope boundaries T801 does not cross', () => {
  it('says what it deliberately did not decide', () => {
    expect(map).toContain('Deliberately not decided by T801');
    expect(map).toContain('T803');
    expect(map).toContain('src/orchestration');
  });

  it('blocks reopen consumers without selecting either product behavior', () => {
    expect(map).toContain('Reopen consumer block');
    expect(map).toContain('unsupported until the product owner chooses');
    expect(loadContractDoc('workflow-state.md')).toContain('Unsupported pending product-owner decision');
    expect(loadContractDoc('workflow-state.md')).not.toContain('reopen creates a new workflow');
  });

  it('does not claim the threat model', () => {
    // T803 owns docs/security/slack-supervisor-threat-model.md.
    expect(map).toContain('threat model');
    expect(map).toContain('T803 owns');
  });
});
