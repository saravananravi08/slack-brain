import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MastraDBMessage } from '@mastra/core/agent';

import fixture from './fixtures/history.v1.json' with { type: 'json' };
import { resolveIdentity, type ResourceIdentity } from '../../../src/mastra/memory/resource-policy.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';

interface FixtureMessage {
  readonly channel_id: string;
  readonly message_ts: string;
  readonly thread_root_ts: string;
  readonly text: string;
  readonly metadata_text?: string;
  readonly edited_at?: string;
}

const messages = fixture.messages as readonly FixtureMessage[];

export const SYNTHETIC_HISTORY = {
  workspaceId: fixture.workspace_id,
  channelA: fixture.channel_a,
  channelB: fixture.channel_b,
  senderId: fixture.sender_id,
  boundaryA: `ch:${fixture.workspace_id}:${fixture.channel_a}`,
  boundaryB: `ch:${fixture.workspace_id}:${fixture.channel_b}`,
  messages,
} as const;

export function identityFor(
  channelId = SYNTHETIC_HISTORY.channelA,
  threadRootTs = '1700000000.000100',
): ResourceIdentity {
  return resolveIdentity({
    contract_version: '1.0.0',
    workspace_id: SYNTHETIC_HISTORY.workspaceId,
    channel_id: channelId,
    conversation_type: 'channel',
    message_ts: '1700000099.000100',
    thread_ts: threadRootTs,
    sender_id: SYNTHETIC_HISTORY.senderId,
  });
}

export function storedMessage(input: FixtureMessage): MastraDBMessage {
  const boundaryId = `ch:${SYNTHETIC_HISTORY.workspaceId}:${input.channel_id}`;
  const threadId = `${boundaryId}#${input.thread_root_ts}`;
  const key = `${SYNTHETIC_HISTORY.workspaceId}/${input.channel_id}/${input.message_ts}`;
  const sentAt = new Date(Number(input.message_ts.split('.')[0]) * 1_000).toISOString();
  return {
    id: key,
    role: 'user',
    createdAt: new Date(sentAt),
    threadId,
    resourceId: boundaryId,
    content: {
      format: 2,
      parts: [{ type: 'text', text: input.text }],
      metadata: {
        contract_version: '1.0.0',
        message_key: key,
        boundary_id: boundaryId,
        thread_id: threadId,
        workspace_id: SYNTHETIC_HISTORY.workspaceId,
        channel_id: input.channel_id,
        message_ts: input.message_ts,
        thread_root_ts: input.thread_root_ts,
        is_thread_reply: input.thread_root_ts !== input.message_ts,
        sender: {
          sender_class: 'human',
          sender_id: SYNTHETIC_HISTORY.senderId,
          sender_display_name: 'Synthetic User',
          bot_id: null,
          app_id: null,
          username: null,
          is_gist_self: false,
          is_external: false,
          is_guest: false,
        },
        sender_id: SYNTHETIC_HISTORY.senderId,
        sender_name: 'Synthetic User',
        sent_at: sentAt,
        edited_at: input.edited_at ?? null,
        text: input.metadata_text ?? input.text,
        files: [],
        links: [],
        capture_source: 'live_event',
        ingested_at: '2023-11-14T22:15:00.000Z',
        enrollment_epoch: 1,
        conversation_type: 'channel',
        source: 'live',
      },
    },
  };
}

export async function createHistoryHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'gist-channel-history-test-'));
  const storage = createMastraStorage({
    databaseUrl: pathToFileURL(join(directory, 'mastra.db')).href,
  });
  await storage.init();
  const store = await storage.getStore('memory');
  if (!store) throw new Error('Synthetic memory store unavailable.');

  return {
    storage,
    save: async (selected: readonly FixtureMessage[]) => {
      await store.saveMessages({ messages: selected.map(storedMessage) });
    },
    close: async () => {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
