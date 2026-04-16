/**
 * Cron-based message ingestion for Slack Brain.
 *
 * Polls Slack API (conversations.history + conversations.replies) every 2 min
 * and ingests new messages into the SQLite database.
 * Also extracts key info from shared files via Claude.
 *
 * Run separately from bot.ts in its own tmux session:
 *   npx tsx cron.ts
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN   - xoxb-... (for file downloads)
 *   SLACK_USER_TOKEN  - xoxp-... (for conversations.history API)
 *   SLACK_CHANNEL_ID  - channel to ingest
 *   CLAUDE_MODEL      - model for file extraction
 */

import { upsertMessage, upsertDocument, upsertUser, getUserName, getMeta, setMeta, getDb, closeDb } from "./db.js";
import { askClaude } from "./agent.js";
import { downloadSlackFile, saveFileForClaude } from "./files.js";
import { unlink } from "fs/promises";

// --- Config ---

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const USER_TOKEN = process.env.SLACK_USER_TOKEN;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C02J3DNC75Z";
const MODEL = process.env.CLAUDE_MODEL || "sonnet";
const CRON_INTERVAL = 30 * 1000; // 30 seconds
const RATE_LIMIT_MS = 600;

if (!USER_TOKEN) {
  console.error("Required: SLACK_USER_TOKEN");
  process.exit(1);
}
if (!BOT_TOKEN) {
  console.warn("Warning: SLACK_BOT_TOKEN not set — file downloads will be disabled");
}

// --- Helpers ---

const userCache = new Map<string, string>();

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function slackApiGet(
  method: string,
  token: string,
  params: Record<string, string> = {}
): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "10", 10);
    console.log(`[cron] Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return slackApiGet(method, token, params);
  }

  const data = await res.json();

  if (data.error === "ratelimited") {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "10", 10);
    console.log(`[cron] Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return slackApiGet(method, token, params);
  }

  if (!data.ok) {
    throw new Error(`Slack API ${method}: ${data.error}`);
  }

  return data;
}

async function resolveUserFromApi(userId: string, token: string): Promise<string> {
  const cached = userCache.get(userId);
  if (cached) return cached;

  const dbName = getUserName(userId);
  if (dbName) {
    userCache.set(userId, dbName);
    return dbName;
  }

  try {
    await sleep(RATE_LIMIT_MS);
    const data = await slackApiGet("users.info", token, { user: userId });
    const u = data.user;
    const name = u.profile?.display_name || u.profile?.real_name || u.name || userId;
    upsertUser(userId, u.name, u.profile?.real_name, u.profile?.display_name);
    userCache.set(userId, name);
    return name;
  } catch {
    userCache.set(userId, userId);
    return userId;
  }
}

async function resolveSlackText(text: string, token: string): Promise<string> {
  const mentionPattern = /<@(U[A-Z0-9]+)>/g;
  const matches = [...text.matchAll(mentionPattern)];
  let resolved = text;
  for (const match of matches) {
    const name = await resolveUserFromApi(match[1], token);
    resolved = resolved.replace(match[0], `@${name}`);
  }

  return resolved
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<!channel>/g, "@channel")
    .replace(/<!here>/g, "@here")
    .replace(/<!everyone>/g, "@everyone");
}

// --- File info extraction via Claude ---

async function extractFileInfo(
  filePath: string,
  fileName: string,
  userName: string,
  date: string
): Promise<string | null> {
  try {
    const prompt = `A file "${fileName}" was shared by ${userName} on ${date} in #newdevelopment.
The file is saved at: ${filePath}

Read the file using the Read tool, then extract ALL key information as a structured summary:
- Decisions made
- Action items (who, what, when)
- Important URLs, configs, or technical details
- Key discussion points
- Deadlines or dates mentioned
- Any other notable facts

If it's a meeting transcript, focus on action items and decisions per person.
Return ONLY the extracted summary — no preamble, no "here's the summary" intro. Just the facts.
Also use your memory tools to store the most important facts for future reference.`;

    const response = await askClaude({
      message: prompt,
      model: MODEL,
      maxTurns: 7,
    });
    console.log(`[file extract] Processed ${fileName} (${response.num_turns} turns, $${response.total_cost_usd.toFixed(4)})`);
    return response.result || null;
  } catch (err) {
    console.error(`[file extract error] ${fileName}:`, (err as Error).message);
    return null;
  }
}

// --- Main ingestion logic ---

let cronRunning = false;

