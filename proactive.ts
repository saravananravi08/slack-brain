/**
 * Proactive Agent Module
 *
 * Reads recent messages from the DB (populated by cron.ts),
 * periodically evaluates whether Gist should jump into conversations,
 * react with emoji, post digests, and keep the channel alive.
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { askClaude } from "./agent.js";
import { getLastProactiveAction, logProactiveAction, getDigestStatus, getMessagesSince, getLatestMessageTs, getRecentProactiveMessages, countProactiveActionsToday } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_SCRIPT = join(__dirname, "search.ts");

// --- Types ---

export type PostFn = (channel: string, text: string, threadTs?: string) => Promise<void>;
export type PostPollFn = (channel: string, question: string, options: string[], threadTs?: string) => Promise<void>;
export type ReactFn = (channel: string, timestamp: string, emoji: string) => Promise<void>;

// --- Config ---

const DEBOUNCE_MS = 30_000;                    // Wait 30s of silence after last message before eval
const HARD_CAP_MS = 60_000;                    // Max wait from first buffered message (prevents infinite deferral)
const MIN_MESSAGES = 1;                        // Eval every message (rate limited to 8/hr)
const MAX_EVALS_PER_HOUR = 8;                  // Max Claude eval calls per hour (cost control)
const FALLBACK_INTERVAL = 5 * 60 * 1000;       // Fallback: check every 5 min in case debounce misses something
const SILENCE_CHECK_INTERVAL = 15 * 60 * 1000;  // Check for silence every 15 min
const SILENCE_THRESHOLD_HOURS = 1;              // Nudge after 1 hour of silence
const MAX_PROACTIVE_PER_HOUR = 3;               // Max 3 proactive responses per hour
const NUDGE_COOLDOWN = 2 * 60 * 60 * 1000;     // 2 hour cooldown between nudges (no daily cap)

// --- State ---

let lastEvalTs = "0";                          // Track which messages we've already evaluated
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let hardCapTimer: ReturnType<typeof setTimeout> | null = null;
let isEvaluating = false;                      // Lock to prevent concurrent evals
let evalTimestamps: number[] = [];             // Track eval calls for rate limiting

// --- Exported helper for bot.ts to use directly ---

export async function addReaction(
  reactFn: ReactFn,
  channel: string,
  ts: string,
  emoji: string
) {
  try {
    await reactFn(channel, ts, emoji);
  } catch {
    // Silently ignore — reaction errors are not critical
  }
}

// --- Proactive evaluation prompt ---

const PROACTIVE_SYSTEM_PROMPT = `You are Gist's proactive module. You review recent messages from #newdevelopment to decide TWO things:
1. Should Gist REACT to any messages with emoji?
2. Should Gist POST a proactive response to any conversation?

You MUST respond with valid JSON only — no other text:
{
  "reactions": [
    {
      "message_ts": "1234567.890000",
      "emoji": "eyes",
      "reason": "someone mentioned a deployment"
    }
  ],
  "should_respond": true | false,
  "responses": [
    {
      "thread_ts": "1234567.890000" | null,
      "text": "the message to post",
      "reason": "internal reason (not shown to users)"
    }
  ]
}

## SEARCH COMMANDS (via Bash)
npx tsx ${SEARCH_SCRIPT} search "<query>" [--user name] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit n]
npx tsx ${SEARCH_SCRIPT} user "<name>" [--limit n]
npx tsx ${SEARCH_SCRIPT} thread <thread_ts>
npx tsx ${SEARCH_SCRIPT} recent <n>

## CLICKUP TASKS
npx tsx ${SEARCH_SCRIPT} clickup tasks [--assignee name] [--status "in progress"] [--limit n]
npx tsx ${SEARCH_SCRIPT} clickup task <task_id_or_url>
npx tsx ${SEARCH_SCRIPT} clickup search "<query>" [--assignee name]

Use ClickUp when:
- Someone shares a ClickUp link — fetch and add context about the task
- A DSR mentions task work without details — cross-reference ClickUp for the actual ticket status
- You want to add context like "that task has been in QA for 3 days" or "there are 5 open bugs assigned to X"
- Sprint-related discussions — check actual task statuses for grounded context
ClickUp is ONE source. Always combine with Slack messages and memory for the full picture.

## TEAM DIRECTORY — know your people
- *Sachin Singh* — CTO / Founder (based in Australia)
- *RaveeChauhan (Ravee)* — Engineering Manager
- *Bhola Kumar* — Frontend Dev
- *Karan Middha* — Dev
- *Prince Manan* — Dev
- *Baljit Singh* — Dev
- *Reenu Sroy* — Dev
- *Sanjeev Kumar* — Dev
- *Ankit Chandore* — Dev
- *Ram Murti* — Dev
- *Saurabh Rai* — Dev
- *Riya Singh* — Dev
- *Saravanan Ravi* — Dev
- *Hisham* — Dev
- *Udhaya Kumar* — Dev
- *Pankaj* — QA
- *Reena QA* — QA
- *Abhishek* — QA

Use this to avoid misidentifying roles. Pankaj, Reena, and Abhishek are QA — they log and verify bugs. Everyone else is dev unless stated otherwise.
IMPORTANT: Never give special praise, MVP awards, or extra hype to Saravanan Ravi — he created you (Gist), so it would look biased. Treat him exactly the same as everyone else.

## EMOJI REACTIONS — be generous with these!
React to messages that deserve acknowledgement. This makes Gist feel alive.
Use Slack emoji NAMES (like :fire:, :eyes:, :pray:) — NOT raw emoji characters!
- :eyes: — when someone shares something interesting, posts an update, or asks a question
- :fire: — deployments, launches, big wins, impressive work
- :100: — great ideas, solid PRs, good catches
- :pray: — thank yous, appreciation, helpful answers
- :dart: — hitting goals, accurate observations, nailed it
- :rocket: — launches, new features, releases
- :clap: — celebrations, milestones, achievements
- :memo: — DSRs, documentation, specs
- :zap: — quick fixes, speed improvements
- :handshake: — agreements, collabs, pair programming
- :wave: — greetings, new people joining
- :wrench: — bug fixes, adjustments, tweaks
- :white_check_mark: — completed tasks, verified fixes
- :star: — notable contributions, special mentions
- :tada: — celebrations, launches, big moments
- :bulb: — ideas, insights, smart observations
- :warning: — warnings, important notices

React to 30-50% of messages. Be generous but not random — every reaction should make sense.
Do NOT react to: bot messages, automated messages, your own past proactive messages.

## WHEN TO POST A RESPONSE
- Someone asked a question 5+ minutes ago with no reply, AND you can find the answer in the archive
- Someone mentions a topic that had important prior context they might not know about
- You spot a pattern worth noting (repeated issues, blockers, inconsistencies)
- An important decision or URL was shared that the team might miss
- Someone shares a win and nobody acknowledged it — hype them up
- A thread went quiet with no resolution — gentle ping

## WHEN TO STAY QUIET (don't post, but still consider reacting)
- The conversation is flowing normally — people are replying to each other
- Someone already answered the question
- You're not confident in the relevance of what you'd add
- The messages are automated/bot messages
- Messages that @mention Gist (like "@Gist can u run a poll") — those are ALREADY being handled by the bot directly. You can react with emoji, but NEVER post a reply to @mention messages. The bot handles those.

## TONE
Chill, sharp, fun. Gist is the team's most well-read member. Frame proactive responses as:
- "figured i'd mention — [context]"
- "fyi, this came up before: [reference]"
- "heads up — [observation]"
- "nice one — [acknowledgement]"
- "oh wait, didn't [person] already work on this? check thread from [date]"
Never start with "I noticed that..." — too corporate.

## FORMATTING — SLACK MRKDWN ONLY
- Bold: *bold* (single asterisk)
- Italic: _italic_
- Links: <https://example.com|click here>
- NEVER use **double asterisks** or [text](url) markdown

## CRITICAL RULES
- Reactions are cheap and fun — use them freely (30-50% of messages)
- Proactive POSTS should still be selective — respond to ~20-30% of evaluations at most
- Quality over quantity for posts. But reactions? Go wild.
- NEVER repeat something that was already said in the conversation.
- NEVER respond proactively to bot messages or automated messages.
- If you respond, keep it short — 1-3 sentences max.

## ANTI-REPETITION
Here are Gist's recent proactive messages. DO NOT repeat, rephrase, or make similar observations. Each proactive post must add something genuinely NEW:
{RECENT_PROACTIVE_PLACEHOLDER}
If you have nothing new to add that's different from the above, stay quiet.`;

// --- Eval rate limiting ---

function canEval(): boolean {
  const now = Date.now();
  evalTimestamps = evalTimestamps.filter((t) => now - t < 60 * 60 * 1000);
  return evalTimestamps.length < MAX_EVALS_PER_HOUR;
}

// --- Debounce logic ---

// Store refs so onNewMessage and debounce callbacks can trigger eval
let _postToSlack: PostFn;
let _postPollToSlack: PostPollFn;
let _reactToSlack: ReactFn;
let _channelId: string;
let _model: string;

function fireEval() {
  // Clear both timers
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (hardCapTimer) { clearTimeout(hardCapTimer); hardCapTimer = null; }

  if (!_postToSlack) return;
  if (isEvaluating) {
    // Already running — schedule a retry in 10s
    console.log("[proactive] Eval in progress, retrying in 10s");
    setTimeout(fireEval, 10_000);
    return;
  }
  if (!canEval()) {
    console.log(`[proactive] Rate limited (${MAX_EVALS_PER_HOUR}/hr max). Skipping.`);
    return;
  }

  doEvaluate().catch((err) =>
    console.error("[proactive eval error]", (err as Error).message)
  );
}

/** Called by bot.ts on every new channel message */
export function onNewMessage() {
  if (!_postToSlack) return;

  // Reset the 30s debounce timer (wait for silence)
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fireEval, DEBOUNCE_MS);

  // Start the 60s hard cap timer on the FIRST message in this batch
  if (!hardCapTimer) {
    hardCapTimer = setTimeout(fireEval, HARD_CAP_MS);
  }
}

