import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MastraDBMessage } from '@mastra/core/agent';
import { LibSQLVector } from '@mastra/libsql';
import { vi } from 'vitest';

import {
  GIST_EMBEDDING_DIMENSIONS,
  GIST_EMBEDDING_MODEL,
  createGistMemory,
} from '../../../src/mastra/memory/gist-memory.js';
import { createMastraStorage } from '../../../src/mastra/storage/index.js';

export const SYNTHETIC = {
  workspace: 'T0SYNTH01',
  channelAlpha: 'C0APPROVED1',
  channelBeta: 'C0APPROVED2',
  userAvery: 'U0MEMBER01',
  userBlake: 'U0MEMBER02',
} as const;

export const BOUNDARIES = {
  channelAlpha: 'ch:T0SYNTH01:C0APPROVED1',
  channelBeta: 'ch:T0SYNTH01:C0APPROVED2',
  dmAvery: 'dm:T0SYNTH01:U0MEMBER01',
  dmBlake: 'dm:T0SYNTH01:U0MEMBER02',
} as const;

export interface ValidationMemory {
  memory: ReturnType<typeof createGistMemory>;
  storage: ReturnType<typeof createMastraStorage>;
  vector: LibSQLVector;
}

export async function temporaryDatabase(): Promise<{
  databaseUrl: string;
  remove(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'gist-memory-validation-'));
  return {
    databaseUrl: pathToFileURL(join(directory, 'mastra.db')).href,
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

function topicIndex(text: string): number {
  const normalized = text.toLowerCase();
  if (/lantern|deployment|object storage|application disk/.test(normalized)) return 0;
  if (/orbit|preview|address/.test(normalized)) return 1;
  if (/rollout|window/.test(normalized)) return 2;
  if (/review hour|avery private/.test(normalized)) return 3;
  if (/hexagon|shape|blake private/.test(normalized)) return 4;
  return 5;
}

function deterministicVector(text: string): number[] {
  const vector = Array<number>(GIST_EMBEDDING_DIMENSIONS).fill(0);
  vector[topicIndex(text)] = 1;
  return vector;
}

export async function openValidationMemory(databaseUrl: string): Promise<ValidationMemory> {
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_OPENAI_KEY');
  const storage = createMastraStorage({ databaseUrl });
  await storage.init();
  const memory = createGistMemory({
    storage,
    databaseUrl,
    embeddingModel: GIST_EMBEDDING_MODEL,
  });
  const vector = memory.vector as LibSQLVector;

  vi.spyOn(memory.embedder!, 'doEmbed').mockImplementation(
    async ({ values }: { values: string[] }) => ({
      embeddings: values.map(deterministicVector),
      usage: { tokens: values.length },
      warnings: [],
    }),
  );

  return { memory, storage, vector };
}

export async function closeValidationMemory(resource: ValidationMemory): Promise<void> {
  await resource.memory.settled();
  await resource.vector.close();
  await resource.storage.close();
}

export function threadId(boundaryId: string, timestamp: string): string {
  return `${boundaryId}#${timestamp}`;
}

export function syntheticMessage(input: {
  id: string;
  boundaryId: string;
  threadId: string;
  channelId: string;
  senderName: string;
  timestamp: string;
  text: string;
}): MastraDBMessage {
  return {
    id: input.id,
    role: 'user',
    createdAt: new Date(Number(input.timestamp.split('.')[0]) * 1_000),
    threadId: input.threadId,
    resourceId: input.boundaryId,
    content: {
      format: 2,
      parts: [{ type: 'text', text: input.text }],
      metadata: {
        channel_id: input.channelId,
        sender_name: input.senderName,
        message_ts: input.timestamp,
      },
    },
  };
}

export async function createThread(
  resource: ValidationMemory,
  boundaryId: string,
  timestamp: string,
): Promise<string> {
  const id = threadId(boundaryId, timestamp);
  await resource.memory.createThread({
    threadId: id,
    resourceId: boundaryId,
    title: 'Synthetic validation thread',
    saveThread: true,
  });
  return id;
}
