/**
 * Slack Brain Bot
 *
 * Listens for @mentions and DMs via Socket Mode.
 * Message ingestion is handled separately by cron.ts.
 *
 * Usage:
 *   npx tsx bot.ts
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN   - xoxb-...
 *   SLACK_APP_TOKEN   - xapp-... (Socket Mode)
 */

import App from "@slack/bolt";
import { upsertDocument, upsertUser, getUserName, getDb, closeDb } from "./db.js";
import { askClaude } from "./agent.js";
import { downloadSlackFile, saveFileForClaude } from "./files.js";
import { startProactiveLoop, addReaction, onNewMessage } from "./proactive.js";

// --- Markdown → Slack mrkdwn conversion ---

function toSlackMrkdwn(text: string): string {
  return text
    // **bold** → *bold*  (must come before single * handling)
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    // __bold__ → *bold*
    .replace(/__(.+?)__/g, "*$1*")
    // [text](url) → <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    // ### heading → *heading*
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    // ``` code blocks — Slack supports these natively, leave as-is
    // `inline code` — Slack supports natively, leave as-is
    // ~strikethrough~ — Slack supports natively, leave as-is
    ;
}

// --- Config ---

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const APP_TOKEN = process.env.SLACK_APP_TOKEN;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C02J3DNC75Z";
const MODEL = process.env.CLAUDE_MODEL || "opus";

if (!BOT_TOKEN || !APP_TOKEN) {
  console.error("Required env vars: SLACK_BOT_TOKEN, SLACK_APP_TOKEN");
  process.exit(1);
}

// --- Per-user session tracking ---

const sessions = new Map<string, { sessionId: string; lastUsed: number }>();

function getSession(userId: string): string | undefined {
  const s = sessions.get(userId);
  if (!s) return undefined;
  // Expire sessions after 1 hour
  if (Date.now() - s.lastUsed > 60 * 60 * 1000) {
    sessions.delete(userId);
    return undefined;
  }
  return s.sessionId;
}

function setSession(userId: string, sessionId: string) {
  sessions.set(userId, { sessionId, lastUsed: Date.now() });
}

// --- User resolution ---

const userCache = new Map<string, string>();

async function resolveUserName(
  client: any,
  userId: string
): Promise<string> {
  const cached = userCache.get(userId);
  if (cached) return cached;

  const dbName = getUserName(userId);
  if (dbName) {
    userCache.set(userId, dbName);
    return dbName;
  }

  try {
    const result = await client.users.info({ user: userId });
    const u = result.user;
    const name =
      u.profile?.display_name || u.profile?.real_name || u.name || userId;
    upsertUser(userId, u.name, u.profile?.real_name, u.profile?.display_name);
    userCache.set(userId, name);
    return name;
  } catch {
    userCache.set(userId, userId);
    return userId;
  }
}

// --- Thread context helper ---

async function fetchThreadMessages(
  client: any,
  channelId: string,
  threadTs: string
): Promise<string> {
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
    });

    const messages: string[] = [];

    for (const msg of result.messages as any[]) {
      // Skip join/leave messages
      if (msg.subtype === "channel_join" || msg.subtype === "thread_broadcast") continue;
      if (!msg.text?.trim() && !msg.files?.length) continue;

      const cleaned = (msg.text || "")
        .replace(/<@[A-Z0-9]+>/g, "") // strip @mentions
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1") // #channel references
        .replace(/<!channel>|<!group>|<!here>/g, "@channel")
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&")
        .trim();

      if (msg.user === botUserId) {
        // Bot's own messages — label as Gist
        if (cleaned) messages.push(`[Gist]: ${cleaned}`);
      } else if (cleaned) {
        const name = await resolveUserName(client, msg.user);
        messages.push(`[${name}]: ${cleaned}`);
      }
    }

    return messages.join("\n");
  } catch (err) {
    console.error("[thread] Failed to fetch thread messages:", (err as Error).message);
    return "";
  }
}

// --- Bot setup ---

const app = new App.default({
  token: BOT_TOKEN,
  appToken: APP_TOKEN,
  socketMode: true,
});

let botUserId: string | undefined;

// --- Poll confirmation tracking ---
// Store the confirmation text + session for poll flow
// userId → { threadTs, confirmationText, sessionId }
const pendingPollThreads = new Map<string, { threadTs: string; confirmationText: string; sessionId: string }>();

// --- Poll system ---

interface PollState {
  question: string;
  options: string[];
  votes: Map<number, Set<string>>; // optionIndex → set of userIds
}

