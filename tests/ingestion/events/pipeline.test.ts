/**
 * The normalizer's fit with the modules either side of it, and its hygiene.
 *
 * T405 composes: raw Slack event → `normalize` → `authorize` (T203) →
 * `deduplicate` → persist (T403) / mutate (T404). These tests check that a
 * `NormalizedEvent` is directly usable by the merged identity resolver and
 * authorization guard, so the seam is proven here rather than discovered at
 * integration; and that this module has no side effects of its own.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  createInMemoryLedger,
  deduplicate,
  isSkip,
  normalize,
} from '../../../src/ingestion/events/index.js';
import type { NormalizedEvent } from '../../../src/ingestion/events/index.js';
import { authorize } from '../../../src/security/index.js';
import type { PolicySnapshot } from '../../../src/security/types.js';
import { messageKey, resolveIdentity } from '../../../src/mastra/memory/resource-policy.js';
import {
  FULL_MEMBER,
  SYNTHETIC,
  channelMessage,
  directMessage,
  envelope,
  makeContext,
} from './helpers.js';

const POLICY: PolicySnapshot = {
  approved_workspace_id: SYNTHETIC.workspace,
  approved_channel_ids: [SYNTHETIC.channel],
  user_allowlist: [],
  dm_shared_knowledge: false,
};

function normalized(
  raw: Record<string, unknown>,
  context = makeContext(),
): NormalizedEvent {
  const result = normalize(envelope(raw), context);
  if (isSkip(result)) throw new Error(`expected an event, got skip:${result.skip}`);
  return result;
}

describe('a normalized event is what the guard and the resolver expect', () => {
  it('authorizes an ambient channel message for storage', () => {
    const event = normalized(channelMessage());
    const decision = authorize({
      contract_version: '1.0.0',
      gate: 'write_memory',
      event,
      identity: resolveIdentity(event),
      policy: POLICY,
    });

    expect(decision).toMatchObject({ allowed: true, reason: null });
  });

  it('carries the deactivated flag the guard requires', () => {
    // The field slack-event.md §2 does not have. Without it the guard cannot
    // apply D006 rule 5, and an optional field would default to the fail-open
    // value.
    const event = normalized(
      channelMessage(),
      makeContext({ sender_attributes: { ...FULL_MEMBER, is_deactivated: true } }),
    );
    const decision = authorize({
      contract_version: '1.0.0',
      gate: 'write_memory',
      event,
      identity: resolveIdentity(event),
      policy: POLICY,
    });

    expect(decision).toMatchObject({ allowed: false, reason: 'deactivated_user' });
  });

  it('lets the guard deny an external sender it normalized faithfully', () => {
    const event = normalized(
      channelMessage(),
      makeContext({ sender_attributes: { ...FULL_MEMBER, is_external: true } }),
    );

    expect(event.sender_is_external).toBe(true);
    expect(
      authorize({
        contract_version: '1.0.0',
        gate: 'accept_event',
        event,
        identity: resolveIdentity(event),
        policy: POLICY,
      }),
    ).toMatchObject({ allowed: false, reason: 'external_user' });
  });

  it('lets the guard deny an unapproved channel the normalizer accepted', () => {
    const event = normalized(channelMessage({ channel: 'C0UNAPPROV9' }));
    expect(
      authorize({
        contract_version: '1.0.0',
        gate: 'accept_event',
        event,
        identity: resolveIdentity(event),
        policy: POLICY,
      }),
    ).toMatchObject({ allowed: false, reason: 'unapproved_channel' });
  });

  it('resolves a DM to the sender private boundary', () => {
    const event = normalized(directMessage());
    const identity = resolveIdentity(event);

    expect(identity.boundary_id).toBe(`dm:${SYNTHETIC.workspace}:${SYNTHETIC.user}`);
    expect(identity.conversation_type).toBe('dm');
  });

  it('resolves both root encodings to one thread', () => {
    const absent = resolveIdentity(normalized(channelMessage({ ts: SYNTHETIC.rootTs })));
    const selfReferential = resolveIdentity(
      normalized(channelMessage({ ts: SYNTHETIC.rootTs, thread_ts: SYNTHETIC.rootTs })),
    );

    expect(absent.thread_id).toBe(selfReferential.thread_id);
  });

  it('produces a content key the identity contract also produces', () => {
    const event = normalized(channelMessage());
    expect(messageKey(event)).toBe(
      `${SYNTHETIC.workspace}/${SYNTHETIC.channel}/${SYNTHETIC.ambientTs}`,
    );
  });

  it('runs the whole ambient path without a reply or a model call', async () => {
    const ledger = createInMemoryLedger();
    const event = normalized(channelMessage());

    const decision = authorize({
      contract_version: '1.0.0',
      gate: 'write_memory',
      event,
      identity: resolveIdentity(event),
      policy: POLICY,
    });
    const dedupe = await deduplicate(event, ledger);

    expect(event.class).toBe('ambient');
    expect(decision.allowed).toBe(true);
    expect(dedupe.skip).toBeNull();
    // INV-6 — nothing on this path generates or replies.
    expect(event.addressed_to_gist).toBe(false);
  });
});

describe('no side effects (T402 acceptance)', () => {
  it('makes no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ledger = createInMemoryLedger();

    const event = normalized(channelMessage());
    await deduplicate(event, ledger);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not read the wall clock', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    normalized(channelMessage());
    expect(nowSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});

describe('module hygiene', () => {
  const directory = fileURLToPath(new URL('../../../src/ingestion/events/', import.meta.url));

  /**
   * Strip comments before scanning.
   *
   * These checks are about what the code *does*. A doc comment that names
   * `Date.now()` in order to say the module never calls it would otherwise
   * fail the very check it is documenting.
   */
  function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  const sources = readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: code(readFileSync(`${directory}${name}`, 'utf8')) }));

  it('has sources to inspect', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('reads no environment variable', () => {
    for (const source of sources) {
      expect(`${source.name}: ${source.text}`).not.toContain('process.env');
    }
  });

  it('imports no Slack SDK and no transport code', () => {
    // Slack SDK types stop at the channel adapter (slack-event.md preamble).
    // Everything here speaks plain objects, which is what lets the ingestion
    // path be tested without a socket.
    for (const source of sources) {
      const labelled = `${source.name}: ${source.text}`;
      expect(labelled).not.toContain("from '@slack/");
      expect(labelled).not.toContain("from '@chat-adapter/");
      expect(labelled).not.toContain("from 'chat'");
      expect(labelled).not.toContain('mastra/channels');
    }
  });

  it('performs no file or network I/O', () => {
    for (const source of sources) {
      const labelled = `${source.name}: ${source.text}`;
      for (const forbidden of ['node:fs', 'node:http', 'fetch(', 'Date.now()', 'new Date()']) {
        expect(labelled).not.toContain(forbidden);
      }
    }
  });

  it('builds identity keys only through the identity contract', () => {
    // identity.md §4 — composing a key by hand outside resource-policy.ts is
    // how a prefix gets dropped. This module imports the functions instead.
    for (const source of sources) {
      if (source.name === 'dedupe.ts') continue;
      expect(`${source.name}: ${source.text}`).not.toContain('messageKey(');
    }
    const dedupe = sources.find((source) => source.name === 'dedupe.ts');
    expect(dedupe?.text).toContain("from '../../mastra/memory/resource-policy.js'");
  });
});
