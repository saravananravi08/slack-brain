import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { ConfigError, parseConfig, type Config } from '../../src/config.js';

const envExample = readFileSync(
  fileURLToPath(new URL('../../.env.example', import.meta.url)),
  'utf8',
);

const botPrefix = ['xox', 'b'].join('');
const appPrefix = ['xap', 'p'].join('');

function validEnvironment(): Record<string, string> {
  return {
    SLACK_BOT_TOKEN: `${botPrefix}-synthetic-credential`,
    SLACK_APP_TOKEN: `${appPrefix}-synthetic-credential`,
    GIST_APPROVED_WORKSPACE_ID: 'T0SYNTH01',
    GIST_APPROVED_CHANNEL_IDS: 'C0APPROVED1,G0APPROVED2',
    GIST_USER_ALLOWLIST: 'U0MEMBER01,W0MEMBER02',
    GIST_DM_SHARED_KNOWLEDGE: 'false',
    GIST_MODEL: 'claude-opus-5',
    ANTHROPIC_API_KEY: 'synthetic-anthropic-credential',
    EMBEDDING_MODEL: 'openai/text-embedding-3-small',
    OPENAI_API_KEY: 'synthetic-openai-credential',
    MASTRA_DATABASE_URL: 'file:/var/lib/gist-synthetic/mastra.db',
  };
}

function configError(environment: Readonly<Record<string, string | undefined>>): ConfigError {
  try {
    parseConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('Expected configuration parsing to fail');
}

describe('parseConfig', () => {
  it('returns a typed immutable config for valid input', () => {
    const environment = Object.freeze(validEnvironment());
    const config = parseConfig(environment);

    expectTypeOf(config).toEqualTypeOf<Readonly<Config>>();
    expect(config).toMatchObject({
      approvedWorkspaceId: 'T0SYNTH01',
      approvedChannelIds: ['C0APPROVED1', 'G0APPROVED2'],
      userAllowlist: ['U0MEMBER01', 'W0MEMBER02'],
      dmSharedKnowledge: false,
      gistModel: 'claude-opus-5',
      embeddingModel: 'openai/text-embedding-3-small',
      embeddingDimensions: 1536,
      databaseUrl: 'file:/var/lib/gist-synthetic/mastra.db',
      dmRetentionDays: 90,
      traceRetentionDays: 30,
      appLogRetentionDays: 14,
      backupRetentionDays: 35,
      unapprovedChannelPurgeDays: 30,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.approvedChannelIds)).toBe(true);
    expect(Object.isFrozen(config.userAllowlist)).toBe(true);
    expect(() => (config.approvedChannelIds as string[]).push('C0OTHER001')).toThrow();
    expect(environment.GIST_APPROVED_CHANNEL_IDS).toBe('C0APPROVED1,G0APPROVED2');
  });

  it.each([
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'GIST_APPROVED_WORKSPACE_ID',
    'GIST_APPROVED_CHANNEL_IDS',
    'GIST_MODEL',
    'ANTHROPIC_API_KEY',
    'EMBEDDING_MODEL',
    'OPENAI_API_KEY',
    'MASTRA_DATABASE_URL',
  ])('rejects missing %s', (variable) => {
    const environment: Record<string, string | undefined> = validEnvironment();
    delete environment[variable];

    const error = configError(environment);

    expect(error.variables).toContain(variable);
    expect(error.message).toBe(`Invalid configuration: ${variable}`);
  });

  it.each([
    ['SLACK_BOT_TOKEN', `${botPrefix}-short`],
    ['SLACK_APP_TOKEN', `${appPrefix}-short`],
    ['GIST_APPROVED_WORKSPACE_ID', 'workspace-one'],
    ['GIST_APPROVED_CHANNEL_IDS', 'D0DIRECT01'],
    ['GIST_APPROVED_CHANNEL_IDS', 'C0APPROVED1,C0APPROVED1'],
    ['GIST_USER_ALLOWLIST', 'guest-one'],
    ['GIST_DM_SHARED_KNOWLEDGE', 'true'],
    ['GIST_MODEL', 'unapproved-model'],
    ['EMBEDDING_MODEL', 'unapproved/embedding-model'],
    ['MASTRA_DATABASE_URL', './mastra.db'],
    ['MASTRA_DATABASE_URL', 'https://database.example.invalid/mastra'],
  ])('rejects malformed %s', (variable, value) => {
    const environment = { ...validEnvironment(), [variable]: value };

    const error = configError(environment);

    expect(error.variables).toContain(variable);
    expect(error.message).not.toContain(value);
  });

  it('fails closed on an empty approved channel list', () => {
    const environment = { ...validEnvironment(), GIST_APPROVED_CHANNEL_IDS: '  ' };

    const error = configError(environment);

    expect(error.message).toBe('Invalid configuration: GIST_APPROVED_CHANNEL_IDS');
  });

  it('accepts the pre-approved generation model step-down', () => {
    const config = parseConfig({ ...validEnvironment(), GIST_MODEL: 'claude-sonnet-5' });

    expect(config.gistModel).toBe('claude-sonnet-5');
  });

  it('defaults only the accepted empty allowlist and disabled DM sharing policy', () => {
    const environment: Record<string, string | undefined> = validEnvironment();
    delete environment.GIST_USER_ALLOWLIST;
    delete environment.GIST_DM_SHARED_KNOWLEDGE;

    const config = parseConfig(environment);

    expect(config.userAllowlist).toEqual([]);
    expect(config.dmSharedKnowledge).toBe(false);
  });

  it('documents only current variables and placeholder credentials', () => {
    const variables = envExample
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.slice(0, line.indexOf('=')));

    expect(variables).toEqual([
      'SLACK_BOT_TOKEN',
      'SLACK_APP_TOKEN',
      'GIST_APPROVED_WORKSPACE_ID',
      'GIST_APPROVED_CHANNEL_IDS',
      'GIST_USER_ALLOWLIST',
      'GIST_DM_SHARED_KNOWLEDGE',
      'ANTHROPIC_API_KEY',
      'GIST_MODEL',
      'OPENAI_API_KEY',
      'EMBEDDING_MODEL',
      'MASTRA_DATABASE_URL',
    ]);
    expect(envExample).toContain('SLACK_BOT_TOKEN=<required-bot-credential>');
    expect(envExample).toContain('SLACK_APP_TOKEN=<required-app-level-credential>');
  });

  it('names invalid variables without exposing supplied values', () => {
    const privateValue = 'private credential value that must not appear';
    const environment = {
      ...validEnvironment(),
      ANTHROPIC_API_KEY: privateValue,
    };

    const error = configError(environment);

    expect(error.variables).toEqual(['ANTHROPIC_API_KEY']);
    expect(error.message).not.toContain(privateValue);
    expect(JSON.stringify(error)).not.toContain(privateValue);
  });
});