const pollVotes = new Map<string, PollState>(); // pollId → state

function buildPollBlocks(pollId: string, question: string, options: string[], votes: Map<number, Set<string>>) {
  const totalVotes = Array.from(votes.values()).reduce((sum, s) => sum + s.size, 0);

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `:bar_chart: *${question}*` },
    },
    { type: "divider" },
  ];

  // Each option as a section with a button
  const buttons = options.map((opt, i) => {
    const count = votes.get(i)?.size || 0;
    return {
      type: "button",
      text: { type: "plain_text", text: count > 0 ? `${opt}  (${count})` : opt, emoji: true },
      value: JSON.stringify({ pollId, optionIndex: i }),
      action_id: `poll_vote_${i}`,
    };
  });

  blocks.push({
    type: "actions",
    block_id: `poll_${pollId}`,
    elements: buttons,
  });

  if (totalVotes > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `${totalVotes} vote${totalVotes === 1 ? "" : "s"} so far` }],
    });
  }

  return blocks;
}

async function postPoll(client: any, channel: string, question: string, options: string[], threadTs?: string) {
  const pollId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const votes = new Map<number, Set<string>>();
  options.forEach((_, i) => votes.set(i, new Set()));

  pollVotes.set(pollId, { question, options, votes });

  const blocks = buildPollBlocks(pollId, question, options, votes);

  await client.chat.postMessage({
    channel,
    text: `Poll: ${question}`,
    blocks,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });

  console.log(`[poll] Created poll "${question}" with ${options.length} options (id: ${pollId})`);
}

// Register poll vote handlers (one per possible option index, max 10)
function registerPollHandlers(boltApp: any) {
  for (let i = 0; i < 10; i++) {
    boltApp.action(`poll_vote_${i}`, async ({ ack, body, client }: any) => {
      await ack();

      const action = body.actions?.[0];
      if (!action?.value) return;

      let parsed: { pollId: string; optionIndex: number };
      try {
        parsed = JSON.parse(action.value);
      } catch {
        return;
      }

      const poll = pollVotes.get(parsed.pollId);
      if (!poll) return;

      const userId = body.user.id;
      const optionVotes = poll.votes.get(parsed.optionIndex);
      if (!optionVotes) return;

      // Toggle vote
      if (optionVotes.has(userId)) {
        optionVotes.delete(userId);
        console.log(`[poll] ${userId} removed vote from "${poll.options[parsed.optionIndex]}"`);
      } else {
        // Remove vote from other options first (single choice)
        for (const [idx, voters] of poll.votes) {
          if (idx !== parsed.optionIndex) voters.delete(userId);
        }
        optionVotes.add(userId);
        console.log(`[poll] ${userId} voted for "${poll.options[parsed.optionIndex]}"`);
      }

      // Update the message with new counts
      const blocks = buildPollBlocks(parsed.pollId, poll.question, poll.options, poll.votes);
      try {
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: `Poll: ${poll.question}`,
          blocks,
        });
      } catch (err: any) {
        console.error("[poll update error]", err?.data?.error || err.message);
      }
    });
  }
}

// Detect poll in Claude's response — tries JSON first, then text fallback
function extractPollJson(text: string): { question: string; options: string[] } | null {
  // Try JSON format first
  try {
    const match = text.match(/\{"poll"\s*:\s*\{[\s\S]*?\}\s*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.poll?.question && Array.isArray(parsed.poll?.options) && parsed.poll.options.length >= 2) {
        return { question: parsed.poll.question, options: parsed.poll.options.slice(0, 10) };
      }
    }
  } catch {}

  // Fallback: detect text-based polls Claude might generate despite instructions
  // Look for a quoted question followed by bulleted/numbered options
  const questionMatch = text.match(/[""]([^""]+\?)[""]/);
  if (!questionMatch) return null;

  const question = questionMatch[1];
  const options: string[] = [];
  // Match lines starting with "- " after the question
  const afterQuestion = text.slice(text.indexOf(questionMatch[0]) + questionMatch[0].length);
  const lines = afterQuestion.split("\n");
  for (const line of lines) {
    const optMatch = line.match(/^[-•]\s+(.+)/);
    if (optMatch) {
      const opt = optMatch[1].replace(/[🌟🤝🧠🔥👏✨🎯💯🫡]/g, "").trim();
      if (opt.length > 0 && opt.length < 80) options.push(opt);
    }
  }

  if (options.length >= 2) {
    return { question, options: options.slice(0, 10) };
  }

  return null;
}

