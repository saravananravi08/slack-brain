/**
 * GS-INV-14 — nothing in this contract set or its fixtures may be real.
 *
 * The point of this suite is the fixture nobody has written yet: it scans the
 * whole directory against the manifest allowlist, so a production channel ID,
 * a pasted bot reply, or a credential fails the suite instead of merging
 * quietly (FR-PRV-007, GS-NFR-004).
 *
 * T802 will add measured values in its own branch. This scan is what stops a
 * live probe's evidence from arriving with real identifiers attached.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTRACT_DOCS, FIXTURE_FILES, loadContractDoc, loadFixture } from './helpers.js';

const manifest = loadFixture('manifest.json');
const syntheticIds = manifest.synthetic_ids as Record<string, string>;

const ALLOWED_IDS = new Set(Object.values(syntheticIds));
const ID_PREFIXES = [syntheticIds.event_id_prefix as string];

/**
 * Slack-shaped identifiers: team, channel, DM, group, user, bot, app, file,
 * and the `W` enterprise user prefix.
 *
 * Deliberately broader than the channel-memory set's pattern, which required a
 * literal `0` as the second character. A real workspace whose IDs do not
 * happen to match that shape would have slipped through, and this set will
 * receive T802's live-probe evidence.
 */
const SLACK_ID_PATTERN = /\b(?:[TCDGU]|[BAFW])[A-Z0-9]{8,}\b/g;

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);
const TEST_DIR = new URL('./', import.meta.url);

function fixtureText(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, FIXTURE_DIR)), 'utf8');
}

