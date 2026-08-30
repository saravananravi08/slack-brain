import {
  IDENTITY_CONTRACT_VERSION,
  messageKey as resolveMessageKey,
  resolveIdentity,
} from '../../mastra/memory/resource-policy.js';
import {
  AUTHORIZATION_CONTRACT_VERSION,
  authorize,
  type AuthorizationEvent,
  type PolicySnapshot,
  type ResourceIdentity,
} from '../../security/index.js';
import {
  ARCHIVE_IMPORT_CONTRACT_VERSION,
  type ArchiveImportContext,
  type ArchiveMappingFailure,
  type ArchiveMappingSkip,
  type ArchiveMappingWarning,
  type ArchiveMessageMapResult,
  type ArchiveMessageMapping,
  type ArchiveSourceMessage,
  type ImportWarning,
  type NormalizedArchiveMessage,
} from './types.js';

const SLACK_TIMESTAMP = /^([0-9]{10})\.([0-9]{1,6})$/;

const SYSTEM_SUBTYPES = new Set([
  'bot_add',
  'bot_remove',
  'channel_archive',
  'channel_convert_to_private',
  'channel_convert_to_public',
  'channel_join',
  'channel_leave',
  'channel_name',
  'channel_purpose',
  'channel_topic',
  'channel_unarchive',
  'ekm_access_denied',
  'group_archive',
  'group_join',
  'group_leave',
  'group_name',
  'group_purpose',
  'group_topic',
  'group_unarchive',
  'message_changed',
  'message_deleted',
  'pinned_item',
  'slackbot_response',
  'tombstone',
  'unpinned_item',
]);

interface ParsedTimestamp {
  readonly seconds: string;
  readonly fraction: string;
}

type RawJsonObject = Readonly<Record<string, unknown>>;

function parseTimestamp(value: string): ParsedTimestamp | null {
  const match = SLACK_TIMESTAMP.exec(value);
  if (match === null) return null;

  return {
    seconds: match[1] as string,
    fraction: match[2] as string,
  };
}

function toRfc3339(timestamp: ParsedTimestamp): string {
  const milliseconds = timestamp.fraction.padEnd(6, '0').slice(0, 3);
  const epochMilliseconds = Number(BigInt(timestamp.seconds) * 1000n)
    + Number(milliseconds);
  return new Date(epochMilliseconds).toISOString();
}

function asObject(value: unknown): RawJsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RawJsonObject
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasBotIndicator(raw: unknown): boolean {
  const object = asObject(raw);
  if (object === null) return false;

  return object.subtype === 'bot_message'
    || nonEmptyString(object.bot_id) !== null
    || nonEmptyString(object.app_id) !== null
    || object.bot_profile !== undefined && object.bot_profile !== null;
}

function hasFiles(raw: unknown): boolean {
  const files = asObject(raw)?.files;
  return Array.isArray(files) && files.length > 0;
}

function isSystemSubtype(raw: unknown): boolean {
  const subtype = asObject(raw)?.subtype;
  return typeof subtype === 'string' && SYSTEM_SUBTYPES.has(subtype);
}

function editTimestamp(raw: unknown): unknown {
  const object = asObject(raw);
  if (object === null || !Object.hasOwn(object, 'edited')) return null;
  return asObject(object.edited)?.ts;
}

function senderName(row: ArchiveSourceMessage): string | null {
  return nonEmptyString(row.user?.display_name)
    ?? nonEmptyString(row.user?.real_name)
    ?? nonEmptyString(row.user?.name)
    ?? nonEmptyString(row.user_name);
}

