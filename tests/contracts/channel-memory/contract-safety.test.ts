/**
 * CM-INV-12 — nothing in this contract set or its fixtures may be real.
 *
 * The point of this suite is the fixture nobody has written yet: it scans the
 * whole directory against the manifest allowlist, so a production channel ID
 * or a pasted real message pattern fails the suite instead of merging quietly
 * (FR-PRV-007, CM-NFR-004).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTRACT_DOCS, FIXTURE_FILES, loadContractDoc, loadFixture } from './helpers.js';

const manifest = loadFixture('manifest.json');
const syntheticIds = manifest.synthetic_ids as Record<string, string>;

const ALLOWED_IDS = new Set(Object.values(syntheticIds));
const ID_PREFIXES = [
  syntheticIds.event_id_prefix as string,
  syntheticIds.file_id_prefix as string,
];

/** Slack-shaped identifiers: team, channel, user, bot, app, file. */
const SLACK_ID_PATTERN = /\b[TCDGUBAF]0[A-Z0-9]{6,12}\b/g;

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

function fixtureText(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, FIXTURE_DIR)), 'utf8');
}

function isAllowed(id: string): boolean {
  if (ALLOWED_IDS.has(id)) return true;
  return ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

describe('synthetic identifiers only (CM-INV-12)', () => {
  it('declares the corpus synthetic', () => {
    expect(manifest.synthetic).toBe(true);
    expect(manifest.note).toContain('invented');
  });

  it.each(FIXTURE_FILES)('%s uses only allowlisted identifiers', (file) => {
    const found = [...fixtureText(file).matchAll(SLACK_ID_PATTERN)].map((match) => match[0]);
    const unexpected = [...new Set(found)].filter((id) => !isAllowed(id));
    expect(unexpected, `unrecognised Slack-shaped IDs in ${file}`).toEqual([]);
  });

  it.each(CONTRACT_DOCS)('%s uses only allowlisted identifiers', (doc) => {
    const found = [...loadContractDoc(doc).matchAll(SLACK_ID_PATTERN)].map((match) => match[0]);
    const unexpected = [...new Set(found)].filter((id) => !isAllowed(id));
    expect(unexpected, `unrecognised Slack-shaped IDs in ${doc}`).toEqual([]);
  });

  it('uses the two declared test channels', () => {
    expect(syntheticIds.channel_a).toBe('C0CHANTESTA');
    expect(syntheticIds.channel_b).toBe('C0CHANTESTB');
    expect(syntheticIds.channel_a).not.toBe(syntheticIds.channel_b);
  });

  it('scans every file present in the fixtures directory, not just the known list', () => {
    // A fixture added later without being listed would otherwise skip the scan
    // entirely — which is exactly when a real ID gets in.
    const onDisk = readdirSync(fileURLToPath(FIXTURE_DIR)).filter((file) => file.endsWith('.json'));
    expect(onDisk.slice().sort()).toEqual(FIXTURE_FILES.slice().sort());
  });
});

describe('no secrets or credentials', () => {
  const SECRET_PATTERNS: readonly [string, RegExp][] = [
    ['Slack bot token', /xoxb-[A-Za-z0-9-]+/],
    ['Slack app token', /xapp-[A-Za-z0-9-]+/],
    ['Slack user token', /xoxp-[A-Za-z0-9-]+/],
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

describe('no real hosts in link metadata', () => {
  it('uses reserved example/invalid hosts only', () => {
    const messages = loadFixture('messages.v1.json');
    const urls = [...JSON.stringify(messages).matchAll(/https?:\/\/([^"/\s]+)/g)].map(
      (match) => match[1] as string,
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const host of urls) {
      // RFC 2606 reserved names: safe to commit, resolvable by nobody.
      expect(host, `${host} is not a reserved test host`).toMatch(/(\.invalid|\.example|example\.com)$/);
    }
  });
});
