/**
 * Adapter construction and composition.
 *
 * Covers FR-SLK-001 (display name), FR-SLK-011 (Socket Mode), FR-OPS-002
 * (no hardcoded/implicit credential defaults), and T104 implementation
 * step 5 (no Slack Bolt import, no webhook-only assumption).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createGistSlackAdapter,
  SlackCredentialsError,
} from '../../src/mastra/channels/slack-adapter.js';
import { createSlackChannel, GIST_USER_NAME } from '../../src/mastra/channels/index.js';
import { makeMemoryState, makeOptions, SYNTHETIC } from './helpers.js';

const CHANNELS_DIR = join(process.cwd(), 'src', 'mastra', 'channels');
const SOURCE_FILES = ['index.ts', 'handlers.ts', 'slack-adapter.ts', 'errors.ts', 'types.ts'];

describe('adapter construction', () => {
  it('initializes with synthetic test credentials', () => {
    const adapter = createGistSlackAdapter({
      botToken: SYNTHETIC.botToken,
      appToken: SYNTHETIC.appToken,
    });

    expect(adapter).toBeDefined();
  });

  it('runs in Socket Mode, not the adapter default of webhook (FR-SLK-011)', () => {
    const adapter = createGistSlackAdapter({
      botToken: SYNTHETIC.botToken,
      appToken: SYNTHETIC.appToken,
    });

    // `mode` is protected on the adapter class; read it structurally so a
    // silent regression to webhook mode fails here rather than in production
    // as "Slack events stopped arriving".
    expect((adapter as unknown as { mode: string }).mode).toBe('socket');
  });

  it('refuses to construct without a bot token (FR-OPS-002)', () => {
    expect(() =>
      createGistSlackAdapter({ botToken: '', appToken: SYNTHETIC.appToken }),
    ).toThrow(SlackCredentialsError);
  });

  it('refuses to construct without an app-level token', () => {
    expect(() =>
      createGistSlackAdapter({ botToken: SYNTHETIC.botToken, appToken: '   ' }),
    ).toThrow(SlackCredentialsError);
  });

  it('does not echo a token value in the credential error', () => {
    try {
      createGistSlackAdapter({ botToken: SYNTHETIC.botToken, appToken: '' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(SYNTHETIC.botToken);
    }
  });
});

describe('channel composition', () => {
  it('builds a channel with handlers registered', () => {
    const { options } = makeOptions();
    const channel = createSlackChannel({ ...options, state: makeMemoryState() });

    expect(channel.bot).toBeDefined();
    expect(channel.adapter).toBeDefined();
    expect(typeof channel.handlers.onDirectMessage).toBe('function');
    expect(typeof channel.handlers.onNewMention).toBe('function');
    expect(typeof channel.handlers.onSubscribedMessage).toBe('function');
  });

  it('exposes start and stop without connecting during construction', () => {
    const { options } = makeOptions();
    const channel = createSlackChannel(options);

    // Construction must not open a socket — these tests run offline.
    expect(typeof channel.start).toBe('function');
    expect(typeof channel.stop).toBe('function');
  });

  it('presents itself as Gist (FR-SLK-001, FR-RSP-001)', () => {
    expect(GIST_USER_NAME).toBe('Gist');
  });
});

describe('no legacy runtime dependencies (NFR-MNT-004)', () => {
  const sources = SOURCE_FILES.map((file) => ({
    file,
    text: readFileSync(join(CHANNELS_DIR, file), 'utf8'),
  }));

  it('imports no Slack Bolt', () => {
    for (const { file, text } of sources) {
      expect(text, `${file} must not import @slack/bolt`).not.toContain('@slack/bolt');
    }
  });

  it('spawns no Claude CLI child process', () => {
    for (const { file, text } of sources) {
      expect(text, `${file} must not spawn a child process`).not.toMatch(
        /child_process|execSync|spawnSync/,
      );
    }
  });

  it('does not reach into the agent, memory, or config modules', () => {
    // T104 owns transport only; memory (T201/T202), generation (T105), and
    // config (T102) arrive through injected ports.
    for (const { file, text } of sources) {
      expect(text, `${file} must not import agents`).not.toMatch(/from '.*agents\//);
      expect(text, `${file} must not import memory`).not.toMatch(/from '.*\/memory\//);
      expect(text, `${file} must not import src\\/config`).not.toMatch(/from '.*\/config\.js'/);
    }
  });

  it('reads no credential from the ambient environment', () => {
    for (const { file, text } of sources) {
      expect(text, `${file} must not read process.env`).not.toContain('process.env');
    }
  });
});