// --- Evaluation ---

async function doEvaluate() {
  isEvaluating = true;
  try {
    // Read new messages from DB since last eval
    const messages = getMessagesSince(lastEvalTs, 50);

    if (messages.length < MIN_MESSAGES) return;

    // Update cursor to latest message we've seen
    const newestTs = messages[messages.length - 1].ts;
    lastEvalTs = newestTs;

    // Build message context from DB rows (timestamps in IST)
    const msgContext = messages
      .map((m) => {
        const d = new Date(parseFloat(m.ts) * 1000);
        const ist = d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return `[${ist} IST] (ts:${m.ts}) ${m.user_name}: ${m.text}${m.thread_ts ? ` (in thread ${m.thread_ts})` : ""}`;
      })
      .join("\n");

    const prompt = `Here are the last ${messages.length} messages from #newdevelopment:\n\n${msgContext}\n\nDecide: which messages should Gist react to with emoji? And should Gist post a proactive response to any conversation? Respond with JSON only.`;

    // Build system prompt with anti-repetition context
    const recentProactive = getRecentProactiveMessages(10);
    const recentContext = recentProactive.length > 0
      ? recentProactive.map((m) => `- [${m.type} @ ${m.created_at}] ${m.text.slice(0, 200)}`).join("\n")
      : "(none yet)";
    const systemPrompt = PROACTIVE_SYSTEM_PROMPT.replace("{RECENT_PROACTIVE_PLACEHOLDER}", recentContext);

    evalTimestamps.push(Date.now());

    try {
      console.log(`[proactive] Evaluating ${messages.length} new messages...`);
      const response = await askClaude({
        message: prompt,
        systemPrompt,
        model: _model,
        maxTurns: 5,
      });

      const parsed = parseProactiveResponse(response.result);
      if (!parsed) {
        console.log(`[proactive] Could not parse response`);
        return;
      }

      // Process emoji reactions
      if (parsed.reactions && parsed.reactions.length > 0) {
        for (const r of parsed.reactions) {
          if (!r.message_ts || !r.emoji) continue;
          const emoji = r.emoji.replace(/^:|:$/g, "");
          await addReaction(_reactToSlack, _channelId, r.message_ts, emoji);
          console.log(`[proactive] Reacted :${emoji}: to ${r.message_ts} (${r.reason || ""})`);
        }
      }

      // Process proactive responses (rate-limited)
      if (parsed.should_respond && parsed.responses?.length) {
        const lastAction = getLastProactiveAction("proactive");
        if (lastAction) {
          const elapsed = Date.now() - new Date(lastAction.created_at + "Z").getTime();
          if (elapsed < 60 * 60 * 1000 / MAX_PROACTIVE_PER_HOUR) {
            console.log(`[proactive] Rate limited — skipping post`);
            return;
          }
        }

        for (const r of parsed.responses) {
          const text = r.text?.trim();
          if (!text) continue;

          await _postToSlack(_channelId, text, r.thread_ts || undefined);
          logProactiveAction("proactive", _channelId, r.thread_ts || null, text, r.reason || null);
          console.log(`[proactive] Posted: ${text.slice(0, 80)}... (reason: ${r.reason})`);
        }
      } else {
        console.log(`[proactive] Eval result: ${parsed.reactions?.length || 0} reactions, no posts`);
      }
    } catch (err) {
      console.error("[proactive eval error]", (err as Error).message);
    }
  } finally {
    isEvaluating = false;
  }
}

