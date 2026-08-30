import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfigError } from '../../../src/config.js';
import type { SenderAttributes } from '../../../src/security/index.js';
import { makeMessage, makeThread, SYNTHETIC } from '../../channels/helpers.js';

const FULL_MEMBER: SenderAttributes = {
  senderType: 'human',
  isExternal: false,
  isGuest: false,
  isDeactivated: false,
};

let directory: string;
let runtimeModule: typeof import('../../../src/mastra/index.js');

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gist-foundation-test-'));
  const environment = {
    SLACK_BOT_TOKEN: SYNTHETIC.botToken,
    SLACK_APP_TOKEN: SYNTHETIC.appToken,
    GIST_APPROVED_WORKSPACE_ID: SYNTHETIC.workspaceApproved,
    GIST_APPROVED_CHANNEL_IDS: SYNTHETIC.channelApproved,
    GIST_USER_ALLOWLIST: '',
    GIST_DM_SHARED_KNOWLEDGE: 'false',
    GIST_MODEL: 'gpt-4.1',
    EMBEDDING_MODEL: 'openai/text-embedding-3-small',
    OPENAI_API_KEY: 'synthetic-openai-key',
    MASTRA_DATABASE_URL: pathToFileURL(join(directory, 'mastra.db')).href,
  };

  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  runtimeModule = await import('../../../src/mastra/index.js');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('foundation runtime', () => {
  it('validates configuration before any storage exists', async () => {
    // There is no storage to spy on until configuration has been validated,
    // which is the point: the factory builds it from `config.databaseUrl`
    // rather than from a module-level `process.env` read (design review F-05).
    vi.stubEnv('GIST_MODEL', 'invalid-model');

    await expect(runtimeModule.createFoundationRuntime()).rejects.toBeInstanceOf(
      ConfigError,
    );

    vi.stubEnv('GIST_MODEL', 'gpt-4.1');
  });

  it('registers Gist, routes synthetic addressed turns, and settles cleanly', async () => {
    const runtime = await runtimeModule.createFoundationRuntime({
      resolveSender: () => FULL_MEMBER,
    });
    const channelStart = vi.spyOn(runtime.channel, 'start').mockResolvedValue();
    const channelStop = vi.spyOn(runtime.channel, 'stop').mockResolvedValue();
    const mastraShutdown = vi.spyOn(runtime.mastra, 'shutdown');
    const agentStream = vi.spyOn(runtime.gistAgent, 'stream').mockImplementation(
      async () => ({
        textStream: new ReadableStream<string>({
          start(controller) {
            controller.enqueue('Synthetic grounded reply.');
            controller.close();
          },
        }),
      }) as never,
    );

    expect(runtime.mastra.listAgents().gist).toBe(runtime.gistAgent);
    expect(runtime.mastra.getStorage()?.id).toBe('gist-storage');
    expect(runtime.mastra.observability).toBeDefined();

    await runtime.start();
    await runtime.start();
    expect(channelStart).toHaveBeenCalledTimes(1);

    const addressedTurns = [
      {
        run: runtime.channel.handlers.onDirectMessage,
        thread: makeThread({
          isDM: true,
          channelId: SYNTHETIC.dmConversation,
          threadId: `slack:${SYNTHETIC.dmConversation}:1735689650.000100`,
        }),
        surface: 'dm',
      },
      {
        run: runtime.channel.handlers.onNewMention,
        thread: makeThread(),
        surface: 'channel_mention',
      },
      {
        run: runtime.channel.handlers.onSubscribedMessage,
        thread: makeThread(),
        surface: 'subscribed_thread',
      },
    ] as const;

    for (const turn of addressedTurns) {
      await turn.run(turn.thread.thread, makeMessage());
      expect(turn.thread.posts).toHaveLength(1);
      expect(turn.thread.posts[0]).toBeInstanceOf(ReadableStream);
    }
    expect(agentStream.mock.calls.map(([request]) => request)).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);

    const denied = makeThread({ channelId: SYNTHETIC.channelUnapproved });
    await runtime.channel.handlers.onNewMention(denied.thread, makeMessage());
    expect(denied.posts).toHaveLength(0);
    expect(agentStream).toHaveBeenCalledTimes(3);

    await runtime.stop();
    await runtime.stop();
    expect(channelStop).toHaveBeenCalledTimes(1);
    expect(mastraShutdown).toHaveBeenCalledTimes(1);
    expect(channelStop.mock.invocationCallOrder[0]).toBeLessThan(
      mastraShutdown.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('handles SIGINT and SIGTERM with one shutdown', async () => {
    const { installShutdownHandlers } = await import('../../../src/index.js');
    const signals = new EventEmitter();
    const stop = vi.fn(async () => undefined);
    const remove = installShutdownHandlers({ stop }, signals);

    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    remove();
  });

  it('contains no legacy Slack Bolt or Claude CLI request path', async () => {
    const sources = await Promise.all([
      readFile(new URL('../../../src/index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../../src/mastra/index.ts', import.meta.url), 'utf8'),
    ]);

    for (const source of sources) {
      expect(source).not.toContain('@slack/bolt');
      expect(source).not.toMatch(/node:child_process|child_process|execSync|spawnSync/);
    }
  });
});