function canonicalPayload(record: NormalizedArchiveMessage): string {
  return JSON.stringify([
    record.contract_version,
    record.message_key,
    record.boundary_id,
    record.thread_id,
    record.conversation_type,
    record.sender_id,
    record.sender_name,
    record.sent_at,
    record.message_ts,
    record.text,
    record.edited_at,
    record.source,
  ]);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSourceResults<
  T extends { readonly source_ref: string; readonly reason: string },
>(left: T, right: T): number {
  return lexicalCompare(left.source_ref, right.source_ref)
    || lexicalCompare(left.reason, right.reason);
}

/** Numeric Slack timestamp ordering without parsing the timestamp as a float. */
export function compareArchiveMessageTimestamps(left: string, right: string): number {
  const leftTimestamp = parseTimestamp(left);
  const rightTimestamp = parseTimestamp(right);
  if (leftTimestamp === null || rightTimestamp === null) {
    throw new TypeError('Cannot compare invalid Slack timestamps');
  }

  const seconds = lexicalCompare(leftTimestamp.seconds, rightTimestamp.seconds);
  if (seconds !== 0) return seconds;

  const fraction = lexicalCompare(
    leftTimestamp.fraction.padEnd(6, '0'),
    rightTimestamp.fraction.padEnd(6, '0'),
  );
  return fraction || lexicalCompare(left, right);
}


/**
 * How import describes an archive author to the authorization guard.
 *
 * A Slack export carries no external, guest, or deactivated flag, and bots and
 * system subtypes are filtered before this point. D006's exclusions govern who
 * may *interact* with Gist; whether an external or guest author's historical
 * messages belong in the channel corpus is an open decision (design review
 * F-16). Rather than let that decision hide inside a literal, it is named
 * here: import treats archive authors as full members, and changing that means
 * changing this constant and its test.
 */
const ARCHIVE_SENDER_ATTRIBUTES = {
  sender_type: 'human',
  sender_is_external: false,
  sender_is_guest: false,
  sender_is_deactivated: false,
} as const satisfies Pick<
  AuthorizationEvent,
  'sender_type' | 'sender_is_external' | 'sender_is_guest' | 'sender_is_deactivated'
>;

/**
 * The import run's policy, in the shape the shared guard takes.
 *
 * D001 has exactly one implementation — `authorize()` — and this is how the
 * import context feeds it. `validateContext` has already checked the workspace
 * and channel ID shapes by the time a row reaches the mapper.
 */
function policyFor(context: ArchiveImportContext): PolicySnapshot {
  return {
    approved_workspace_id: context.workspace_id,
    approved_channel_ids: context.approved_channel_ids,
    user_allowlist: [],
    dm_shared_knowledge: false,
  };
}

function authorizationEventFor(
  row: ArchiveSourceMessage,
  context: ArchiveImportContext,
  senderId: string,
): AuthorizationEvent {
  return {
    workspace_id: context.workspace_id,
    channel_id: row.channel_id,
    conversation_type: 'channel',
    sender_id: senderId,
    ...ARCHIVE_SENDER_ATTRIBUTES,
  };
}

function identityFor(
  row: ArchiveSourceMessage,
  context: ArchiveImportContext,
  senderId: string,
  rootTimestamp: string,
): ResourceIdentity | null {
  try {
    return resolveIdentity({
      contract_version: IDENTITY_CONTRACT_VERSION,
      workspace_id: context.workspace_id,
      channel_id: row.channel_id,
      conversation_type: 'channel',
      message_ts: row.ts,
      thread_ts: rootTimestamp === row.ts ? null : rootTimestamp,
      sender_id: senderId,
    });
  } catch {
    return null;
  }
}

/**
 * Run the D001 gate through the shared guard.
 *
 * Returns `null` when the row is authorized, a deny reason when it is not, and
 * `'unresolved'` when an identity could not be built — in which case the
 * caller continues to its own field validation, which reports the precise
 * reason the row is malformed.
 */
function archiveDenyReason(
  row: ArchiveSourceMessage,
  context: ArchiveImportContext,
): 'unapproved_channel' | 'unresolved' | null {
  const senderId = nonEmptyString(row.user_id) ?? nonEmptyString(row.user_name);
  if (senderId === null) return 'unresolved';

  const rootTimestamp = nonEmptyString(row.thread_ts) ?? row.ts;
  const identity = identityFor(row, context, senderId, rootTimestamp);
  if (identity === null) {
    // The guard cannot judge a row whose identity will not resolve. Fall back
    // to the plain allowlist question so an unapproved channel is still
    // reported as such rather than as a malformed row.
    return context.approved_channel_ids.includes(row.channel_id) ? 'unresolved' : 'unapproved_channel';
  }

  const decision = authorize({
    contract_version: AUTHORIZATION_CONTRACT_VERSION,
    gate: 'write_memory',
    event: authorizationEventFor(row, context, senderId),
    identity,
    policy: policyFor(context),
  });

  return decision.allowed ? null : 'unapproved_channel';
}

/** Map one validated source row. Classification order matches archive-import.md §6. */
export function mapArchiveMessage(
  row: ArchiveSourceMessage,
  context: ArchiveImportContext,
): ArchiveMessageMapResult {
  // D001 through the shared guard, so the allowlist has one implementation
  // (design review F-06). Every deny this gate can produce for an import row
  // maps to `unapproved_channel`: the workspace, sender, and allowlist inputs
  // are fixed by the import context, so the channel is the only variable.
  if (archiveDenyReason(row, context) === 'unapproved_channel') {
    return {
      outcome: 'skip',
      source_ref: row.source_ref,
      reason: 'unapproved_channel',
    };
  }

  let raw: unknown = null;
  if (row.raw_json !== null) {
    try {
      raw = JSON.parse(row.raw_json) as unknown;
    } catch {
      return {
        outcome: 'failure',
        source_ref: row.source_ref,
        reason: 'malformed_raw_json',
      };
    }
  }

  const normalizedSenderId = nonEmptyString(row.user_id);
  if (
    hasBotIndicator(raw)
    || normalizedSenderId !== null
      && context.known_bot_sender_ids.includes(normalizedSenderId)
  ) {
    return {
      outcome: 'skip',
      source_ref: row.source_ref,
      reason: 'bot_message',
    };
  }

  if (isSystemSubtype(raw)) {
    return {
      outcome: 'skip',
      source_ref: row.source_ref,
      reason: 'system_subtype',
    };
  }

  if (row.text.trim().length === 0) {
    return {
      outcome: 'skip',
      source_ref: row.source_ref,
      reason: hasFiles(raw) ? 'file_only' : 'empty_text',
    };
  }

  const normalizedSenderName = senderName(row);
  if (normalizedSenderId === null || normalizedSenderName === null) {
    return {
      outcome: 'skip',
      source_ref: row.source_ref,
      reason: 'missing_sender',
    };
  }

  const timestamp = parseTimestamp(row.ts);
  if (timestamp === null) {
    return {
      outcome: 'failure',
      source_ref: row.source_ref,
      reason: 'invalid_timestamp',
    };
  }

  let rootTimestamp = row.ts;
  if (row.thread_ts !== null && row.thread_ts !== row.ts) {
    if (parseTimestamp(row.thread_ts) === null) {
      return {
        outcome: 'failure',
        source_ref: row.source_ref,
        reason: 'invalid_thread_timestamp',
      };
    }
    rootTimestamp = row.thread_ts;
  }

  const rawEditTimestamp = editTimestamp(raw);
  let editedAt: string | null = null;
  if (rawEditTimestamp !== null) {
    if (typeof rawEditTimestamp !== 'string') {
      return {
        outcome: 'failure',
        source_ref: row.source_ref,
        reason: 'invalid_edit_timestamp',
      };
    }
    const parsedEditTimestamp = parseTimestamp(rawEditTimestamp);
    if (parsedEditTimestamp === null) {
      return {
        outcome: 'failure',
        source_ref: row.source_ref,
        reason: 'invalid_edit_timestamp',
      };
    }
    editedAt = toRfc3339(parsedEditTimestamp);
  }

  const sentAt = toRfc3339(timestamp);
  // identity.md §4 — composed by `resource-policy.ts` and nowhere else, so the
  // import path gains the same ID-shape validation the live path has and a
  // dropped prefix stops being expressible here (design review F-06).
  const identity = identityFor(row, context, normalizedSenderId, rootTimestamp);
  if (identity === null) {
    return {
      outcome: 'failure',
      source_ref: row.source_ref,
      reason: 'invalid_identity',
    };
  }
  const messageKey = resolveMessageKey({
    workspace_id: context.workspace_id,
    channel_id: row.channel_id,
    message_ts: row.ts,
  });
  const record: NormalizedArchiveMessage = {
    contract_version: ARCHIVE_IMPORT_CONTRACT_VERSION,
    delivery_key: `import:${context.import_run_id}:${messageKey}`,
    message_key: messageKey,
    boundary_id: identity.boundary_id as NormalizedArchiveMessage['boundary_id'],
    thread_id: identity.thread_id,
    conversation_type: 'channel',
    sender_id: normalizedSenderId,
    sender_name: normalizedSenderName,
    sent_at: sentAt,
    message_ts: row.ts,
    text: row.text,
    edited_at: editedAt,
    source: 'import',
  };

  const warnings: ImportWarning[] = [];
  if (row.date !== sentAt.slice(0, 10)) warnings.push('legacy_date_mismatch');
  if (row.user === null && nonEmptyString(row.user_name) !== null) {
    warnings.push('user_cache_miss_fallback');
  }

  return {
    outcome: 'write',
    source_ref: row.source_ref,
    record,
    warnings,
  };
}

/** Map and deduplicate one complete candidate set without I/O or ambient state. */
export function mapArchiveMessages(
  rows: readonly ArchiveSourceMessage[],
  context: ArchiveImportContext,
): ArchiveMessageMapping {
  const skipped: ArchiveMappingSkip[] = [];
  const failures: ArchiveMappingFailure[] = [];
  const warnings: ArchiveMappingWarning[] = [];
  const candidates = new Map<string, Extract<ArchiveMessageMapResult, { outcome: 'write' }>[]>();

  for (const row of rows) {
    const result = mapArchiveMessage(row, context);
    if (result.outcome === 'skip') {
      skipped.push({ source_ref: result.source_ref, reason: result.reason });
      continue;
    }
    if (result.outcome === 'failure') {
      failures.push({ source_ref: result.source_ref, reason: result.reason });
      continue;
    }

    for (const warning of result.warnings) {
      warnings.push({ source_ref: result.source_ref, reason: warning });
    }
    const group = candidates.get(result.record.message_key) ?? [];
    group.push(result);
    candidates.set(result.record.message_key, group);
  }

  const records: NormalizedArchiveMessage[] = [];
  for (const group of candidates.values()) {
    group.sort((left, right) => lexicalCompare(left.source_ref, right.source_ref));
    const payloads = new Set(group.map(({ record }) => canonicalPayload(record)));

    if (payloads.size > 1) {
      for (const candidate of group) {
        failures.push({
          source_ref: candidate.source_ref,
          reason: 'duplicate_conflict',
        });
      }
      continue;
    }

    const canonical = group[0];
    if (canonical === undefined) continue;
    records.push(canonical.record);
    for (const duplicate of group.slice(1)) {
      skipped.push({
        source_ref: duplicate.source_ref,
        reason: 'duplicate_exact',
      });
    }
  }

  records.sort((left, right) =>
    compareArchiveMessageTimestamps(left.message_ts, right.message_ts)
      || lexicalCompare(left.message_key, right.message_key),
  );
  skipped.sort(compareSourceResults);
  failures.sort(compareSourceResults);
  warnings.sort(compareSourceResults);

  return { records, skipped, failures, warnings };
}