// Handle bot being added to a channel — introduce itself
app.event("member_joined_channel", async ({ event, client }) => {
  // Only introduce when the bot itself joins
  if (event.user !== botUserId) return;

  console.log(`\n[joined] Added to channel ${event.channel}`);

  const intro = `i'm *Gist*, the newest member of this channel — and somehow already the most well-read. :wave:

i've absorbed every message and thread in here. slack search could _never_.

try something like:
> \`@Gist what's the dev dagster URL?\`
> \`@Gist summarize what the team shipped last week\`
> \`@Gist what bugs did QA log this month?\`
> \`@Gist who worked on the campaign agent?\`

tag \`@Gist\` in any message or thread and find out what i know.`;


  try {
    await client.chat.postMessage({
      channel: event.channel,
      text: intro,
    });
    console.log(`[intro] Sent introduction to ${event.channel}`);
  } catch (err) {
    console.error(`[intro error]`, err);
  }
});

// Handle @mentions — this is the main Q&A handler
app.event("app_mention", async ({ event, client, say }) => {
  const userId = event.user;
  const ev = event as any;
  const text = (event.text || "")
    .replace(/<@[A-Z0-9]+>/g, "")
    .trim();

  const userName = await resolveUserName(client, userId);
  const threadTs = event.thread_ts || event.ts;

  // Handle files attached to the @mention — save temp for Claude to read
  const tempFiles: { name: string; path: string; fileId: string; filetype: string; mimetype: string; size: number; title: string }[] = [];
  if (ev.files && ev.files.length > 0 && BOT_TOKEN) {
    for (const file of ev.files) {
      if (!file.url_private_download) continue;
      try {
        const buffer = await downloadSlackFile(file.url_private_download, BOT_TOKEN);
        const savedPath = await saveFileForClaude(buffer, file.name || "unknown");
        tempFiles.push({
          name: file.name || "unknown",
          path: savedPath,
          fileId: file.id,
          filetype: file.filetype || "",
          mimetype: file.mimetype || "",
          size: file.size || 0,
          title: file.title || "",
        });
        console.log(`[file] Saved temp: ${file.name} → ${savedPath}`);
      } catch (err) {
        console.error(`[file error] ${file.name}:`, (err as Error).message);
      }
    }
  }

  // Build the message for Claude — include file paths for Read tool
  const fileContext = tempFiles.length > 0
    ? `\n\n[Files shared: ${tempFiles.map(f => `"${f.name}" saved at ${f.path}`).join(", ")}. Use the Read tool to read the file contents.]`
    : "";

  // If no text but files were shared, ask Claude to read and summarize
  const userMessage = text
    ? `[${userName} is asking]: ${text}${fileContext}`
    : `[${userName} shared ${tempFiles.length} file(s)]: ${tempFiles.map(f => f.name).join(", ")}${fileContext}\nRead the file(s) and provide a brief summary of the key content — decisions, action items, important info.`;

  if (!text && tempFiles.length === 0) return;

  console.log(`\n[@mention] ${userName}: ${text || `[shared ${tempFiles.length} file(s)]`}`);

  // Post a contextual "thinking" message, then update it with the real response
  let thinkingTs: string | undefined;
  try {
    const thinkingText = tempFiles.length > 0 && !text
      ? "_reading the file..._ :page_facing_up:"
      : tempFiles.length > 0
      ? "_reading the file and thinking..._ :page_facing_up:"
      : "_thinking..._ :brain:";
    const thinkingMsg = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text: thinkingText,
    });
    thinkingTs = thinkingMsg.ts as string;

    const pendingPoll = pendingPollThreads.get(userId);
    const isInPollThread = pendingPoll?.threadTs === threadTs;
    const isPollRequest = /\bpoll\b/i.test(text) && !isInPollThread; // Only new poll requests, not follow-ups in existing poll thread

    // Detect if user is confirming the poll (short affirmative replies)
    const isConfirmation = isInPollThread && /^(yes|yeah|yep|ok|okay|sure|go|go ahead|looks? good|looks? fine|do it|post it|send it|perfect|lgtm|yea|ya)\b/i.test(text.trim());

    let messageToSend = userMessage;
    let sessionId: string | undefined;
    if (isConfirmation) {
      // Fresh session with context — so system prompt (with JSON output rules) is sent
      messageToSend = `You previously showed this poll confirmation to the user:\n\n${pendingPoll!.confirmationText}\n\nThe user just replied: "${text}"\n\nIf they are confirming, output the poll JSON now. If they want changes, adjust accordingly.`;
      sessionId = undefined;
    } else if (isInPollThread) {
      // Follow-up in poll thread (not a confirmation) — resume the poll session
      sessionId = pendingPoll!.sessionId;
    } else if (isPollRequest) {
      // New poll request — fresh session
      sessionId = undefined;
    } else {
      // Check if this @mention is in a thread — fetch full thread history for context
      const isThreadMessage = !!event.thread_ts && event.thread_ts !== event.ts;
      console.log(`[thread] isThreadMessage: ${isThreadMessage}, thread_ts: ${event.thread_ts}, event.ts: ${event.ts}`);
      if (isThreadMessage) {
        console.log(`[thread] Fetching thread messages for channel ${event.channel} thread ${event.thread_ts}...`);
        const threadContext = await fetchThreadMessages(client, event.channel, event.thread_ts!);
        console.log(`[thread] Got context (${threadContext.length} chars)`);
        if (threadContext) {
          messageToSend = `You are continuing a thread conversation in Slack. Here is the full thread history so far:\n\n${threadContext}\n\n---\n\n${userMessage}`;
        }
      }
      // Always fresh session for thread context; resume normal session for top-level mentions
      sessionId = isThreadMessage ? undefined : getSession(userId);
    }

    const response = await askClaude({
      message: messageToSend,
      model: MODEL,
      sessionId,
      maxTurns: (isPollRequest || isConfirmation) ? 1 : 7,
    });

    // Save session — but don't overwrite the user's normal session with a poll session or thread session
    if (!isPollRequest && !isInPollThread && !(!!event.thread_ts && event.thread_ts !== event.ts)) {
      setSession(userId, response.session_id);
    }

    // After Claude responds, store file metadata + extracted summary in DB, then clean up temp files
    if (tempFiles.length > 0) {
      const epoch = parseFloat(event.ts) * 1000;
      const date = new Date(epoch).toISOString().split("T")[0];
      for (const f of tempFiles) {
        upsertDocument({
          message_ts: event.ts,
          channel_id: event.channel,
          user_id: userId,
          user_name: userName,
          file_id: f.fileId,
          file_name: f.name,
          file_type: f.filetype || null,
          mime_type: f.mimetype || null,
          file_size: f.size || null,
          title: f.title || null,
          extracted_text: response.result?.slice(0, 5000) || null,
          caption: text || null,
          date,
        });
        // Delete temp file
        import("fs/promises").then(fs => fs.unlink(f.path).catch(() => {}));
      }
      console.log(`[file] Stored metadata + summary for ${tempFiles.length} file(s), temp files cleaned up`);
    }

    // Check if Claude returned a poll JSON
    const pollData = extractPollJson(response.result || "");
    if (pollData) {
      // Poll posted — clear pending state
      pendingPollThreads.delete(userId);
      // Delete the thinking message and post an interactive poll instead
      await client.chat.delete({ channel: event.channel, ts: thinkingTs }).catch(() => {});
      await postPoll(client, event.channel, pollData.question, pollData.options);
      console.log(`[reply] Posted poll: ${pollData.question}`);
      console.log(`[info] ${response.duration_ms}ms | ${response.num_turns} turns | $${response.total_cost_usd.toFixed(4)}`);
    } else {
      // Store/update pending poll state for poll flow messages
      if ((isPollRequest || isInPollThread) && response.result && !response.result.includes("hmm, i got nothing")) {
        pendingPollThreads.set(userId, { threadTs, confirmationText: response.result, sessionId: response.session_id });
      } else if (isConfirmation) {
        // Confirmation failed — clear pending state so user isn't stuck
        pendingPollThreads.delete(userId);
      }

      // Convert markdown to Slack mrkdwn and guard against empty text
      const replyText = toSlackMrkdwn(response.result || "hmm, i got nothing. try rephrasing?");

      // Update the thinking message with the actual response
      await client.chat.update({
        channel: event.channel,
        ts: thinkingTs,
        text: replyText,
      });

      console.log(
        `[reply] ${replyText.slice(0, 80)}...`
      );
      console.log(
        `[info] ${response.duration_ms}ms | ${response.num_turns} turns | $${response.total_cost_usd.toFixed(4)}`
      );
    }
  } catch (err) {
    console.error(`[error]`, err);

    const errorText = "hmm, something broke. try again?";
    if (thinkingTs) {
      await client.chat.update({
        channel: event.channel,
        ts: thinkingTs,
        text: errorText,
      }).catch(() => {});
    } else {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: errorText,
      });
    }
  }
});

