import { describe, expect, it } from 'vitest';

import { GIST_FALLBACK_RESPONSES } from '../../../src/mastra/agents/instructions.js';
import {
  BOUNDARIES,
  closeValidationMemory,
  createThread,
  openValidationMemory,
  SYNTHETIC,
  syntheticMessage,
  temporaryDatabase,
} from '../../integration/memory-validation/helpers.js';

const FACT = 'Project Lantern reports use object storage because application disks change on deployment.';
const SOURCE_TS = '1735689800.000100';

function evidence(boundaryId: string, channelId: string, threadId: string, text = FACT) {
  return syntheticMessage({
    id: `${SYNTHETIC.workspace}/${channelId}/${SOURCE_TS}`,
    boundaryId,
    threadId,
    channelId,
    senderName: 'Synthetic Member Two',
    timestamp: SOURCE_TS,
    text,
  });
}

describe('T501 durable recall and privacy acceptance', () => {
  it('AC-05: retains conversation context across a process-style restart', async () => {
    const database = await temporaryDatabase();
    let first = await openValidationMemory(database.databaseUrl);
    try {
      const sourceThread = await createThread(first, BOUNDARIES.channelAlpha, SOURCE_TS);
      await first.memory.saveMessages({
        messages: [evidence(BOUNDARIES.channelAlpha, SYNTHETIC.channelAlpha, sourceThread)],
      });
      await closeValidationMemory(first);

      first = await openValidationMemory(database.databaseUrl);
      const restored = await first.memory.getThreadById({
        threadId: sourceThread,
        resourceId: BOUNDARIES.channelAlpha,
      });
      const recalled = await first.memory.recallWithCitationMetadata({
        threadId: sourceThread,
        resourceId: BOUNDARIES.channelAlpha,
      });

      expect(restored).toMatchObject({
        id: sourceThread,
        resourceId: BOUNDARIES.channelAlpha,
      });
      expect(recalled.map(({ text }) => text)).toContain(FACT);
    } finally {
      await closeValidationMemory(first);
      await database.remove();
    }
  });

  it('AC-07: recalls a paraphrased archived decision with citation metadata', async () => {
    const database = await temporaryDatabase();
    const runtime = await openValidationMemory(database.databaseUrl);
    try {
      const sourceThread = await createThread(runtime, BOUNDARIES.channelAlpha, SOURCE_TS);
      const queryThread = await createThread(
        runtime,
        BOUNDARIES.channelAlpha,
        '1735690800.000200',
      );
      await runtime.memory.saveMessages({
        messages: [evidence(BOUNDARIES.channelAlpha, SYNTHETIC.channelAlpha, sourceThread)],
      });

      const recalled = await runtime.memory.recallWithCitationMetadata({
        threadId: queryThread,
        resourceId: BOUNDARIES.channelAlpha,
        vectorSearchString: 'Where should deployment output live?',
        perPage: 0,
      });

      expect(recalled).toEqual([
        expect.objectContaining({
          boundary_id: BOUNDARIES.channelAlpha,
          sender_name: 'Synthetic Member Two',
          sent_at: '2025-01-01T00:03:20.000Z',
          text: FACT,
        }),
      ]);
    } finally {
      await closeValidationMemory(runtime);
      await database.remove();
    }
  });

  it('AC-08: returns no evidence for unknown history and pins the unverified response', async () => {
    const database = await temporaryDatabase();
    const runtime = await openValidationMemory(database.databaseUrl);
    try {
      const queryThread = await createThread(
        runtime,
        BOUNDARIES.channelAlpha,
        '1735690900.000200',
      );
      const recalled = await runtime.memory.recallWithCitationMetadata({
        threadId: queryThread,
        resourceId: BOUNDARIES.channelAlpha,
        vectorSearchString: 'What was the synthetic moon-base catering decision?',
        perPage: 0,
      });

      expect(recalled).toEqual([]);
      expect(GIST_FALLBACK_RESPONSES.unverified)
        .toBe("I couldn't verify that from the available evidence.");
    } finally {
      await closeValidationMemory(runtime);
      await database.remove();
    }
  });

  it('AC-10: never recalls one user DM inside another user or channel boundary', async () => {
    const database = await temporaryDatabase();
    const runtime = await openValidationMemory(database.databaseUrl);
    try {
      const sourceThread = await createThread(runtime, BOUNDARIES.dmAvery, SOURCE_TS);
      const blakeThread = await createThread(runtime, BOUNDARIES.dmBlake, '1735691000.000200');
      const channelThread = await createThread(
        runtime,
        BOUNDARIES.channelAlpha,
        '1735691001.000200',
      );
      await runtime.memory.saveMessages({
        messages: [evidence(
          BOUNDARIES.dmAvery,
          'D0DMCONV01',
          sourceThread,
          'Synthetic Avery private review hour is 14:00 UTC.',
        )],
      });

      for (const [boundaryId, threadId] of [
        [BOUNDARIES.dmBlake, blakeThread],
        [BOUNDARIES.channelAlpha, channelThread],
      ] as const) {
        await expect(runtime.memory.recallWithCitationMetadata({
          threadId,
          resourceId: boundaryId,
          vectorSearchString: 'What is Avery private review hour?',
          perPage: 0,
        })).resolves.toEqual([]);
      }
    } finally {
      await closeValidationMemory(runtime);
      await database.remove();
    }
  });

  it('AC-11: never returns protected history to another channel', async () => {
    const database = await temporaryDatabase();
    const runtime = await openValidationMemory(database.databaseUrl);
    try {
      const sourceThread = await createThread(runtime, BOUNDARIES.channelAlpha, SOURCE_TS);
      const queryThread = await createThread(
        runtime,
        BOUNDARIES.channelBeta,
        '1735691100.000200',
      );
      await runtime.memory.saveMessages({
        messages: [evidence(BOUNDARIES.channelAlpha, SYNTHETIC.channelAlpha, sourceThread)],
      });

      const recalled = await runtime.memory.recallWithCitationMetadata({
        threadId: queryThread,
        resourceId: BOUNDARIES.channelBeta,
        vectorSearchString: 'Where should deployment output live?',
        perPage: 0,
      });

      expect(recalled).toEqual([]);
    } finally {
      await closeValidationMemory(runtime);
      await database.remove();
    }
  });
});