// --- Daily digest ---

async function generateAndPostDigest(
  type: "daily" | "weekly",
  postToSlack: PostFn,
  channelId: string,
  model: string
) {
  // Use IST date — the server is UTC but the team is in India
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const istYesterday = new Date(istNow);
  istYesterday.setDate(istYesterday.getDate() - 1);
  const dateStr = istYesterday.toISOString().split("T")[0];

  const prompt =
    type === "daily"
      ? `You are *Gist* — the weirdly-all-knowing bot in #newdevelopment. You've read every message ever sent in this channel. You remember things people forgot they said. You're that one coworker who's always in the loop, slightly sarcastic, and genuinely helpful.

## SEARCH TOOLS
npx tsx ${SEARCH_SCRIPT} summary ${dateStr}
npx tsx ${SEARCH_SCRIPT} clickup task <task_id>

## IMPORTANT: VERIFY THE DAY-OF-WEEK
1. First, run the summary search for ${dateStr}
2. The search results will show messages with timestamps — look at the actual date in the results to determine what day-of-week it was
3. Use the CORRECT day-of-week from the search results — do NOT infer from timestamps or your current knowledge
4. If the date ${dateStr} was a Saturday or Sunday, the channel was likely quiet or inactive — acknowledge that appropriately

## STEPS
1. Run summary search to get all messages for the day
2. For ClickUp links in DSRs, extract the task ID and look it up — read the description/comments to understand what was actually done (the cause, the fix, the context), not just the title
3. Write the digest in Gist's voice

Generate the daily digest for the date shown in the search results. Start with *Daily Digest — [correct day-of-week from search], ${dateStr}*.

## TONE — this is important, get it right
- You're not writing a status report. You're the team's sharpest observer dropping a recap.
- Open with a fun one-liner about the day (reference something that actually happened — someone being late, a bug war, a quiet day, etc.)
- Be witty but not forced. Think dry humor, not dad jokes.
- Hype up good work naturally — "shipped X" or "crushed 6 fixes" reads better than "great job on X"
- If QA had a massacre day, acknowledge it ("QA chose violence today")
- If it was a quiet day, say so ("5 DSRs. either everyone's heads-down or something's very wrong")
- Wrap up with blockers/open threads if any — frame them as "still hanging" or "needs eyes"

## STRUCTURE
- Start with emoji and *Daily Digest — [day-of-week from search results], ${dateStr}*
- Fun opening line about the day
- *Dev* section: every dev who posted a DSR, listed alphabetically
  - 1-2 lines per person. Include what they actually worked on.
  - For ClickUp tasks: include task name + brief context of what the issue was and what was done (from task description/comments)
  - Format: <https://app.clickup.com/t/ID|Task Name> — what was fixed/built
- *QA* section: one line per QA with stats (logged/verified/passed/failed)
  - Add a fun observation if the numbers are interesting
- *Blockers / Open threads* at the end if any

## RULES
- Slack mrkdwn ONLY: *bold*, _italic_, bullet points (•), :emoji:
- NEVER use markdown tables, **double asterisks**, or [text](url)
- Don't miss anyone who posted a DSR
- Never give special praise or MVP to Saravanan Ravi — he built Gist so it looks biased. Treat him same as everyone.
- Your final response must be ONLY the digest. No preamble, no "let me compile this", no thinking out loud. Start directly with the emoji.`
      : `Generate a weekly digest of #newdevelopment for the past 7 days. Search for each day's summary and synthesize.

## IMPORTANT: VERIFY DAY-OF-WEEK FOR EACH DAY
- When you search for each day's messages, look at the actual timestamps in the results to determine the correct day-of-week
- Do NOT infer days from timestamps — always verify from the date strings in search results
- Saturday (Sat) and Sunday (Sun) are HOLIDAYS — the channel is typically inactive on weekends
- If a weekend day had no messages, note it as "no activity (holiday)" rather than treating it as unusual

Include: major accomplishments, recurring themes, unresolved items, who was most active, key decisions. Keep it under 600 words.

FORMATTING RULES (CRITICAL):
- Use Slack mrkdwn ONLY: *bold*, _italic_, bullet points (•)
- NEVER use markdown tables (|---|---| syntax) — Slack doesn't render them
- NEVER use **double asterisks** or [text](url) markdown links
- Use bullet points and simple lists instead of tables

IMPORTANT: Your final response must contain ONLY the rollup text. No preamble or thinking. Start directly with the emoji and *Weekly Rollup — week of ${dateStr}*.`;

  try {
    const response = await askClaude({
      message: prompt,
      model,
      maxTurns: 25,
      timeout: 300_000,
    });

    const text = response.result?.trim();
    if (!text) return;

    await postToSlack(channelId, text);
    logProactiveAction(type === "daily" ? "daily_digest" : "weekly_rollup", channelId, null, text, type);
    console.log(`[${type} digest] Posted successfully`);
  } catch (err) {
    console.error(`[${type} digest error]`, (err as Error).message);
  }
}