// Handle DMs + trigger proactive eval on channel messages
app.event("message", async ({ event, client }) => {
  const ev = event as any;

  // Channel messages — trigger debounced proactive eval
  if (ev.channel_type !== "im") {
    if (!ev.bot_id && !ev.subtype) onNewMessage();
    return;
  }

  // Ignore bot messages
  if (ev.bot_id || ev.subtype) return;

  const userId = ev.user;
  const text = ev.text?.trim();
  if (!text) return;

  const userName = await resolveUserName(client, userId);
  console.log(`\n[DM] ${userName}: ${text}`);

  let thinkingTs: string | undefined;
  try {
    const thinkingMsg = await client.chat.postMessage({
      channel: ev.channel,
      text: "_thinking..._ :brain:",
    });
    thinkingTs = thinkingMsg.ts as string;

    const sessionId = getSession(userId);
    const response = await askClaude({
      message: `[${userName} is asking]: ${text}`,
      model: MODEL,
      sessionId,
      maxTurns: 5,
    });

    setSession(userId, response.session_id);

    const dmPoll = extractPollJson(response.result || "");
    if (dmPoll) {
      await client.chat.delete({ channel: ev.channel, ts: thinkingTs }).catch(() => {});
      await postPoll(client, ev.channel, dmPoll.question, dmPoll.options);
      console.log(`[DM reply] Posted poll: ${dmPoll.question}`);
    } else {
      await client.chat.update({
        channel: ev.channel,
        ts: thinkingTs,
        text: toSlackMrkdwn(response.result || "hmm, i got nothing. try rephrasing?"),
      });
      console.log(`[DM reply] ${response.result.slice(0, 80)}...`);
    }
    console.log(
      `[info] ${response.duration_ms}ms | ${response.num_turns} turns | $${response.total_cost_usd.toFixed(4)}`
    );
  } catch (err) {
    console.error(`[DM error]`, err);
    const errorText = "hmm, something broke. try again?";
    if (thinkingTs) {
      await client.chat.update({
        channel: ev.channel,
        ts: thinkingTs,
        text: errorText,
      }).catch(() => {});
    } else {
      await client.chat.postMessage({
        channel: ev.channel,
        text: errorText,
      });
    }
  }
});


