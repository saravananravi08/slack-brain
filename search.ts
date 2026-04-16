/**
 * Slack Message Search Tool
 *
 * Searches the SQLite FTS5 index of Slack messages.
 * Designed to be used as a CLI tool by Claude or humans.
 *
 * Usage:
 *   npx tsx search.ts <command> [args...]
 *
 * Commands:
 *   search <query>                    Full-text search across all messages
 *   search <query> --user <name>      Search filtered by user
 *   search <query> --from <date>      Search from date (YYYY-MM-DD)
 *   search <query> --to <date>        Search until date (YYYY-MM-DD)
 *   search <query> --limit <n>        Max results (default: 20)
 *   thread <thread_ts>                Get all messages in a thread
 *   user <name>                       Get recent messages by a user
 *   date <from> <to>                  Get messages in date range
 *   stats                             Show database statistics
 *   recent [n]                        Show n most recent messages (default: 20)
 *   summary <date>                    Get all messages for a specific date (for daily summary)
 *   clickup tasks [--assignee name] [--status "in progress"] [--limit n]
 *   clickup task <task_id_or_url>     Get single task details + comments
 *   clickup search "<query>" [--assignee name]
 *
 * Examples:
 *   npx tsx search.ts search "bug priority"
 *   npx tsx search.ts search "DSR" --from 2026-03-20
 *   npx tsx search.ts user "Sachin"
 *   npx tsx search.ts recent 10
 *   npx tsx search.ts summary 2026-03-23
 *   npx tsx search.ts clickup tasks --assignee Karan
 *   npx tsx search.ts clickup task 86cwn2g4f
 */

import {
  getDb,
  searchMessages,
  searchMessagesFallback,
  searchDocuments,
  getThread,
  getMessagesByUser,
  getMessagesByDate,
  getStats,
  closeDb,
  type MessageRow,
  type DocumentRow,
} from "./db.js";
import {
  getFilteredTasks,
  getTask,
  getTaskComments,
  searchTasks,
  formatTask,
  formatComment,
} from "./clickup.js";

function formatMessage(msg: MessageRow, includeThread = false): string {
  const prefix = msg.is_thread_reply ? "  ↳" : "•";
  const threadInfo =
    includeThread && msg.reply_count > 0
      ? ` [${msg.reply_count} replies]`
      : "";
  return `${prefix} [${msg.date}] ${msg.user_name}: ${msg.text}${threadInfo}`;
}

function formatDocument(doc: DocumentRow): string {
  const preview = doc.extracted_text
    ? doc.extracted_text.slice(0, 500).replace(/\n+/g, " ")
    : "(no text extracted)";
  return `• [${doc.date}] ${doc.user_name} shared "${doc.file_name}" (${doc.file_type || "unknown"})\n  ${doc.title ? `Title: ${doc.title}\n  ` : ""}${preview}${doc.extracted_text && doc.extracted_text.length > 500 ? "..." : ""}`;
}

function printDocResults(docs: DocumentRow[], title: string) {
  if (docs.length === 0) {
    console.log(`${title}\n\nNo documents found.`);
    return;
  }
  console.log(`${title} (${docs.length} results)\n`);
  for (const doc of docs) {
    console.log(formatDocument(doc));
    console.log();
  }
}

function printResults(messages: MessageRow[], title: string) {
  if (messages.length === 0) {
    console.log(`${title}\n\nNo results found.`);
    return;
  }
  console.log(`${title} (${messages.length} results)\n`);
  for (const msg of messages) {
    console.log(formatMessage(msg, true));
    console.log();
  }
}

function parseArgs(args: string[]): {
  command: string;
  query: string;
  flags: Record<string, string>;
} {
  const command = args[0] || "help";
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }

  return { command, query: positional.join(" "), flags };
}

