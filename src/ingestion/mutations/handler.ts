import { messageKey } from '../../mastra/memory/resource-policy.js';
import { AUTHORIZATION_CONTRACT_VERSION, withAuthorization } from '../../security/index.js';
import { classifyMutation, retentionMessageKeys } from './policy.js';
import type {
  CheckOriginalInput,
  HandleMutationInput,
  MutationHandlerOptions,
  MutationOutcome,
  OriginalSuppressionOutcome,
  RetentionPolicy,
  RetentionResult,
} from './types.js';

export class MutationHandler {
  readonly #storage: MutationHandlerOptions['storage'];
  readonly #policy: MutationHandlerOptions['policy'];

  constructor({ storage, policy }: MutationHandlerOptions) {
    this.#storage = storage;
    this.#policy = policy;
  }

  /** D005: authorization completes before the callback can touch storage. */
  async handle({ event, identity }: HandleMutationInput): Promise<MutationOutcome> {
    const mutation = classifyMutation(event);
    if (!mutation) return { status: 'malformed' };

    const outcome = await withAuthorization(
      {
        contract_version: AUTHORIZATION_CONTRACT_VERSION,
        gate: 'write_memory',
        event,
        identity,
        policy: this.#policy,
      },
      async () => {
        let key;
        try {
          key = messageKey({
            workspace_id: event.workspace_id,
            channel_id: event.channel_id,
            message_ts: mutation.target_ts,
          });
        } catch (error) {
          if (error instanceof TypeError) return { status: 'malformed' } as const;
          throw error;
        }

        if (mutation.kind === 'edit') {
          const status = await this.#storage.editMessage(
            key,
            mutation.new_text!,
            mutation.edited_at,
          );
          return { status, message_key: key } as const;
        }

        const result = await this.#storage.deleteMessages([key], mutation.edited_at);
        return {
          status: result.deleted > 0 ? 'deleted' : 'unchanged',
          message_key: key,
        } as const;
      },
    );

    if (!outcome.allowed) {
      return { status: 'denied', reason: outcome.decision.reason! };
    }
    return outcome.value;
  }

  /** T403/T405 call this before writing an original event delivered after deletion. */
  async shouldSuppressOriginal({
    event,
    identity,
  }: CheckOriginalInput): Promise<OriginalSuppressionOutcome> {
    const outcome = await withAuthorization(
      {
        contract_version: AUTHORIZATION_CONTRACT_VERSION,
        gate: 'write_memory',
        event,
        identity,
        policy: this.#policy,
      },
      async () => {
        try {
          const key = messageKey(event);
          return this.#storage.isTombstoned(identity.boundary_id, key);
        } catch (error) {
          if (error instanceof TypeError) return 'malformed' as const;
          throw error;
        }
      },
    );

    if (!outcome.allowed) {
      return { status: 'denied', reason: outcome.decision.reason! };
    }
    if (outcome.value === 'malformed') return { status: 'malformed' };
    return { status: 'allowed', suppressed: outcome.value };
  }

  /** D004 system sweep; policy input is the authority, not a Slack user event. */
  async sweepRetention(policy: RetentionPolicy): Promise<RetentionResult> {
    const messages = await this.#storage.listMessages();
    const keys = retentionMessageKeys(messages, policy);
    if (keys.length === 0) {
      return {
        examined: messages.length,
        deleted: 0,
        embeddings_deleted: 0,
        tombstoned: [],
        missing: [],
      };
    }

    const result = await this.#storage.deleteMessages(keys, policy.now);
    return { examined: messages.length, ...result };
  }
}