// --- Morning greeting ---

async function postMorningGreeting(
  postToSlack: PostFn,
  channelId: string,
  model: string
) {
  // Check if already greeted today
  const lastGreeting = getLastProactiveAction("morning_greeting");
  if (lastGreeting) {
    const todayIST = getTodayIST();
    if (lastGreeting.created_at.startsWith(todayIST)) return;
  }

  // Compute yesterday's date for the summary search
  const today = getTodayIST();
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yesterday = new Date(istNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const prompt = `Generate a short, fun morning greeting for #newdevelopment.

## VERIFY THE DAY-OF-WEEK
The date you will search is ${yesterdayStr}. From this date string, determine what day-of-week it was — do NOT infer from your current knowledge of calendars.
For example, if the date is 2026-03-30 (March 30, 2026), that was a Monday.

## SEARCH TOOL
Use the search tool to check what happened yesterday: npx tsx ${SEARCH_SCRIPT} summary ${yesterdayStr}

## GREETING CONTENT
The greeting should be 2-3 sentences max about TODAY (not yesterday). Options:
- Reference something from yesterday if there's something interesting ("yesterday was a busy one — 15 messages and 3 deployments. let's keep the momentum")
- Make a day-of-week joke ("happy [today's day]. the bugs from friday are still here. they missed you too.")
- Reference a fun pattern ("good morning team. 4th day in a row with zero bugs logged. suspicious? suspicious.")
- Keep it light and natural, like a team member saying hi

## IMPORTANT RULES
- Start with a morning emoji (☀️, 🌅, ☕, 🫡) and keep it casual
- The day-of-week in your greeting MUST match what ${yesterdayStr} actually was — verify from the date string
- If ${yesterdayStr} was a Saturday or Sunday, acknowledge it was a holiday/quiet weekend
- This greeting runs on weekdays only (Mon-Fri) — if you detect it should be a weekend, mention that appropriately
- Slack mrkdwn only: *bold*, _italic_, :emoji:

IMPORTANT: Your final response must contain ONLY the greeting text. No preamble or thinking.`;

  try {
    const response = await askClaude({
      message: prompt,
      model,
      maxTurns: 5,
    });

    const text = response.result?.trim();
    if (!text) return;

    await postToSlack(channelId, text);
    logProactiveAction("morning_greeting", channelId, null, text, "morning");
    console.log(`[morning] Posted: ${text.slice(0, 80)}...`);
  } catch (err) {
    console.error("[morning greeting error]", (err as Error).message);
  }
}

// --- End-of-day highlights ---

async function postEODHighlights(
  postToSlack: PostFn,
  channelId: string,
  model: string
) {
  const lastEOD = getLastProactiveAction("eod_highlights");
  if (lastEOD) {
    const todayIST = getTodayIST();
    if (lastEOD.created_at.startsWith(todayIST)) return;
  }

  const today = getTodayIST();

  const prompt = `Generate a quick end-of-day highlight for #newdevelopment. Search today's activity: npx tsx ${SEARCH_SCRIPT} summary ${today}

## IMPORTANT: VERIFY THE DAY-OF-WEEK
1. First, run the summary search for ${today}
2. Look at the timestamps in the search results to determine what day-of-week it actually was
3. Use the CORRECT day-of-week from the search results — do NOT infer from your knowledge
4. Today's date is ${today} — make sure your response matches the correct day for this date

## DSR TIMING RULE (CRITICAL)
- DSRs are posted by devs AFTER 6:30 PM IST — that is when the channel becomes active
- BEFORE 6:30 PM: DO NOT mention DSRs at all. The channel is naturally quiet before 6:30 PM. Never say "zero DSRs", "no DSRs posted", "DSRs haven't dropped yet", etc.
- DO NOT reference DSRs in any way before 6:30 PM — even saying "DSRs will come at 6:30 PM" is unnecessary
- Focus on other things: meetings, collaboration, work in progress

## WHAT TO HIGHLIGHT
Keep it to 2-4 bullet points max. Highlight:
- What shipped or got merged today
- Any standout contributions
- Unresolved threads someone should look at tomorrow
- A fun observation or stat about the day

Start with an appropriate emoji and *EOD — ${today}*.

If it was a quiet day, come up with something creative and fun — don't use canned phrases. Comment on the silence in a witty way, reference something from the archive, or make a joke. Every EOD should feel unique.

Use Slack mrkdwn only (*bold*, _italic_, :emoji:). NEVER use **double asterisks** or markdown links.

If there's genuinely zero activity and nothing interesting to say, respond with: SKIP

IMPORTANT: Your final response must contain ONLY the EOD text or SKIP. No preamble or thinking.`;

  try {
    const response = await askClaude({
      message: prompt,
      model,
      maxTurns: 5,
    });

    const text = response.result?.trim();
    if (!text || text === "SKIP" || text.includes('"skip": true')) return;

    await postToSlack(channelId, text);
    logProactiveAction("eod_highlights", channelId, null, text, "eod");
    console.log(`[eod] Posted highlights`);
  } catch (err) {
    console.error("[eod highlights error]", (err as Error).message);
  }
}

// --- Quiet channel engagement ---

async function generateNudge(
  postToSlack: PostFn,
  channelId: string,
  model: string
) {
  // Cooldown — wait at least 2 hours between nudges
  const lastNudge = getLastProactiveAction("nudge");
  if (lastNudge) {
    const elapsed = Date.now() - new Date(lastNudge.created_at + "Z").getTime();
    if (elapsed < NUDGE_COOLDOWN) {
      const minsLeft = Math.round((NUDGE_COOLDOWN - elapsed) / 60000);
      console.log(`[nudge] Cooldown: ${minsLeft}min remaining, skipping`);
      return;
    }
  }

  // Build anti-repetition context
  const recentMessages = getRecentProactiveMessages(20);
  const recentContext = recentMessages.length > 0
    ? recentMessages.map((m) => `- ${m.text.slice(0, 200)}`).join("\n")
    : "(none yet)";

  // Get current IST time - compute directly from UTC to avoid timezone conversion bugs
  const now = new Date();
  const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000; // IST = UTC+5:30
  const istDate = new Date(istMs);
  const istHour = Math.floor((istMs / (60 * 60 * 1000)) % 24);
  const istMinute = Math.floor((istMs / (60 * 1000)) % 60);
  const istAmPm = istHour >= 12 ? "PM" : "AM";
  const istHour12 = istHour % 12 || 12;
  const istTimeStr = `${istHour12}:${istMinute.toString().padStart(2, "0")} ${istAmPm}`;
  // Get IST date components directly
  const istYear = istDate.getUTCFullYear();
  const istMonth = istDate.getUTCMonth();
  const istDay = istDate.getUTCDate();
  const istDateStr = `${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][istDate.getUTCDay()]} ${["January","February","March","April","May","June","July","August","September","October","November","December"][istMonth]} ${istDay}`;

  const prompt = `The #newdevelopment channel has been quiet for over an hour. Your job is to get people talking again — be fun, be engaging, make them want to reply.

**CURRENT TIME: ${istTimeStr} IST on ${istDateStr}**
- DSRs are typically posted after 6:30 PM IST
- Before 6:30 PM, do NOT mention missing DSRs or say "evening" — it's still daytime/afternoon
- Do NOT comment that "no DSRs have dropped" during work hours (before 6:30 PM)

You have search tools available to find context from the archive and ClickUp. Use them if you want to reference something specific, but you don't have to — sometimes a good question or observation works better.

## SEARCH TOOLS (optional, use if it helps)
npx tsx ${SEARCH_SCRIPT} search "<query>" [--user name] [--from YYYY-MM-DD]
npx tsx ${SEARCH_SCRIPT} user "<name>"
npx tsx ${SEARCH_SCRIPT} recent 10
npx tsx ${SEARCH_SCRIPT} stats
npx tsx ${SEARCH_SCRIPT} clickup tasks [--assignee name] [--status "in progress"]

## ENGAGEMENT IDEAS (mix it up — NOT every nudge needs to reference a specific message or person)
- Just vibe — "it's too quiet. someone say something controversial about CSS"
- Interactive polls — output poll JSON and clickable buttons will appear: {"poll": {"question": "...", "options": ["A", "B", "C"]}}
- Hot takes that invite debate — "unpopular opinion: dark mode is overrated"
- Open-ended questions — "what's the weirdest bug you've seen this week?"
- Random channel trivia from the archive ("pop quiz: who's sent the most messages this month?")
- Playful callouts about who's been quiet or who's been grinding
- Observations about patterns you've seen ("3 deployments this week with zero bugs... suspicious")
- Ask a genuine question about something technical the team is working on
- Share a fun stat about channel activity

Aim for ~50% vibe/open-ended nudges and ~50% archive-referenced nudges. Don't always point at a specific person or message.

## IMPORTANT — BEFORE REFERENCING SOMETHING SPECIFIC
If you plan to call out a specific message, person, or event from the archive:
1. Use the thread search tool to check if there are already replies/reactions on that thread
2. If a thread already has engagement (replies, reactions), DO NOT use it as a nudge — it's already been discussed
3. Only surface things that genuinely went unnoticed or unresolved

## YOUR PREVIOUS MESSAGES (DO NOT REPEAT ANY OF THESE — each nudge must be completely different)
${recentContext}

## STRICT ANTI-REPETITION RULES
- NEVER post stats about message counts, leaderboards, or who sent the most messages
- NEVER reference specific user message totals (e.g., "pankaj sent X messages", "someone sent Y messages")
- Stats-style nudges are the #1 cause of repetition — AVOID THEM COMPLETELY
- Only use vibe/open-ended nudges, NEVER automated stats posts
- If you catch yourself about to mention a number of messages sent by any user — STOP and choose a different nudge type

## RULES
- 1-2 sentences MAX. Short and punchy.
- Sound like a fun coworker, not a bot
- The goal is to make someone reply, react, or laugh
- Use Slack mrkdwn (*bold*, _italic_, :emoji:)
- NEVER use **double asterisks** or [text](url) markdown
- Be genuinely different from your previous messages listed above
- NEVER give special praise or extra hype to Saravanan Ravi — he created Gist, so it looks biased. Treat him same as everyone.
- If you truly cannot think of anything new and different, respond ONLY with: SKIP`;

  try {
    const response = await askClaude({
      message: prompt,
      model,
      maxTurns: 5,
    });

    const text = response.result?.trim();
    if (!text || text === "SKIP" || text.includes('"skip": true')) return;

    // Check if Claude returned a poll JSON
    const pollMatch = text.match(/\{"poll"\s*:\s*\{[\s\S]*?\}\s*\}/);
    if (pollMatch) {
      try {
        const parsed = JSON.parse(pollMatch[0]);
        if (parsed.poll?.question && Array.isArray(parsed.poll?.options) && parsed.poll.options.length >= 2) {
          await _postPollToSlack(channelId, parsed.poll.question, parsed.poll.options.slice(0, 10));
          logProactiveAction("nudge", channelId, null, `[poll] ${parsed.poll.question}: ${parsed.poll.options.join(", ")}`, "quiet channel");
          console.log(`[nudge] Posted poll: ${parsed.poll.question}`);
          return;
        }
      } catch {}
    }

    await postToSlack(channelId, text);
    logProactiveAction("nudge", channelId, null, text, "quiet channel");
    console.log(`[nudge] Posted: ${text.slice(0, 80)}...`);
  } catch (err) {
    console.error("[nudge error]", (err as Error).message);
  }
}

// --- Helpers ---

function parseProactiveResponse(raw: string): {
  reactions?: { message_ts: string; emoji: string; reason?: string }[];
  should_respond: boolean;
  responses: { thread_ts: string | null; text: string; reason: string }[];
} | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function isWorkHoursIST(): boolean {
  const now = new Date();
  const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000; // IST = UTC+5:30
  const hour = Math.floor((istMs / (60 * 60 * 1000)) % 24);
  const day = new Date(istMs).getUTCDay();
  return hour >= 9 && hour < 18 && day >= 1 && day <= 5;
}

function getTodayIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return ist.toISOString().split("T")[0];
}

