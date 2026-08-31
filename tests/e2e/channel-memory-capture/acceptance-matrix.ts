export const CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_IDS = [
  'CM-AC-01',
  'CM-AC-02',
  'CM-AC-03',
  'CM-AC-04',
  'CM-AC-05',
  'CM-AC-06',
  'CM-AC-07',
  'CM-AC-12',
] as const;

export type ChannelMemoryCaptureAcceptanceId =
  typeof CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_IDS[number];

export const CHANNEL_MEMORY_CAPTURE_ACCEPTANCE_MATRIX: Readonly<Record<
  ChannelMemoryCaptureAcceptanceId,
  {
    readonly offlineEvidence: readonly string[];
    readonly liveEvidence: readonly string[];
  }
>> = {
  'CM-AC-01': {
    offlineEvidence: ['two enrollments', 'distinct boundaries', 'restart continuity'],
    liveEvidence: ['two confirmed memberships', 'zero cross-channel records'],
  },
  'CM-AC-02': {
    offlineEvidence: ['human root once', 'human reply once', 'zero capture replies'],
    liveEvidence: ['root count', 'reply count', 'zero unsolicited replies'],
  },
  'CM-AC-03': {
    offlineEvidence: ['Kilo once', 'other app once', 'zero generation', 'zero posts'],
    liveEvidence: ['Kilo count', 'app count', 'zero bot-triggered activity'],
  },
  'CM-AC-04': {
    offlineEvidence: ['outgoing_self once', 'Slack echo convergence'],
    liveEvidence: ['one response', 'one stored Gist record'],
  },
  'CM-AC-05': {
    offlineEvidence: ['delivery retry dedup', 'content convergence', 'dedup after restart'],
    liveEvidence: ['retry count', 'one canonical record', 'one response maximum'],
  },
  'CM-AC-06': {
    offlineEvidence: ['same row identity', 'text replacement', 'vector replacement'],
    liveEvidence: ['one edited row', 'old vector absent', 'new vector present'],
  },
  'CM-AC-07': {
    offlineEvidence: ['row unchanged', 'vector unchanged', 'no tombstone'],
    liveEvidence: ['retained row count', 'retained vector count', 'accepted risk acknowledged'],
  },
  'CM-AC-12': {
    offlineEvidence: ['leave stops capture', 'stored state retained', 'other channel continues'],
    liveEvidence: ['left-channel delta zero', 'retained count unchanged', 'joined-channel delta one'],
  },
};