// --- Startup ---

async function main() {
  console.log("===========================================");
  console.log("  Gist — I've read everything. Ask me.");
  console.log("  Powered by Claude CLI + SQLite FTS5");
  console.log("===========================================\n");

  // Initialize DB
  getDb();
  console.log("[db] SQLite database loaded\n");

  // Register poll action handlers
  registerPollHandlers(app);

  // Start the bot
  await app.start();

  // Get bot's own user ID
  try {
    const auth = await app.client.auth.test({ token: BOT_TOKEN });
    botUserId = auth.user_id as string;
    console.log(`[bot] Connected as ${auth.user} (${botUserId})`);
  } catch (err) {
    console.error("[bot] Could not get bot identity:", err);
  }

  console.log(`[bot] Listening in channel ${CHANNEL_ID}`);
  console.log(`[bot] Model: ${MODEL}`);
  console.log(`[bot] @mention me or DM me to ask questions\n`);

  // Start proactive agent loop
  const postToSlack = async (channel: string, text: string, threadTs?: string) => {
    await app.client.chat.postMessage({
      channel,
      text: toSlackMrkdwn(text),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
  };

  const reactToSlack = async (channel: string, timestamp: string, emoji: string) => {
    try {
      await app.client.reactions.add({
        channel,
        timestamp,
        name: emoji,
      });
    } catch (err: any) {
      // Ignore "already_reacted" errors
      if (err?.data?.error !== "already_reacted") {
        console.error(`[react error] ${emoji}:`, err?.data?.error || err.message);
      }
    }
  };

  const postPollToSlack = async (channel: string, question: string, options: string[], threadTs?: string) => {
    await postPoll(app.client, channel, question, options, threadTs);
  };

  startProactiveLoop(postToSlack, reactToSlack, CHANNEL_ID, MODEL, postPollToSlack);

  console.log("[bot] Press Ctrl+C to stop.\n");

  process.on("SIGINT", async () => {
    console.log("\n[bot] Shutting down...");
    closeDb();
    await app.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  closeDb();
  process.exit(1);
});
