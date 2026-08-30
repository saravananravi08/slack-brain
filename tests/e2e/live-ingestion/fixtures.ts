import {
  SYNTHETIC,
  channelMessage,
  envelope,
} from '../../spikes/slack-events/helpers.js';

export { SYNTHETIC };

export const AMBIENT_FIXTURES = {
  root: envelope(channelMessage({
    text: 'synthetic ambient root for T406',
  })),
  reply: envelope(channelMessage({
    ts: SYNTHETIC.replyTs,
    thread_ts: SYNTHETIC.rootTs,
    event_ts: SYNTHETIC.replyTs,
    text: 'synthetic ambient reply for T406',
  })),
  bot: envelope(channelMessage({
    user: undefined,
    bot_id: SYNTHETIC.otherBotId,
    username: 'Synthetic Bot',
    ts: '1735690000.000100',
    event_ts: '1735690000.000100',
    text: 'synthetic bot traffic for T406',
  })),
  unapprovedChannel: envelope(channelMessage({
    channel: 'C0UNAPPROV9',
    ts: '1735690001.000100',
    event_ts: '1735690001.000100',
    text: 'synthetic unapproved-channel traffic for T406',
  })),
} as const;
