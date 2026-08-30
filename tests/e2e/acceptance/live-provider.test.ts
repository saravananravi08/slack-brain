import { describe, expect, it, vi } from 'vitest';

import { createGistAgent, createGistModel } from '../../../src/mastra/agents/gist.js';
import { createSlackChannel } from '../../../src/mastra/channels/index.js';
import { makeOptions } from '../../channels/helpers.js';
import {
  BOUNDARIES,
  closeValidationMemory,
  createThread,
  openValidationMemory,
  SYNTHETIC,
  syntheticMessage,
  temporaryDatabase,
} from '../../integration/memory-validation/helpers.js';

const LIVE_PROVIDER = process.env.T501_LIVE_PROVIDER === '1';
const LIVE_SOCKET = process.env.T501_LIVE_SOCKET === '1';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this opt-in acceptance test.`);
  return value;
}

describe.runIf(LIVE_PROVIDER)('T501 real OpenAI acceptance', () => {
  it('generates a grounded addressed response with sender/date citation and declines unknown history', async () => {
    const apiKey = requiredEnvironment('OPENAI_API_KEY');
    const database = await temporaryDatabase();
    const runtime = await openValidationMemory(database.databaseUrl);
    try {
      vi.stubEnv('OPENAI_API_KEY', apiKey);
      const sourceTimestamp = '1735689800.000100';
      const sourceThread = await createThread(
        runtime,
        BOUNDARIES.channelAlpha,
        sourceTimestamp,
      );
      const queryThread = await createThread(
        runtime,
        BOUNDARIES.channelAlpha,
        '1735690800.000200',
      );
      await runtime.memory.saveMessages({
        messages: [syntheticMessage({
          id: `${SYNTHETIC.workspace}/${SYNTHETIC.channelAlpha}/${sourceTimestamp}`,
          boundaryId: BOUNDARIES.channelAlpha,
          threadId: sourceThread,
          channelId: SYNTHETIC.channelAlpha,
          senderName: 'Synthetic Member Two',
          timestamp: sourceTimestamp,
          text: 'Project Lantern reports use object storage because application disks change on deployment.',
        })],
      });

      const agent = createGistAgent(createGistModel('gpt-4.1'), runtime.memory);
      const grounded = await agent.generate('Where should deployment output live?', {
        memory: { resource: BOUNDARIES.channelAlpha, thread: queryThread },
      });
      const answer = grounded.text.toLowerCase();
      expect(answer).toContain('object storage');
      expect(answer).toContain('synthetic member two');
      expect(answer).toMatch(/2025|jan/);

      const emptyThread = await createThread(
        runtime,
        BOUNDARIES.channelBeta,
        '1735690900.000200',
      );
      const unknown = await agent.generate('What was the moon-base catering decision?', {
        memory: { resource: BOUNDARIES.channelBeta, thread: emptyThread },
      });
      expect(unknown.text.toLowerCase()).toContain(
        "i couldn't verify that from the available evidence",
      );
    } finally {
      await closeValidationMemory(runtime);
      await database.remove();
      vi.unstubAllEnvs();
    }
  }, 120_000);
});

describe.runIf(LIVE_SOCKET)('T501 live Slack Socket Mode acceptance', () => {
  it('disconnects and reconnects Socket Mode over the same state', async () => {
    const { options } = makeOptions();
    const credentials = {
      botToken: requiredEnvironment('SLACK_BOT_TOKEN'),
      appToken: requiredEnvironment('SLACK_APP_TOKEN'),
    };
    const first = createSlackChannel({ ...options, credentials });
    let botUserId: string | undefined;

    try {
      await first.start();
      botUserId = first.adapter.botUserId;
      expect(botUserId).toMatch(/^U[A-Z0-9]+$/);
    } finally {
      await first.stop();
    }

    const reconnected = createSlackChannel({ ...options, credentials });
    try {
      await reconnected.start();
      expect(reconnected.adapter.botUserId).toBe(botUserId);
    } finally {
      await reconnected.stop();
    }
  }, 45_000);
});
