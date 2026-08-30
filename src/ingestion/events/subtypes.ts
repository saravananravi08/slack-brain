/**
 * Slack message subtypes the normalizer must recognise.
 *
 * The pinned adapter already drops most of these before the handler sees them
 * (T401 §3), but the normalizer is a total function over raw events — archive
 * import (T303) and any future transport feed it directly — so it classifies
 * them independently rather than trusting an upstream filter.
 */

/** Subtypes that are channel lifecycle noise, never message content. */
export const SYSTEM_SUBTYPES: ReadonlySet<string> = Object.freeze(
  new Set([
    'channel_join',
    'channel_leave',
    'channel_topic',
    'channel_purpose',
    'channel_name',
    'channel_archive',
    'channel_unarchive',
    'group_join',
    'group_leave',
    'group_topic',
    'group_purpose',
    'group_name',
    'group_archive',
    'group_unarchive',
    'ekm_access_denied',
    'tombstone',
    'message_replied',
    'pinned_item',
    'unpinned_item',
    'channel_convert_to_private',
    'channel_convert_to_public',
    'reminder_add',
    'bot_add',
    'bot_remove',
  ]),
);

/** Subtypes that carry a message from a non-human sender. */
export const BOT_SUBTYPES: ReadonlySet<string> = Object.freeze(
  new Set(['bot_message', 'app_message']),
);

export const EDIT_SUBTYPE = 'message_changed';
export const DELETE_SUBTYPE = 'message_deleted';

/**
 * Subtypes that carry real human text and must normalize like an ordinary
 * message.
 *
 * They are listed explicitly, and asserted by test, because the failure mode
 * is silent: adding one of these to `SYSTEM_SUBTYPES` would drop content a
 * person actually wrote, and nothing downstream would report a gap.
 * `thread_broadcast` in particular looks like lifecycle noise and is not — it
 * is a threaded reply the author also sent to the channel.
 */
export const CONTENT_BEARING_SUBTYPES: ReadonlySet<string> = Object.freeze(
  new Set(['file_share', 'me_message', 'thread_broadcast']),
);
