import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGistAgent, createGistModel } from '../../../src/mastra/agents/gist.js';
import {
  BOUNDARIES,
  closeValidationMemory,
  createThread,
  openValidationMemory,
  SYNTHETIC,
  syntheticMessage,
  temporaryDatabase,
  type ValidationMemory,
} from './helpers.js';

const resources: ValidationMemory[] = [];
const removals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map(closeValidationMemory));
  await Promise.all(removals.splice(0).map((remove) => remove()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function makeMemory(): Promise<ValidationMemory> {
  const database = await temporaryDatabase();
  removals.push(database.remove);
  const resource = await openValidationMemory(database.databaseUrl);
  resources.push(resource);
  return resource;
}

function lanternMessage(thread: string) {
  const timestamp = '1735689800.000100';
  return syntheticMessage({
    id: `${SYNTHETIC.workspace}/${SYNTHETIC.channelAlpha}/${timestamp}`,
    boundaryId: BOUNDARIES.channelAlpha,
    threadId: thread,
    channelId: SYNTHETIC.channelAlpha,
    senderName: 'Synthetic Member Two',
    timestamp,
    text: 'Project Lantern reports use object storage because application disks change on deployment.',
  });
}

describe('integrated recall quality with synthetic embeddings', () => {
  it('recalls paraphrased evidence across threads in the same channel resource', async () => {
    const resource = await makeMemory();
    const sourceThread = await createThread(
      resource,
      BOUNDARIES.channelAlpha,
      '1735689800.000100',
    );
    const queryThread = await createThread(
      resource,
      BOUNDARIES.channelAlpha,
      '1735690800.000200',
    );
    await resource.memory.saveMessages({ messages: [lanternMessage(sourceThread)] });

    const items = await resource.memory.recallWithCitationMetadata({
      threadId: queryThread,
      resourceId: BOUNDARIES.channelAlpha,
      vectorSearchString: 'Where should deployment output live?',
      perPage: 0,
    });

    expect(items).toEqual([
      {
        message_key: `${SYNTHETIC.workspace}/${SYNTHETIC.channelAlpha}/1735689800.000100`,
        boundary_id: BOUNDARIES.channelAlpha,
        thread_id: sourceThread,
        sender_name: 'Synthetic Member Two',
        sent_at: '2025-01-01T00:03:20.000Z',
        channel_id: SYNTHETIC.channelAlpha,
        message_ts: '1735689800.000100',
        text: 'Project Lantern reports use object storage because application disks change on deployment.',
      },
    ]);
  });

  it('recalls same-thread persisted context without semantic search', async () => {
    const resource = await makeMemory();
    const sourceThread = await createThread(
      resource,
      BOUNDARIES.channelAlpha,
      '1735689800.000100',
    );
    await resource.memory.saveMessages({ messages: [lanternMessage(sourceThread)] });

    const items = await resource.memory.recallWithCitationMetadata({
      threadId: sourceThread,
      resourceId: BOUNDARIES.channelAlpha,
    });

    expect(items.map(({ message_key }) => message_key)).toContain(
      `${SYNTHETIC.workspace}/${SYNTHETIC.channelAlpha}/1735689800.000100`,
    );
  });

  it('keeps automatic citation recall model-invisible', async () => {
    const resource = await makeMemory();
    const agent = createGistAgent(createGistModel('gpt-4.1'), resource.memory);
    const processors = await resource.memory.getInputProcessors();

    expect(processors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'semantic-recall', name: 'GistCitationRecall' }),
      ]),
    );
    expect(resource.memory.listTools()).toEqual({});
    expect(await agent.listTools()).toEqual({});
  });
});

describe('durable recall', () => {
  it('recalls persisted cross-thread evidence after a process-style restart', async () => {
    const database = await temporaryDatabase();
    removals.push(database.remove);
    const first = await openValidationMemory(database.databaseUrl);
    const sourceThread = await createThread(
      first,
      BOUNDARIES.channelAlpha,
      '1735689800.000100',
    );
    const queryThread = await createThread(
      first,
      BOUNDARIES.channelAlpha,
      '1735690800.000200',
    );
    await first.memory.saveMessages({ messages: [lanternMessage(sourceThread)] });
    await closeValidationMemory(first);

    const restarted = await openValidationMemory(database.databaseUrl);
    resources.push(restarted);
    const items = await restarted.memory.recallWithCitationMetadata({
      threadId: queryThread,
      resourceId: BOUNDARIES.channelAlpha,
      vectorSearchString: 'Where should deployment output live?',
      perPage: 0,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      boundary_id: BOUNDARIES.channelAlpha,
      sender_name: 'Synthetic Member Two',
      message_ts: '1735689800.000100',
    });
  });
});