function isAllowed(id: string): boolean {
  if (ALLOWED_IDS.has(id)) return true;
  return ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function unexpectedIds(text: string): readonly string[] {
  const found = [...text.matchAll(SLACK_ID_PATTERN)].map((match) => match[0]);
  return [...new Set(found)].filter((id) => !isAllowed(id));
}

describe('synthetic identifiers only (GS-INV-14)', () => {
  it('declares the corpus synthetic', () => {
    expect(manifest.synthetic).toBe(true);
    expect(String(manifest.note)).toContain('invented');
  });

  it.each(FIXTURE_FILES)('%s uses only allowlisted identifiers', (file) => {
    expect(unexpectedIds(fixtureText(file)), `unrecognised Slack-shaped IDs in ${file}`).toEqual([]);
  });

  it.each(CONTRACT_DOCS)('%s uses only allowlisted identifiers', (doc) => {
    expect(unexpectedIds(loadContractDoc(doc)), `unrecognised Slack-shaped IDs in ${doc}`).toEqual(
      [],
    );
  });

  it('uses the two declared test channels in one declared workspace', () => {
    expect(syntheticIds.workspace).toBe('T0SUPVTEST');
    expect(syntheticIds.channel_a).toBe('C0SUPVTESTA');
    expect(syntheticIds.channel_b).toBe('C0SUPVTESTB');
    expect(syntheticIds.channel_a).not.toBe(syntheticIds.channel_b);
  });

  it('gives Gist, Kilo, Linear, and an unknown bot distinct identities', () => {
    const identities = [
      syntheticIds.gist_bot_id,
      syntheticIds.kilo_bot_id,
      syntheticIds.linear_bot_id,
      syntheticIds.unknown_bot_id,
    ];
    expect(new Set(identities).size).toBe(identities.length);
  });

  it('scans every file present in the fixtures directory, not just the known list', () => {
    // A fixture added later without being listed would otherwise skip the scan
    // entirely — which is exactly when a real ID gets in.
    const onDisk = readdirSync(fileURLToPath(FIXTURE_DIR)).filter((file) => file.endsWith('.json'));
    expect(onDisk.slice().sort()).toEqual(FIXTURE_FILES.slice().sort());
  });

  it('scans every test and helper file in this directory too', () => {
    // The suites and the reference rules are as good a place to paste a real
    // ID as a fixture is, so they are scanned as well — with one narrowing:
    // a token here must contain a digit to count.
    //
    // TypeScript legitimately contains SCREAMING_CASE identifiers, and
    // `WORKFLOW_STATES` or `FUNCTIONAL` are the same shape as a Slack ID made
    // only of letters. Requiring a digit keeps the scan from producing noise
    // every time someone names a constant, and costs almost nothing: Slack
    // identifiers are ten or eleven base-36 characters, so one made entirely
    // of letters is a curiosity rather than a realistic paste. The fixtures
    // and contract documents — where identifiers actually belong — are still
    // scanned with no such narrowing above.
    const onDisk = readdirSync(fileURLToPath(TEST_DIR)).filter((file) => file.endsWith('.ts'));
    expect(onDisk.length).toBeGreaterThan(0);
    for (const file of onDisk) {
      const text = readFileSync(fileURLToPath(new URL(file, TEST_DIR)), 'utf8');
      const found = unexpectedIds(text).filter((id) => /\d/.test(id));
      expect(found, `unrecognised Slack-shaped IDs in ${file}`).toEqual([]);
    }
  });
});

describe('no secrets or credentials', () => {
  const SECRET_PATTERNS: readonly [string, RegExp][] = [
    ['Slack bot token', /xoxb-[A-Za-z0-9-]+/],
    ['Slack app token', /xapp-[A-Za-z0-9-]+/],
    ['Slack user token', /xoxp-[A-Za-z0-9-]+/],
    ['Slack webhook URL', /hooks\.slack\.com\/services\//],
    ['OpenAI key', /sk-[A-Za-z0-9]{16,}/],
    ['Anthropic key', /sk-ant-[A-Za-z0-9-]+/],
    ['bearer token', /Bearer\s+[A-Za-z0-9._-]{16,}/],
    ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['env assignment', /(API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*\S+/],
  ];

  it.each([...FIXTURE_FILES, ...CONTRACT_DOCS])('%s contains no credential pattern', (file) => {
    const text = file.endsWith('.json') ? fixtureText(file) : loadContractDoc(file);
    for (const [label, pattern] of SECRET_PATTERNS) {
      expect(pattern.test(text), `${file} appears to contain a ${label}`).toBe(false);
    }
  });
});

describe('no captured conversation, prompt, or model output', () => {
  it('carries no Slack permalink or workspace host', () => {
    for (const file of [...FIXTURE_FILES]) {
      expect(fixtureText(file), file).not.toMatch(/https?:\/\/[a-z0-9-]+\.slack\.com/i);
    }
  });

  it('keeps the compatibility record free of any content field', () => {
    const compatibility = loadFixture('compatibility.v1.json');
    const forbidden = compatibility.forbidden_fields as string[];
    const template = compatibility.unmeasured_template as Record<string, unknown>;
    for (const field of forbidden) {
      expect(template, `template carries ${field}`).not.toHaveProperty(field);
    }
  });

  it('keeps workflow, event, checkpoint, and continuation records free of message text', () => {
    for (const [file, sampleKey, forbiddenKey] of [
      ['workflow.v1.json', 'sample_record', 'record_forbidden_fields'],
      ['events.v1.json', 'sample_event', 'event_record_forbidden_fields'],
      ['dispatch.v1.json', 'sample_checkpoint', 'checkpoint_forbidden_fields'],
      ['continuation.v1.json', 'sample_record', 'record_forbidden_fields'],
    ] as const) {
      const fixture = loadFixture(file);
      const sample = fixture[sampleKey] as Record<string, unknown>;
      for (const field of fixture[forbiddenKey] as string[]) {
        expect(sample, `${file} sample carries ${field}`).not.toHaveProperty(field);
      }
    }
  });
});

describe('no retired vocabulary survives a rename', () => {
  /**
   * Names this set has renamed. A stale one is not cosmetic: T802 reads these
   * documents as its specification, and a field that exists in prose but not in
   * the schema is a measurement nobody can record.
   */
  const RETIRED_NAMES: readonly [string, string][] = [
    ['distinguishes_outcomes', 'outcome_distinguishability'],
    ['confirmDelivery', 'deliveryOutcome'],
    ['continuationClaimKey', 'continuationLeaseKey'],
    ['continuationReplayIsNoOp', 'continuationDuplicateEffectPrevented'],
  ];

  it.each(CONTRACT_DOCS)('%s uses no retired name', (doc) => {
    const text = loadContractDoc(doc);
    for (const [retired, replacement] of RETIRED_NAMES) {
      expect(text.includes(retired), `${doc} still says ${retired}; use ${replacement}`).toBe(false);
    }
  });

  it.each(FIXTURE_FILES)('%s uses no retired name', (file) => {
    const text = fixtureText(file);
    for (const [retired, replacement] of RETIRED_NAMES) {
      expect(text.includes(retired), `${file} still says ${retired}; use ${replacement}`).toBe(
        false,
      );
    }
  });

  /**
   * Wording this set has superseded. A stale sentence is worse than a stale
   * name: it reads as current policy, and a P09 implementer following it would
   * build the behavior the review rejected.
   */
  const RETIRED_PHRASES: readonly [string, string][] = [
    ['consumption claim', 'durable continuation processing state and lease (actions.md §2.4)'],
    ['cont-claim:', 'cont-lease: (actions.md §2.4)'],
    ['proves non-delivery', 'reconciliation evidences delivery only (dispatch.md §5.1)'],
    ['proven non-delivery', 'reconciliation evidences delivery only (dispatch.md §5.1)'],
    ['processed exactly once', 'at-least-once processing with idempotent effects (actions.md §2.4)'],
    ['claim held and stops', 'a lapsed processing lease resumes (actions.md §2.4)'],
    ['pending, no claim consumed', 'pending is a resumable unsent outbox command (dispatch.md §2)'],
    ['retry that races', 'attempts are strictly serial (dispatch.md §3.3)'],
    ['slow original', 'attempts are strictly serial (dispatch.md §3.3)'],
    ['late success', 'attempts are strictly serial (dispatch.md §3.3)'],
    ['before every dispatch', 'limits are checked before durable command creation'],
    ['reconcile any action left in a non-terminal delivery state', 'dispatch pending; reconcile only in-flight'],
  ];

  it.each(CONTRACT_DOCS)('%s uses no superseded wording', (doc) => {
    const text = loadContractDoc(doc).toLowerCase();
    for (const [retired, replacement] of RETIRED_PHRASES) {
      expect(
        text.includes(retired.toLowerCase()),
        `${doc} still says "${retired}"; the contract now says ${replacement}`,
      ).toBe(false);
    }
  });

  it.each(FIXTURE_FILES)('%s uses no superseded wording', (file) => {
    const text = fixtureText(file).toLowerCase();
    for (const [retired, replacement] of RETIRED_PHRASES) {
      expect(
        text.includes(retired.toLowerCase()),
        `${file} still says "${retired}"; the contract now says ${replacement}`,
      ).toBe(false);
    }
  });

  it('scans the reference rules and suites too', () => {
    const onDisk = readdirSync(fileURLToPath(TEST_DIR)).filter(
      (file) => file.endsWith('.ts') && file !== 'contract-safety.test.ts',
    );
    for (const file of onDisk) {
      const text = readFileSync(fileURLToPath(new URL(file, TEST_DIR)), 'utf8');
      for (const [retired] of RETIRED_NAMES) {
        expect(text.includes(retired), `${file} still says ${retired}`).toBe(false);
      }
      for (const [retired] of RETIRED_PHRASES) {
        expect(text.toLowerCase().includes(retired.toLowerCase()), `${file} still says "${retired}"`)
          .toBe(false);
      }
    }
  });
});

describe('every reason, failure, and outcome class is safe to log (GS-NFR-004)', () => {
  const CLASS_SOURCES: readonly [string, string][] = [
    ['events.v1.json', 'reason_classes'],
    ['dispatch.v1.json', 'failure_classes'],
    ['workflow.v1.json', 'outcome_classes'],
    ['workflow.v1.json', 'states'],
    ['approvals.v1.json', 'gated_action_classes'],
    ['approvals.v1.json', 'approval_states'],
    ['actions.v1.json', 'action_classes'],
    ['continuation.v1.json', 'gist_expected_states'],
  ];

  it.each(CLASS_SOURCES)('%s / %s uses lowercase content-free identifiers', (file, key) => {
    const values = loadFixture(file)[key] as string[];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value, `${key} value "${value}" is not a safe class string`).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});
