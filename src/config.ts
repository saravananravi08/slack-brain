import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const slackBotCredential = z.string().trim().regex(/^xoxb-[A-Za-z0-9-]{8,}$/);
const slackAppCredential = z.string().trim().regex(/^xapp-[A-Za-z0-9-]{8,}$/);
const workspaceId = z.string().trim().regex(/^T[A-Z0-9]{8,}$/);
const channelId = z.string().trim().regex(/^[CG][A-Z0-9]{8,}$/);
const userId = z.string().trim().regex(/^[UW][A-Z0-9]{8,}$/);
const botId = z.string().trim().regex(/^B[A-Z0-9]{8,}$/);
const appId = z.string().trim().regex(/^A[A-Z0-9]{8,}$/);
const requiredCredential = z.string().trim().regex(/^[^\s<>]{8,}$/);

function commaSeparatedIds(idSchema: z.ZodString, allowEmpty: boolean) {
  return z.string().trim().transform((value, context) => {
    if (allowEmpty && value === '') return [];

    const ids = value.split(',').map((id) => id.trim());
    const result = z.array(idSchema).min(1).safeParse(ids);
    if (!result.success || new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Invalid identifier list' });
      return z.NEVER;
    }
    return result.data;
  });
}

const databaseUrl = z.string().trim().refine((value) => {
  if (!value.startsWith('file:/')) return false;
  try {
    return fileURLToPath(value).startsWith('/');
  } catch {
    return false;
  }
});

const environmentSchema = z.object({
  SLACK_BOT_TOKEN: slackBotCredential,
  SLACK_APP_TOKEN: slackAppCredential,
  GIST_APPROVED_WORKSPACE_ID: workspaceId,
  // D013: optional deny-only migration list; membership is the channel grant.
  GIST_APPROVED_CHANNEL_IDS: commaSeparatedIds(channelId, true).default([]),
  // D022: empty means every enrolled channel; non-empty restricts to this list.
  GIST_PROACTIVE_CHANNELS: commaSeparatedIds(channelId, true).default([]),
  GIST_PROACTIVE_COOLDOWN_MS: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
    .default(60_000),
  GIST_USER_ALLOWLIST: commaSeparatedIds(userId, true).default([]),
  GIST_KILO_BOT_ID: botId.optional(),
  GIST_KILO_APP_ID: appId.optional(),
  GIST_DM_SHARED_KNOWLEDGE: z.literal('false').default('false').transform(() => false as const),
  GIST_MODEL: z.enum(['gpt-4.1', 'gpt-4.1-mini']).default('gpt-4.1'),
  EMBEDDING_MODEL: z.literal('openai/text-embedding-3-small'),
  OPENAI_API_KEY: requiredCredential,
  MASTRA_DATABASE_URL: databaseUrl,
});

export interface Config {
  readonly slackBotToken: string;
  readonly slackAppToken: string;
  readonly approvedWorkspaceId: string;
  readonly approvedChannelIds: readonly string[];
  /** D022 restriction list. Empty enables proactive mode for every enrolled channel. */
  readonly proactiveChannelIds?: readonly string[];
  /** D021 per-channel action cooldown. Optional values use the accepted 60s default. */
  readonly proactiveCooldownMs?: number;
  readonly userAllowlist: readonly string[];
  readonly kiloBotId?: string;
  readonly kiloAppId?: string;
  readonly dmSharedKnowledge: false;
  readonly gistModel: 'gpt-4.1' | 'gpt-4.1-mini';
  readonly embeddingModel: 'openai/text-embedding-3-small';
  readonly embeddingDimensions: 1536;
  readonly openaiApiKey: string;
  readonly databaseUrl: string;
  readonly dmRetentionDays: 90;
  readonly traceRetentionDays: 30;
  readonly appLogRetentionDays: 14;
  readonly backupRetentionDays: 35;
  readonly unapprovedChannelPurgeDays: 30;
}

export class ConfigError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Invalid configuration: ${variables.join(', ')}`);
    this.name = 'ConfigError';
    this.variables = Object.freeze([...variables]);
  }
}

export function parseConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Config> {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? 'environment')),
      ),
    ].sort();
    throw new ConfigError(variables);
  }

  const env = result.data;
  return Object.freeze({
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackAppToken: env.SLACK_APP_TOKEN,
    approvedWorkspaceId: env.GIST_APPROVED_WORKSPACE_ID,
    approvedChannelIds: Object.freeze([...env.GIST_APPROVED_CHANNEL_IDS]),
    proactiveChannelIds: Object.freeze([...env.GIST_PROACTIVE_CHANNELS]),
    proactiveCooldownMs: env.GIST_PROACTIVE_COOLDOWN_MS,
    userAllowlist: Object.freeze([...env.GIST_USER_ALLOWLIST]),
    ...(env.GIST_KILO_BOT_ID === undefined ? {} : { kiloBotId: env.GIST_KILO_BOT_ID }),
    ...(env.GIST_KILO_APP_ID === undefined ? {} : { kiloAppId: env.GIST_KILO_APP_ID }),
    dmSharedKnowledge: env.GIST_DM_SHARED_KNOWLEDGE,
    gistModel: env.GIST_MODEL,
    embeddingModel: env.EMBEDDING_MODEL,
    embeddingDimensions: 1536,
    openaiApiKey: env.OPENAI_API_KEY,
    databaseUrl: env.MASTRA_DATABASE_URL,
    dmRetentionDays: 90,
    traceRetentionDays: 30,
    appLogRetentionDays: 14,
    backupRetentionDays: 35,
    unapprovedChannelPurgeDays: 30,
  });
}
