import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MutationHandler,
  type MutationStorage,
} from '../../../src/ingestion/mutations/index.js';
import {
  CHANNEL_CONTEXT_ACCEPTANCE_IDS,
  CHANNEL_CONTEXT_ACCEPTANCE_MATRIX,
} from './acceptance-matrix.js';
import {
  BOUNDARY,
  IDS,
  THREAD,
  SyntheticObservationEngine,
  authorization,
  contextProvider,
  historyRecord,
  observationMemory,
  observationMessage,
  observationRecord,
  runAgent,
  serializedPrompt,
} from './helpers.js';

const RECENT = 'Synthetic recent work marker.';
const SUMMARY = 'Synthetic rolling summary marker.';
const OBSERVATION = 'Synthetic observation marker.';
const OLD_A = 'Synthetic old channel A marker.';
const FOREIGN_A = 'Synthetic foreign channel A marker.';
const EDITED = 'Synthetic edited wording marker.';
const STALE = 'Synthetic stale wording marker.';

function emptyObservations() {
  return { context: async () => ({ summary: null, observations: '' }) };
}

function oldCitation() {
  return {
    message_key: `${IDS.workspace}/${IDS.channelA}/1767000000.000100`,
    boundary_id: BOUNDARY.A,
    thread_id: THREAD.A,
    sender_name: 'Synthetic Historical Sender',
    sent_at: '2025-12-01T00:00:00.000Z',
    channel_id: IDS.channelA,
    message_ts: '1767000000.000100',
    text: OLD_A,
  } as const;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T706 offline channel-context acceptance', () => {
  it('enumerates exactly CM-AC-08…11 with offline and live evidence', () => {
    expect(Object.keys(CHANNEL_CONTEXT_ACCEPTANCE_MATRIX).sort()).toEqual(
      [...CHANNEL_CONTEXT_ACCEPTANCE_IDS].sort(),
    );
    for (const entry of Object.values(CHANNEL_CONTEXT_ACCEPTANCE_MATRIX)) {
      expect(entry.offlineEvidence.length).toBeGreaterThan(0);
      expect(entry.liveEvidence.length).toBeGreaterThan(0);
    }
  });

  it('CM-AC-08: answers from recent history without executing semantic search', async () => {
    const records = [historyRecord({
      alias: 'A',
      messageTs: '1767225601.000100',
      text: RECENT,
      senderName: 'Synthetic Recent Sender',
    })];
    const provider = contextProvider({ records, observations: emptyObservations() });

    const result = await runAgent({
      alias: 'A',
      provider,
      question: 'What is the recent work?',
      answer: 'Recent work is available in default context.',
    });

    expect(result.model.calls).toHaveLength(1);
    expect(result.toolExecutions).not.toHaveBeenCalled();
    expect(serializedPrompt(result.model.calls[0])).toContain(RECENT);
    expect(result.context.sections.map(({ id }) => id)).toEqual([
      'current_thread',
      'recent_channel_history',
      'rolling_channel_summary',
      'channel_observations',
    ]);
  });

  it('CM-AC-08: supplies rolling summary and observations without semantic search', async () => {
    const provider = contextProvider({
      records: [],
      observations: {
        context: async () => ({ summary: SUMMARY, observations: OBSERVATION }),
      },
    });

    const result = await runAgent({
      alias: 'A',
      provider,
      question: 'Summarize current work and open observations.',
      answer: 'Derived context is available.',
    });

    expect(result.model.calls).toHaveLength(1);
    expect(result.toolExecutions).not.toHaveBeenCalled();
    const prompt = serializedPrompt(result.model.calls[0]);
    expect(prompt).toContain(SUMMARY);
    expect(prompt).toContain(OBSERVATION);
    expect(result.context.sections.slice(2).map(({ status }) => status))
      .toEqual(['available', 'available']);
  });

  it('CM-AC-09: executes scoped semantic fallback once and returns sender/date citation', async () => {
    const provider = contextProvider({ records: [], observations: emptyObservations() });
    const citation = oldCitation();

    const result = await runAgent({
      alias: 'A',
      provider,
      question: 'What was the older detail?',
      searchQuery: 'older detail',
      answer: `${OLD_A} — Synthetic Historical Sender, 2025-12-01.`,
      citations: [citation],
    });

    expect(result.model.calls).toHaveLength(2);
    expect(result.toolExecutions).toHaveBeenCalledOnce();
    expect(result.recall).toHaveBeenCalledOnce();
    expect(result.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: BOUNDARY.A,
        threadId: THREAD.A,
        vectorSearchString: 'older detail',
      }),
      new Set([BOUNDARY.A]),
    );
    expect(serializedPrompt(result.model.calls[0])).not.toContain(OLD_A);
    expect(serializedPrompt(result.model.calls[1])).toContain(OLD_A);
    expect(result.answer).toContain('Synthetic Historical Sender');
    expect(result.answer).toContain('2025-12-01');
  });

  it('CM-AC-10: the same query in another channel yields zero foreign evidence', async () => {
    const citation = { ...oldCitation(), text: FOREIGN_A };
    const channelA = await runAgent({
      alias: 'A',
      provider: contextProvider({ records: [], observations: emptyObservations() }),
      question: 'Find the old channel marker.',
      searchQuery: 'old channel marker',
      answer: 'Channel A evidence found.',
      citations: [citation],
    });
    const channelB = await runAgent({
      alias: 'B',
      provider: contextProvider({
        records: [historyRecord({
          alias: 'B',
          messageTs: '1767225601.000200',
          text: 'Synthetic local channel B marker.',
        })],
        observations: {
          context: async () => ({
            summary: 'Synthetic channel B summary.',
            observations: 'Synthetic channel B observations.',
          }),
        },
      }),
      question: 'Find the old channel marker.',
      searchQuery: 'old channel marker',
      answer: "I couldn't verify that from the available evidence.",
      citations: [citation],
    });

    expect(channelA.toolExecutions).toHaveBeenCalledOnce();
    expect(serializedPrompt(channelA.model.calls[1])).toContain(FOREIGN_A);
    expect(channelB.toolExecutions).toHaveBeenCalledOnce();
    expect(channelB.recall).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: BOUNDARY.B, threadId: THREAD.B }),
      new Set([BOUNDARY.B]),
    );
    expect(serializedPrompt(channelB.model.calls[0])).not.toContain(FOREIGN_A);
    expect(serializedPrompt(channelB.model.calls[1])).not.toContain(FOREIGN_A);
    expect(channelB.answer).not.toContain(FOREIGN_A);
  });

  it('CM-AC-11: observation failure leaves exact capture intact and falls back to history', async () => {
    const record = historyRecord({
      alias: 'A',
      messageTs: '1767225601.000100',
      text: RECENT,
    });
    const messages = [observationMessage(record)];
    const engine = new SyntheticObservationEngine();
    engine.failObserve = true;
    engine.failRead = true;
    const failure = vi.fn();
    const observations = observationMemory({ engine, messages: () => messages, failure });

    observations.enqueue(BOUNDARY.A, THREAD.A);
    await observations.settled();
    const provider = contextProvider({ records: [record], observations });
    const result = await runAgent({
      alias: 'A',
      provider,
      question: 'What is the recent work?',
      answer: 'History fallback is available.',
    });

    expect(messages).toHaveLength(1);
    expect(result.context.sections[1]).toMatchObject({ status: 'available', record_count: 1 });
    expect(result.context.sections.slice(2).map(({ status }) => status))
      .toEqual(['unavailable', 'unavailable']);
    expect(serializedPrompt(result.model.calls[0])).toContain(RECENT);
    expect(result.toolExecutions).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith({ operation: 'consolidate' });
  });

  it('refreshes edited wording in derived context without semantic fallback', async () => {
    const records = [historyRecord({
      alias: 'A',
      messageTs: '1767225601.000100',
      text: STALE,
    })];
    const messages = [observationMessage(records[0]!)];
    const engine = new SyntheticObservationEngine();
    engine.records.set(
      BOUNDARY.A,
      observationRecord(BOUNDARY.A, `## Channel summary\n${STALE}\n## Observations\n${STALE}`),
    );
    const observations = observationMemory({ engine, messages: () => messages });
    const storage: MutationStorage = {
      editMessage: async ({ messageKey, newText, editedAt }) => {
        const index = records.findIndex((record) => record.message_key === messageKey);
        if (index < 0) return 'edit_orphan_ignored';
        records[index] = {
          ...records[index]!,
          text: newText,
          edited_at: editedAt,
          token_count: newText.length,
        };
        messages[index] = observationMessage(records[index]!);
        return 'updated';
      },
      deleteMessages: async () => ({
        deleted: 0,
        embeddings_deleted: 0,
        tombstoned: [],
        missing: [],
      }),
      isTombstoned: async () => false,
      async *listMessageBatches() {},
      reconcileTombstones: async () => 0,
    };
    const mutations = new MutationHandler({
      storage,
      policy: authorization('A').policy,
      enrollment: {
        isEnrolled: () => true,
        captureFloorTs: () => '1767225600.000100',
      },
      derivedInvalidationSink: observations,
    });
    const event = {
      ...authorization('A').event,
      contract_version: '1.0.0' as const,
      class: 'mutation' as const,
      message_ts: '1767225610.000100',
      mutation: {
        kind: 'edit' as const,
        target_ts: records[0]!.message_ts,
        edited_at: '2026-01-01T00:10:00.000Z',
        new_text: EDITED,
      },
    };

    await expect(mutations.handle({ event, identity: authorization('A').identity }))
      .resolves.toMatchObject({ status: 'updated' });
    await observations.settled();
    const result = await runAgent({
      alias: 'A',
      provider: contextProvider({ records, observations }),
      question: 'What is the current wording?',
      answer: 'Edited context is available.',
    });

    expect(engine.cleared).toEqual([BOUNDARY.A]);
    expect(engine.observed).toHaveLength(1);
    expect(engine.observed[0]).toContain(EDITED);
    expect(engine.observed[0]).not.toContain(STALE);
    expect(serializedPrompt(result.model.calls[0])).toContain(EDITED);
    expect(serializedPrompt(result.model.calls[0])).not.toContain(STALE);
    expect(result.toolExecutions).not.toHaveBeenCalled();
  });
});
