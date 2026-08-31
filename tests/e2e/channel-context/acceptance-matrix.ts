export const CHANNEL_CONTEXT_ACCEPTANCE_IDS = [
  'CM-AC-08',
  'CM-AC-09',
  'CM-AC-10',
  'CM-AC-11',
] as const;

export type ChannelContextAcceptanceId = typeof CHANNEL_CONTEXT_ACCEPTANCE_IDS[number];

export const CHANNEL_CONTEXT_ACCEPTANCE_MATRIX: Readonly<Record<
  ChannelContextAcceptanceId,
  {
    readonly offlineEvidence: readonly string[];
    readonly liveEvidence: readonly string[];
  }
>> = {
  'CM-AC-08': {
    offlineEvidence: [
      'recent history answer',
      'rolling summary answer',
      'observation answer',
      'semantic tool executions = 0',
    ],
    liveEvidence: [
      'recent answer tool delta = 0',
      'derived context sections available',
    ],
  },
  'CM-AC-09': {
    offlineEvidence: [
      'semantic tool executions = 1',
      'resource-scoped recall',
      'sender/date citation',
    ],
    liveEvidence: [
      'old-detail tool delta = 1',
      'citation present',
    ],
  },
  'CM-AC-10': {
    offlineEvidence: [
      'foreign default evidence = 0',
      'foreign semantic evidence = 0',
      'foreign answer evidence = 0',
    ],
    liveEvidence: [
      'A evidence under B scope = 0',
      'B evidence under A scope = 0',
    ],
  },
  'CM-AC-11': {
    offlineEvidence: [
      'observation failures = 1',
      'exact records retained = 1',
      'history fallback tool executions = 0',
    ],
    liveEvidence: [
      'observation failure injected',
      'capture delta = 1',
      'history answer succeeds',
    ],
  },
};