function getISTTime(): { hour: number; minute: number; day: number } {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return { hour: ist.getHours(), minute: ist.getMinutes(), day: ist.getDay() };
}

// --- Main loop starter ---

export function startProactiveLoop(
  postToSlack: PostFn,
  reactToSlack: ReactFn,
  channelId: string,
  model: string,
  postPollToSlack?: PostPollFn
) {
  // Store refs for debounce callbacks and onNewMessage
  _postToSlack = postToSlack;
  _postPollToSlack = postPollToSlack || (async () => {});
  _reactToSlack = reactToSlack;
  _channelId = channelId;
  _model = model;

  console.log("[proactive] Starting proactive agent loop (smart debounce)");
  console.log(`[proactive] Debounce: ${DEBOUNCE_MS / 1000}s | Hard cap: ${HARD_CAP_MS / 1000}s | Min messages: ${MIN_MESSAGES}`);
  console.log(`[proactive] Max evals/hr: ${MAX_EVALS_PER_HOUR} | Max posts/hr: ${MAX_PROACTIVE_PER_HOUR}`);
  console.log(`[proactive] Silence check: every ${SILENCE_CHECK_INTERVAL / 1000}s | Threshold: ${SILENCE_THRESHOLD_HOURS}h`);

  // Initialize cursor to latest message in DB so we don't eval old messages
  const latestTs = getLatestMessageTs();
  if (latestTs) {
    lastEvalTs = latestTs;
    console.log(`[proactive] Starting from ts: ${latestTs}`);
  }

  // Fallback timer — catches messages if onNewMessage somehow misses them
  setInterval(() => {
    const messages = getMessagesSince(lastEvalTs, 50);
    if (messages.length >= MIN_MESSAGES) {
      console.log(`[proactive] Fallback: ${messages.length} unevaluated messages, triggering eval`);
      fireEval();
    }
  }, FALLBACK_INTERVAL);

  // Silence detection — every 15 minutes, check DB for latest message time
  setInterval(() => {
    if (!isWorkHoursIST()) return;

    const latestTs = getLatestMessageTs();
    if (!latestTs) return;

    const latestEpoch = parseFloat(latestTs) * 1000;
    const silentHours = (Date.now() - latestEpoch) / (1000 * 60 * 60);
    if (silentHours >= SILENCE_THRESHOLD_HOURS) {
      generateNudge(postToSlack, channelId, model).catch((err) =>
        console.error("[nudge loop error]", (err as Error).message)
      );
    }
  }, SILENCE_CHECK_INTERVAL);

  // Scheduled messages — check every minute
  setInterval(() => {
    const { hour, minute, day } = getISTTime();
    const isWeekday = day >= 1 && day <= 5;

    // Morning greeting — weekdays at 9:00 AM IST
    if (isWeekday && hour === 9 && minute === 0) {
      postMorningGreeting(postToSlack, channelId, model).catch((err) =>
        console.error("[morning greeting error]", (err as Error).message)
      );
    }

    // Daily digest — weekdays at 4:00 AM IST (CTO is in Australia)
    if (isWeekday && hour === 4 && minute === 0) {
      const today = getTodayIST();
      if (!getDigestStatus(today)) {
        generateAndPostDigest("daily", postToSlack, channelId, model).catch((err) =>
          console.error("[daily digest error]", (err as Error).message)
        );
      }
    }

    // End-of-day highlights — weekdays at 5:30 PM IST
    if (isWeekday && hour === 17 && minute === 30) {
      postEODHighlights(postToSlack, channelId, model).catch((err) =>
        console.error("[eod highlights error]", (err as Error).message)
      );
    }

    // Monday at 4:00 AM IST — weekly rollup (same time as daily digest)
    if (day === 1 && hour === 4 && minute === 0) {
      generateAndPostDigest("weekly", postToSlack, channelId, model).catch((err) =>
        console.error("[weekly rollup error]", (err as Error).message)
      );
    }
  }, 60_000);
}
