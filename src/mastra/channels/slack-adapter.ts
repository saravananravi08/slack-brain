/**
 * Slack adapter factory — Socket Mode only.
 *
 * FR-SLK-011 requires Socket Mode and a continuously running service. The
 * Chat SDK adapter defaults to `mode: "webhook"`, so the mode is set
 * explicitly here and asserted by tests: a silent fall-back to webhook would
 * leave the service listening on an HTTP route that nothing calls, and the
 * failure would look like "Slack events stopped arriving".
 *
 * No Slack Bolt import appears anywhere in this module or its callers
 * (NFR-MNT-004, T104 implementation step 5).
 */

import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack';

import type { SlackChannelCredentials } from './types.js';

export class SlackCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackCredentialsError';
  }
}

/**
 * Validate credentials without logging or echoing them.
 *
 * Error messages name the *field*, never the value (FR-PRV-008). T102 owns
 * environment validation; this is the adapter refusing to construct in an
 * unusable state, which is the last line of defence against a partially
 * configured process starting up (FR-OPS-001).
 */
function assertCredentials(credentials: SlackChannelCredentials): void {
  const { botToken, appToken } = credentials;

  if (typeof botToken !== 'string' || botToken.trim() === '') {
    throw new SlackCredentialsError('Slack bot token is required and must be non-empty.');
  }
  if (typeof appToken !== 'string' || appToken.trim() === '') {
    throw new SlackCredentialsError(
      'Slack app-level token is required for Socket Mode and must be non-empty.',
    );
  }
}

/**
 * Build the Socket Mode Slack adapter.
 *
 * Credentials are passed explicitly rather than left to the adapter's env
 * auto-detection, so a misconfigured process fails at construction instead of
 * silently connecting with whatever happens to be in the environment
 * (FR-OPS-002 — no hardcoded or implicit defaults for production values).
 */
export function createGistSlackAdapter(credentials: SlackChannelCredentials): SlackAdapter {
  assertCredentials(credentials);

  return createSlackAdapter({
    mode: 'socket',
    botToken: credentials.botToken,
    appToken: credentials.appToken,
  });
}
