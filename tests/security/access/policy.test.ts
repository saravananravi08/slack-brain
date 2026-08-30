/**
 * Policy comes from configuration, and D002 stays off.
 *
 * D001's consequence for the guard is that policy is passed in, never read
 * from ambient globals — so this file also checks the module's import and
 * environment hygiene, which is the part a reviewer cannot see from a
 * signature.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { authorize, policySnapshotFromConfig } from '../../../src/security/index.js';
import { ConfigError, parseConfig } from '../../../src/config.js';
import type { Config } from '../../../src/config.js';
import { SYNTHETIC, makeDirectMessageEvent, makeRequest } from './helpers.js';

const SYNTHETIC_ENVIRONMENT = {
  SLACK_BOT_TOKEN: 'xoxb-synthetic-not-a-real-token',
  SLACK_APP_TOKEN: 'xapp-synthetic-not-a-real-token',
  GIST_APPROVED_WORKSPACE_ID: SYNTHETIC.workspaceApproved,
  GIST_APPROVED_CHANNEL_IDS: `${SYNTHETIC.channelApproved},${SYNTHETIC.channelApprovedSecond}`,
  GIST_USER_ALLOWLIST: '',
  GIST_MODEL: 'claude-opus-5',
  ANTHROPIC_API_KEY: 'synthetic-anthropic-key',
  EMBEDDING_MODEL: 'openai/text-embedding-3-small',
  OPENAI_API_KEY: 'synthetic-openai-key',
  MASTRA_DATABASE_URL: 'file:/tmp/gist-synthetic.db',
} as const;

describe('policySnapshotFromConfig', () => {
  it('projects the validated configuration verbatim', () => {
    const config = parseConfig({ ...SYNTHETIC_ENVIRONMENT });
    const policy = policySnapshotFromConfig(config);

    expect(policy).toEqual({
      approved_workspace_id: SYNTHETIC.workspaceApproved,
      approved_channel_ids: [SYNTHETIC.channelApproved, SYNTHETIC.channelApprovedSecond],
      user_allowlist: [],
      dm_shared_knowledge: false,
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('carries the user allowlist when one is configured', () => {
    const config = parseConfig({
      ...SYNTHETIC_ENVIRONMENT,
      GIST_USER_ALLOWLIST: SYNTHETIC.userMember,
    });
    expect(policySnapshotFromConfig(config).user_allowlist).toEqual([SYNTHETIC.userMember]);
  });

  it('never carries membership — that is D002-enabled data only', () => {
    const config = parseConfig({ ...SYNTHETIC_ENVIRONMENT });
    expect(policySnapshotFromConfig(config).membership).toBeUndefined();
  });
});

describe('D002 cannot be turned on by configuration', () => {
  it('rejects GIST_DM_SHARED_KNOWLEDGE=true at startup (T102)', () => {
    expect(() =>
      parseConfig({ ...SYNTHETIC_ENVIRONMENT, GIST_DM_SHARED_KNOWLEDGE: 'true' }),
    ).toThrow(ConfigError);
  });

  it('yields a DM scope of the private boundary only for real configuration', () => {
    const policy = policySnapshotFromConfig(parseConfig({ ...SYNTHETIC_ENVIRONMENT }));
    const event = makeDirectMessageEvent();
    const decision = authorize(makeRequest('read_memory', { event, policy }));

    expect(decision.allowed).toBe(true);
    expect(decision.scope).toEqual([`dm:${SYNTHETIC.workspaceApproved}:${SYNTHETIC.userMember}`]);
    expect(decision.scope.some((id) => id.startsWith('ch:'))).toBe(false);
  });

  it('is a pure function of its argument', () => {
    // A hand-built Config, so nothing is read from the environment.
    const config: Config = {
      slackBotToken: 'xoxb-unused',
      slackAppToken: 'xapp-unused',
      approvedWorkspaceId: SYNTHETIC.workspaceApproved,
      approvedChannelIds: [SYNTHETIC.channelApproved],
      userAllowlist: [],
      dmSharedKnowledge: false,
      gistModel: 'claude-opus-5',
      anthropicApiKey: 'unused',
      embeddingModel: 'openai/text-embedding-3-small',
      embeddingDimensions: 1536,
      openaiApiKey: 'unused',
      databaseUrl: 'file:/tmp/unused.db',
      dmRetentionDays: 90,
      traceRetentionDays: 30,
      appLogRetentionDays: 14,
      backupRetentionDays: 35,
      unapprovedChannelPurgeDays: 30,
    };

    expect(policySnapshotFromConfig(config).approved_channel_ids).toEqual([
      SYNTHETIC.channelApproved,
    ]);
  });
});

describe('module hygiene', () => {
  const directory = fileURLToPath(new URL('../../../src/security/', import.meta.url));
  const sources = readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(`${directory}${name}`, 'utf8') }));

  it('has sources to inspect', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('reads no environment variable (D001 — policy is passed in)', () => {
    for (const source of sources) {
      expect(source.text).not.toContain('process.env');
    }
  });

  it('performs no I/O and consults no clock', () => {
    for (const source of sources) {
      for (const forbidden of ['node:fs', 'node:http', 'fetch(', 'Date.now', 'new Date']) {
        expect(`${source.name}: ${source.text}`).not.toContain(forbidden);
      }
    }
  });

  it('imports nothing at runtime from the Slack channel layer', () => {
    // The channel layer depends on this module, not the other way round; a
    // cycle here would make the guard reachable only through transport code.
    for (const source of sources) {
      expect(source.text).not.toContain("from '../mastra/");
    }
  });

  it('composes no boundary identifier (identity.md §4)', () => {
    // Composition belongs to T202's resource-policy.ts. This module parses and
    // filters identifiers it was handed; it never builds one. `types.ts` is
    // excluded because the same template shape is the *type* declaration of
    // `BoundaryId`, which is a description rather than a construction.
    for (const source of sources) {
      if (source.name === 'types.ts') continue;
      expect(`${source.name}: ${source.text}`).not.toMatch(/`ch:\$\{/);
      expect(`${source.name}: ${source.text}`).not.toMatch(/`dm:\$\{/);
    }
  });
});
