import { describe, expect, it } from 'vitest';

import { AMBIENT_FIXTURES, SYNTHETIC } from './fixtures.js';
import { createAmbientE2EHarness, expectSilent } from './helpers.js';

describe('T406 ambient message E2E scaffold', () => {
  it('persists an approved ambient root with zero model calls and zero Slack posts', async () => {
    const harness = createAmbientE2EHarness();

    await harness.deliver(AMBIENT_FIXTURES.root);

    expect(harness.persist).toHaveBeenCalledOnce();
    expect(harness.persist.mock.calls[0]?.[0]).toMatchObject({
      event: {
        class: 'ambient',
        message_ts: SYNTHETIC.rootTs,
        thread_ts: null,
        addressed_to_gist: false,
      },
    });
    expectSilent(harness);
  });

  it('persists an unaddressed thread reply silently in the root thread boundary', async () => {
    const harness = createAmbientE2EHarness();

    await harness.deliver(AMBIENT_FIXTURES.reply);

    expect(harness.persist).toHaveBeenCalledOnce();
    expect(harness.persist.mock.calls[0]?.[0]).toMatchObject({
      event: {
        class: 'ambient',
        message_ts: SYNTHETIC.replyTs,
        thread_ts: SYNTHETIC.rootTs,
        addressed_to_gist: false,
      },
    });
    expectSilent(harness);
  });

  it('excludes bot traffic before persistence, mutation, generation, or posting', async () => {
    const harness = createAmbientE2EHarness();

    await harness.deliver(AMBIENT_FIXTURES.bot);

    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.handleMutation).not.toHaveBeenCalled();
    expect(harness.shouldSuppressOriginal).not.toHaveBeenCalled();
    expectSilent(harness);
  });

  it('denies an unapproved channel before persistence and content deduplication', async () => {
    const harness = createAmbientE2EHarness();

    await harness.deliver(AMBIENT_FIXTURES.unapprovedChannel);

    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.handleMutation).not.toHaveBeenCalled();
    expect(harness.shouldSuppressOriginal).not.toHaveBeenCalled();
    expect(await harness.state.get(
      `content:${SYNTHETIC.workspace}/C0UNAPPROV9/1735690001.000100`,
    )).toBeNull();
    expectSilent(harness);
  });
});