async function fetchNewMessages() {
  if (cronRunning) return;
  cronRunning = true;

  try {
    // On first run (no cursor), only go back 30 days
    const thirtyDaysAgo = String((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const storedTs = getMeta("last_fetched_ts");
    const lastTs = storedTs || thirtyDaysAgo;
    let cursor: string | undefined;
    let newestTs = lastTs;
    let totalNew = 0;
    const threadsToFetch: { ts: string; replyCount: number }[] = [];

    // Fetch new messages from channel history
    do {
      const params: Record<string, string> = {
        channel: CHANNEL_ID,
        limit: "200",
        oldest: lastTs,
      };
      if (cursor) params.cursor = cursor;

      await sleep(RATE_LIMIT_MS);
      const data = await slackApiGet("conversations.history", USER_TOKEN!, params);
      const messages = data.messages || [];

      for (const msg of messages) {
        if (!msg.text && !msg.files) continue;
        if (msg.subtype === "channel_join" || msg.subtype === "channel_leave") continue;

        const userName = msg.user
          ? await resolveUserFromApi(msg.user, USER_TOKEN!)
          : msg.username || "bot";
        const text = await resolveSlackText(msg.text || "", USER_TOKEN!);
        const epoch = parseFloat(msg.ts) * 1000;
        const date = new Date(epoch).toISOString().split("T")[0];

        if (text) {
          upsertMessage({
            ts: msg.ts,
            channel_id: CHANNEL_ID,
            user_id: msg.user || null,
            user_name: userName,
            text,
            thread_ts: msg.thread_ts || null,
            reply_count: msg.reply_count || 0,
            date,
            is_thread_reply: 0,
          });
        }

        // Handle file attachments
        if (msg.files && msg.files.length > 0 && BOT_TOKEN) {
          for (const file of msg.files) {
            if (!file.url_private_download) continue;
            try {
              const buffer = await downloadSlackFile(file.url_private_download, BOT_TOKEN);
              const savedPath = await saveFileForClaude(buffer, file.name || "unknown");

              // Use Claude to extract key info
              const extractedInfo = await extractFileInfo(savedPath, file.name || "unknown", userName, date);

              upsertDocument({
                message_ts: msg.ts,
                channel_id: CHANNEL_ID,
                user_id: msg.user || null,
                user_name: userName,
                file_id: file.id,
                file_name: file.name || "unknown",
                file_type: file.filetype || null,
                mime_type: file.mimetype || null,
                file_size: file.size || null,
                title: file.title || null,
                extracted_text: extractedInfo,
                caption: msg.text || null,
                date,
              });

              // Clean up temp file
              await unlink(savedPath).catch(() => {});
              console.log(`[cron] indexed file: ${file.name} (${extractedInfo ? extractedInfo.length + ' chars summary' : 'no info extracted'})`);
            } catch (err) {
              console.error(`[cron file error] ${file.name}:`, (err as Error).message);
            }
          }
        }

        // Track threads with replies
        if (msg.reply_count && msg.reply_count > 0) {
          threadsToFetch.push({ ts: msg.ts, replyCount: msg.reply_count });
        }

        if (msg.ts > newestTs) newestTs = msg.ts;
        totalNew++;
      }

      cursor = data.response_metadata?.next_cursor;
    } while (cursor);

    // Fetch thread replies
    for (const thread of threadsToFetch) {
      let threadCursor: string | undefined;
      do {
        const params: Record<string, string> = {
          channel: CHANNEL_ID,
          ts: thread.ts,
          limit: "200",
        };
        if (threadCursor) params.cursor = threadCursor;

        await sleep(RATE_LIMIT_MS);
        const data = await slackApiGet("conversations.replies", USER_TOKEN!, params);
        const replies = data.messages || [];

        for (const reply of replies) {
          if (reply.ts === thread.ts) continue;
          if (!reply.text) continue;

          const userName = reply.user
            ? await resolveUserFromApi(reply.user, USER_TOKEN!)
            : reply.username || "bot";
          const text = await resolveSlackText(reply.text || "", USER_TOKEN!);
          const epoch = parseFloat(reply.ts) * 1000;
          const date = new Date(epoch).toISOString().split("T")[0];

          upsertMessage({
            ts: reply.ts,
            channel_id: CHANNEL_ID,
            user_id: reply.user || null,
            user_name: userName,
            text,
            thread_ts: thread.ts,
            reply_count: 0,
            date,
            is_thread_reply: 1,
          });

          if (reply.ts > newestTs) newestTs = reply.ts;
          totalNew++;
        }

        threadCursor = data.response_metadata?.next_cursor;
      } while (threadCursor);
    }

    // Update cursor
    if (newestTs > lastTs) {
      setMeta("last_fetched_ts", newestTs);
      setMeta("last_fetch_date", new Date().toISOString());
    }

    if (totalNew > 0) {
      console.log(`[cron] Ingested ${totalNew} new messages (${threadsToFetch.length} threads)`);
    } else {
      console.log(`[cron] No new messages`);
    }
  } catch (err) {
    console.error("[cron] Ingestion error:", (err as Error).message);
  } finally {
    cronRunning = false;
  }
}

// --- Startup ---

async function main() {
  console.log("===========================================");
  console.log("  Gist Cron — Message Ingestion");
  console.log("  Polling every 2 min");
  console.log("===========================================\n");

  getDb();
  console.log("[db] SQLite database loaded");
  console.log(`[cron] Channel: ${CHANNEL_ID}`);
  console.log(`[cron] Model: ${MODEL}\n`);

  // Run immediately
  console.log("[cron] Running initial fetch...");
  await fetchNewMessages();

  // Then on interval
  setInterval(() => {
    fetchNewMessages().catch(err =>
      console.error("[cron] Fetch error:", (err as Error).message)
    );
  }, CRON_INTERVAL);

  console.log(`\n[cron] Running every ${CRON_INTERVAL / 1000}s. Press Ctrl+C to stop.\n`);

  process.on("SIGINT", () => {
    console.log("\n[cron] Shutting down...");
    closeDb();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  closeDb();
  process.exit(1);
});