async function main() {
  const { command, query, flags } = parseArgs(process.argv.slice(2));

  // Initialize DB
  getDb();

  switch (command) {
    case "search": {
      if (!query) {
        console.error("Usage: search <query> [--user name] [--from date] [--to date] [--limit n]");
        process.exit(1);
      }
      const searchOpts = {
        limit: flags.limit ? parseInt(flags.limit) : 20,
        user: flags.user,
        dateFrom: flags.from,
        dateTo: flags.to,
      };
      let results = searchMessages(query, searchOpts);
      let usedFallback = false;
      if (results.length === 0) {
        // FTS5 found nothing — try fallback LIKE search (OR logic across words)
        results = searchMessagesFallback(query, searchOpts);
        usedFallback = true;
      }
      printResults(results, `Search: "${query}"${usedFallback ? " (broad match)" : ""}`);

      // Fetch full thread context for top results
      const threadsShown = new Set<string>();
      for (const msg of results.slice(0, 8)) {
        // Determine the thread root — either this message starts a thread,
        // or it's a reply and we need the parent thread
        const threadRoot = msg.thread_ts || (msg.reply_count > 0 ? msg.ts : null);
        if (!threadRoot || threadsShown.has(threadRoot)) continue;
        threadsShown.add(threadRoot);

        const thread = getThread(threadRoot);
        if (thread.length <= 1) continue;

        // Show the parent message if it's not already in the results
        const parent = thread[0];
        console.log(`--- Thread (${thread.length} messages) started by ${parent.user_name} on ${parent.date} ---`);
        console.log(formatMessage(parent, true));
        for (const reply of thread.slice(1, 10)) {
          console.log(formatMessage(reply));
        }
        if (thread.length > 10) {
          console.log(`  ... and ${thread.length - 10} more replies`);
        }
        console.log();
      }
      break;
    }

    case "thread": {
      if (!query) {
        console.error("Usage: thread <thread_ts>");
        process.exit(1);
      }
      const thread = getThread(query);
      printResults(thread, `Thread ${query}`);
      break;
    }

    case "user": {
      if (!query) {
        console.error("Usage: user <name>");
        process.exit(1);
      }
      const limit = flags.limit ? parseInt(flags.limit) : 30;
      const messages = getMessagesByUser(query, limit);
      printResults(messages, `Messages by "${query}"`);
      break;
    }

    case "date": {
      const dateFrom = query;
      const dateTo = flags.to || query;
      if (!dateFrom) {
        console.error("Usage: date <from> [--to <to>]");
        process.exit(1);
      }
      const limit = flags.limit ? parseInt(flags.limit) : 100;
      const messages = getMessagesByDate(dateFrom, dateTo, limit);
      printResults(messages, `Messages from ${dateFrom} to ${dateTo}`);
      break;
    }

    case "recent": {
      const limit = query ? parseInt(query) : 20;
      const db = getDb();
      const messages = db
        .prepare(
          `SELECT * FROM messages WHERE is_thread_reply = 0
           ORDER BY ts DESC LIMIT ?`
        )
        .all(limit) as MessageRow[];
      printResults(messages.reverse(), `Recent messages`);
      break;
    }

    case "summary": {
      if (!query) {
        console.error("Usage: summary <date> (e.g. summary 2026-03-23)");
        process.exit(1);
      }
      const messages = getMessagesByDate(query, query, 200);
      printResults(messages.reverse(), `All messages on ${query}`);
      break;
    }

    case "stats": {
      const stats = getStats();
      console.log("Database Statistics:");
      console.log(`  Total messages: ${stats.total}`);
      console.log(`  Threads with replies: ${stats.threads}`);
      console.log(`  Unique users: ${stats.users}`);
      console.log(`  Date range: ${stats.earliest} → ${stats.latest}`);

      // Also show top users
      const db = getDb();
      const topUsers = db
        .prepare(
          `SELECT user_name, COUNT(*) as count FROM messages
           WHERE user_name IS NOT NULL
           GROUP BY user_name ORDER BY count DESC LIMIT 10`
        )
        .all() as { user_name: string; count: number }[];
      console.log(`\n  Top contributors:`);
      for (const u of topUsers) {
        console.log(`    ${u.user_name}: ${u.count} messages`);
      }
      break;
    }

    case "docs": {
      if (!query) {
        console.error("Usage: docs <query> [--user name] [--type filetype] [--limit n]");
        process.exit(1);
      }
      const docResults = searchDocuments(query, {
        limit: flags.limit ? parseInt(flags.limit) : 10,
        user: flags.user,
        fileType: flags.type,
      });
      printDocResults(docResults, `Documents: "${query}"`);
      break;
    }

    case "clickup": {
      // Subcommands: tasks, task, search
      const subArgs = process.argv.slice(3);
      const subCmd = subArgs[0] || "help";
      const { query: subQuery, flags: subFlags } = parseArgs(subArgs);

      if (subCmd === "tasks") {
        const statuses = subFlags.status ? [subFlags.status] : undefined;
        const limit = subFlags.limit ? parseInt(subFlags.limit) : 15;
        const tasks = await getFilteredTasks({
          assignee: subFlags.assignee,
          statuses,
          limit,
        });
        if (tasks.length === 0) {
          console.log("No ClickUp tasks found matching criteria.");
        } else {
          console.log(`ClickUp Tasks (${tasks.length} results)\n`);
          for (const t of tasks) {
            console.log(formatTask(t));
            console.log();
          }
        }
      } else if (subCmd === "task") {
        if (!subQuery) {
          console.error("Usage: clickup task <task_id_or_url>");
          process.exit(1);
        }
        const task = await getTask(subQuery);
        if (!task) {
          console.log(`Task not found: ${subQuery}`);
        } else {
          console.log(formatTask(task));
          const comments = await getTaskComments(task.id);
          if (comments.length > 0) {
            console.log(`\n  Comments (${comments.length}):`);
            for (const c of comments.slice(0, 10)) {
              console.log(formatComment(c));
            }
            if (comments.length > 10) {
              console.log(`  ... and ${comments.length - 10} more comments`);
            }
          }
        }
      } else if (subCmd === "search") {
        if (!subQuery) {
          console.error("Usage: clickup search <query> [--assignee name]");
          process.exit(1);
        }
        const tasks = await searchTasks(subQuery, subFlags.assignee);
        if (tasks.length === 0) {
          console.log(`No ClickUp tasks found matching "${subQuery}"`);
        } else {
          console.log(`ClickUp Search: "${subQuery}" (${tasks.length} results)\n`);
          for (const t of tasks) {
            console.log(formatTask(t));
            console.log();
          }
        }
      } else {
        console.log(`ClickUp Commands:
  clickup tasks [--assignee name] [--status "in progress"] [--limit n]
  clickup task <task_id_or_url>
  clickup search "<query>" [--assignee name]`);
      }
      break;
    }

    case "help":
    default:
      console.log(`Slack Message Search Tool

Commands:
  search <query>              Full-text search (supports AND, OR, NOT, "phrases")
  search <query> --user X     Filter by user name
  search <query> --from DATE  Filter from date (YYYY-MM-DD)
  search <query> --to DATE    Filter until date
  search <query> --limit N    Max results (default: 20)
  thread <thread_ts>          Get all replies in a thread
  user <name>                 Recent messages by a user
  date <YYYY-MM-DD>           Messages on a specific date
  recent [N]                  Most recent N messages
  summary <YYYY-MM-DD>        All messages on a date (for daily summary)
  docs <query>                Search shared files/documents
  docs <query> --type pdf     Filter by file type
  clickup tasks               ClickUp sprint tasks [--assignee name] [--status "in progress"]
  clickup task <id>           Single task details + comments
  clickup search "<query>"    Search ClickUp tasks by name
  stats                       Database statistics

Examples:
  search "bug fix"
  search "DSR" --from 2026-03-20
  search "sprint" --user "Sachin"
  user "Saravanan"
  summary 2026-03-23
  docs "meeting transcript"
  clickup tasks --assignee Karan
  recent 10`);
      break;
  }

  closeDb();
}

main().catch((err) => {
  console.error("Error:", err);
  closeDb();
  process.exit(1);
});
