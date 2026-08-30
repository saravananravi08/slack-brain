import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { SlackAdapter } from '@chat-adapter/slack';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveIdentity } from '../../../src/mastra/memory/resource-policy.js';
import type { SenderAttributes } from '../../../src/security/index.js';
import { makeMessage, makeThread, SYNTHETIC } from '../../channels/helpers.js';

const FULL_MEMBER: SenderAttributes = {
  senderType: 'human',
  isExternal: false,
  isGuest: false,
  isDeactivated: false,
};

const temporaryDirectories: string[] = [];

async function loadRuntime(databaseName: string) {
  const directory = await mkdtemp(join(tmpdir(), 'gist-memory-runtime-test-'));
  temporaryDirectories.push(directory);

  const environment = {
    SLACK_BOT_TOKEN: SYNTHETIC.botToken,
    SLACK_APP_TOKEN: SYNTHETIC.appToken,
    GIST_APPROVED_WORKSPACE_ID: SYNTHETIC.workspaceApproved,
    GIST_APPROVED_CHANNEL_IDS: SYNTHETIC.channelApproved,
    GIST_USER_ALLOWLIST: '',
    GIST_DM_SHARED_KNOWLEDGE: 'false',
    GIST_MODEL: 'claude-opus-5',
    ANTHROPIC_API_KEY: 'synthetic-anthropic-key',
    EMBEDDING_MODEL: 'openai/text-embedding-3-small',
    OPENAI_API_KEY: 'synthetic-openai-key',
    MASTRA_DATABASE_URL: pathToFileURL(join(directory, databaseName)).href,
  };

  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  vi.resetModules();

  return {
    directory,
    databaseUrl: environment.MASTRA_DATABASE_URL,
    module: await import('../../../src/mastra/index.js'),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('memory, identity, and access composition', () => {
  it('authorizes before model use and supplies isolated Mastra memory identities', async () => {
    const runtimeModule = (await loadRuntime('composition.db')).module;
    const resolveSender = vi.fn(({ senderId }: { senderId: string }) =>
      senderId === SYNTHETIC.userGuest
        ? { ...FULL_MEMBER, isGuest: true }
        : FULL_MEMBER,
    );
    const runtime = await runtimeModule.createFoundationRuntime({ resolveSender });
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

    expect(await runtime.gistAgent.getMemory()).toBe(runtime.memory);
    expect(runtime.memory.getMergedThreadConfig()).toMatchObject({
      semanticRecall: { scope: 'resource' },
    });

    const channelThread = makeThread({
      threadId: `slack:${SYNTHETIC.channelApproved}:1735689650.000100`,
    });
    await runtime.channel.handlers.onNewMention(
      channelThread.thread,
      makeMessage({ userId: SYNTHETIC.userMember }),
    );
    await runtime.channel.handlers.onSubscribedMessage(
      channelThread.thread,
      makeMessage({ userId: 'U0MEMBER02', ts: '1735689800.000100' }),
    );

    const firstDm = makeThread({
      isDM: true,
      channelId: SYNTHETIC.dmConversation,
      threadId: `slack:${SYNTHETIC.dmConversation}:1735689600.000100`,
    });
    await runtime.channel.handlers.onDirectMessage(
      firstDm.thread,
      makeMessage({ userId: SYNTHETIC.userMember, ts: '1735689600.000100' }),
    );

    const secondDm = makeThread({
      isDM: true,
      channelId: 'D0DMCONV02',
      threadId: 'slack:D0DMCONV02:1735689600.000300',
    });
    await runtime.channel.handlers.onDirectMessage(
      secondDm.thread,
      makeMessage({ userId: 'U0MEMBER02', ts: '1735689600.000300' }),
    );

    const calls = agentStream.mock.calls as unknown as Array<[
      string,
      { memory: { resource: string; thread: string } },
    ]>;
    expect(calls.map(([, options]) => options.memory)).toEqual([
      {
        resource: `ch:${SYNTHETIC.workspaceApproved}:${SYNTHETIC.channelApproved}`,
        thread: `ch:${SYNTHETIC.workspaceApproved}:${SYNTHETIC.channelApproved}#1735689650.000100`,
      },
      {
        resource: `ch:${SYNTHETIC.workspaceApproved}:${SYNTHETIC.channelApproved}`,
        thread: `ch:${SYNTHETIC.workspaceApproved}:${SYNTHETIC.channelApproved}#1735689650.000100`,
      },
      {
        resource: `dm:${SYNTHETIC.workspaceApproved}:${SYNTHETIC.userMember}`,
        thread: `dm:${SYNTHETIC.workspaceApproved}:${SYNTHETIC.userMember}#1735689600.000100`,
      },
      {
        resource: `dm:${SYNTHETIC.workspaceApproved}:U0MEMBER02`,
        thread: `dm:${SYNTHETIC.workspaceApproved}:U0MEMBER02#1735689600.000300`,
      },
    ]);
    expect(resolveSender.mock.invocationCallOrder[0]).toBeLessThan(
      agentStream.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    const denied = makeThread();
    await runtime.channel.handlers.onNewMention(
      denied.thread,
      makeMessage({ userId: SYNTHETIC.userGuest }),
    );
    expect(agentStream).toHaveBeenCalledTimes(4);
    expect(denied.posts).toEqual(["I can't help with that here."]);

    await runtime.stop();
  });

  it('maps Slack users.info attributes and fails closed on incomplete profiles', async () => {
    const runtimeModule = (await loadRuntime('sender.db')).module;
    const info = vi.fn(async () => ({
      ok: true,
      user: {
        id: SYNTHETIC.userExternal,
        team_id: 'T0SYNTH99',
        is_app_user: false,
        is_bot: false,
        is_restricted: true,
        is_ultra_restricted: false,
        is_stranger: true,
        deleted: true,
      },
    }));
    const adapter = { webClient: { users: { info } } } as unknown as SlackAdapter;

    await expect(
      runtimeModule.resolveSlackSender(adapter, {
        workspaceId: SYNTHETIC.workspaceApproved,
        senderId: SYNTHETIC.userExternal,
      }),
    ).resolves.toEqual({
      senderType: 'human',
      isExternal: true,
      isGuest: true,
      isDeactivated: true,
    });
    expect(info).toHaveBeenCalledWith({ user: SYNTHETIC.userExternal });

    await expect(
      runtimeModule.resolveSlackSender(adapter, {
        workspaceId: SYNTHETIC.workspaceApproved,
        senderId: SYNTHETIC.userMember,
      }),
    ).resolves.toBeNull();
  });

  it('retains a resolved memory thread across a process-style restart', async () => {
    const firstLoad = await loadRuntime('restart.db');
    const first = await firstLoad.module.createFoundationRuntime({
      resolveSender: () => FULL_MEMBER,
    });
    const identity = resolveIdentity({
      contract_version: '1.0.0',
      workspace_id: SYNTHETIC.workspaceApproved,
      channel_id: SYNTHETIC.channelApproved,
      conversation_type: 'channel',
      message_ts: '1735689650.000100',
      thread_ts: null,
      sender_id: SYNTHETIC.userMember,
    });

    await first.memory.createThread({
      threadId: identity.thread_id,
      resourceId: identity.resource_id,
      title: 'Synthetic persisted context',
      saveThread: true,
    });
    await first.stop();

    vi.resetModules();
    const restartedModule = await import('../../../src/mastra/index.js');
    const restarted = await restartedModule.createFoundationRuntime({
      resolveSender: () => FULL_MEMBER,
    });
    const restored = await restarted.memory.getThreadById({
      threadId: identity.thread_id,
      resourceId: identity.resource_id,
    });

    expect(restored).toMatchObject({
      id: identity.thread_id,
      resourceId: identity.resource_id,
      title: 'Synthetic persisted context',
    });

    await restarted.stop();
  });
});
