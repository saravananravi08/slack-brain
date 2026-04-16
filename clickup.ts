/**
 * ClickUp API client for Gist.
 *
 * Provides task queries so Gist can cross-reference sprint tickets
 * with Slack messages and memory for the complete picture.
 */

const API_BASE = "https://api.clickup.com/api/v2";
const TOKEN = process.env.CLICKUP_API_TOKEN || "";
const TEAM_ID = process.env.CLICKUP_TEAM_ID || "18616853";

// --- Types ---

export interface ClickUpTask {
  id: string;
  name: string;
  status: { status: string; color: string };
  assignees: { id: number; username: string }[];
  priority: { id: string; priority: string } | null;
  date_created: string;
  date_updated: string;
  date_due: string | null;
  description: string | null;
  text_content: string | null;
  tags: { name: string }[];
  url: string;
  list: { id: string; name: string };
  folder: { id: string; name: string };
  space: { id: string };
}

export interface ClickUpComment {
  id: string;
  comment_text: string;
  user: { username: string };
  date: string;
}

// --- Cached members ---

let memberCache: { id: number; username: string }[] | null = null;

// --- API helper ---

async function clickupGet(endpoint: string, params?: Record<string, string | string[]>): Promise<any> {
  const url = new URL(`${API_BASE}${endpoint}`);
  if (params) {
    for (const [key, val] of Object.entries(params)) {
      if (Array.isArray(val)) {
        val.forEach((v) => url.searchParams.append(key, v));
      } else {
        url.searchParams.set(key, val);
      }
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: TOKEN },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// --- Team members ---

export async function getTeamMembers(): Promise<{ id: number; username: string }[]> {
  if (memberCache) return memberCache;

  const data = await clickupGet(`/team`);
  const members: { id: number; username: string }[] = [];
  for (const team of data.teams || []) {
    for (const m of team.members || []) {
      members.push({ id: m.user.id, username: m.user.username });
    }
  }
  memberCache = members;
  return members;
}

export async function resolveAssigneeId(name: string): Promise<number | null> {
  const members = await getTeamMembers();
  const lower = name.toLowerCase();
  // Exact match first
  const exact = members.find((m) => m.username.toLowerCase() === lower);
  if (exact) return exact.id;
  // Partial match
  const partial = members.find((m) => m.username.toLowerCase().includes(lower));
  return partial?.id ?? null;
}

// --- Tasks ---

export async function getFilteredTasks(opts: {
  assignee?: string;
  statuses?: string[];
  limit?: number;
  dateUpdatedGt?: number;
}): Promise<ClickUpTask[]> {
  const params: Record<string, string | string[]> = {};

  if (opts.assignee) {
    const id = await resolveAssigneeId(opts.assignee);
    if (id) params["assignees[]"] = [String(id)];
  }

  if (opts.statuses && opts.statuses.length > 0) {
    params["statuses[]"] = opts.statuses;
  }

  if (opts.dateUpdatedGt) {
    params["date_updated_gt"] = String(opts.dateUpdatedGt);
  }

  params["subtasks"] = "true";
  params["include_closed"] = "false";
  params["order_by"] = "updated";
  params["reverse"] = "true";

  const data = await clickupGet(`/team/${TEAM_ID}/task`, params);
  const tasks: ClickUpTask[] = data.tasks || [];

  const limit = opts.limit || 20;
  return tasks.slice(0, limit);
}

export async function getTask(taskIdOrUrl: string): Promise<ClickUpTask | null> {
  const taskId = parseClickUpId(taskIdOrUrl);
  if (!taskId) return null;

  try {
    return await clickupGet(`/task/${taskId}`);
  } catch {
    return null;
  }
}

export async function getTaskComments(taskId: string): Promise<ClickUpComment[]> {
  try {
    const data = await clickupGet(`/task/${taskId}/comment`);
    return (data.comments || []).map((c: any) => ({
      id: c.id,
      comment_text: Array.isArray(c.comment_text)
        ? c.comment_text.map((seg: any) => seg.text || "").join("")
        : c.comment_text || "",
      user: { username: c.user?.username || "unknown" },
      date: new Date(parseInt(c.date)).toISOString().split("T")[0],
    }));
  } catch {
    return [];
  }
}

export async function searchTasks(query: string, assignee?: string): Promise<ClickUpTask[]> {
  // ClickUp doesn't have a search API for personal tokens,
  // so we fetch recent tasks and filter by name client-side
  const params: Record<string, string | string[]> = {
    subtasks: "true",
    include_closed: "false",
    order_by: "updated",
    reverse: "true",
  };

  if (assignee) {
    const id = await resolveAssigneeId(assignee);
    if (id) params["assignees[]"] = [String(id)];
  }

  const data = await clickupGet(`/team/${TEAM_ID}/task`, params);
  const tasks: ClickUpTask[] = data.tasks || [];

  const lower = query.toLowerCase();
  return tasks
    .filter((t) =>
      t.name.toLowerCase().includes(lower) ||
      (t.text_content || "").toLowerCase().includes(lower) ||
      t.tags.some((tag) => tag.name.toLowerCase().includes(lower))
    )
    .slice(0, 20);
}

// --- Helpers ---

function parseClickUpId(input: string): string | null {
  // Direct task ID
  if (/^[a-z0-9]+$/i.test(input) && !input.includes("/")) {
    return input;
  }
  // URL: https://app.clickup.com/t/TASK_ID
  const match1 = input.match(/clickup\.com\/t\/([a-z0-9]+)/i);
  if (match1) return match1[1];
  // URL: https://app.clickup.com/TEAM_ID/v/li/LIST_ID?pr=TASK_ID
  const match2 = input.match(/[?&]pr=([a-z0-9]+)/i);
  if (match2) return match2[1];
  // Numeric ID in URL path
  const match3 = input.match(/\/(\d{7,})\b/);
  if (match3) return match3[1];
  return null;
}

// --- Formatting ---

const PRIORITY_MAP: Record<string, string> = {
  "1": "urgent",
  "2": "high",
  "3": "normal",
  "4": "low",
};

export function formatTask(task: ClickUpTask): string {
  const assignees = task.assignees.map((a) => a.username).join(", ") || "unassigned";
  const priority = task.priority ? PRIORITY_MAP[task.priority.id] || task.priority.id : "none";
  const due = task.date_due
    ? new Date(parseInt(task.date_due)).toISOString().split("T")[0]
    : "no due date";
  const updated = new Date(parseInt(task.date_updated)).toISOString().split("T")[0];
  const tags = task.tags.length > 0 ? ` | Tags: ${task.tags.map((t) => t.name).join(", ")}` : "";
  const list = task.list?.name ? ` | List: ${task.list.name}` : "";
  const desc = task.text_content
    ? `\n  ${task.text_content.slice(0, 200).replace(/\n+/g, " ")}${task.text_content.length > 200 ? "..." : ""}`
    : "";

  return `• [${task.status.status}] ${task.name} (ID: ${task.id})
  Assignee: ${assignees} | Priority: ${priority} | Due: ${due} | Updated: ${updated}${tags}${list}
  URL: ${task.url}${desc}`;
}

export function formatComment(c: ClickUpComment): string {
  return `  💬 [${c.date}] ${c.user.username}: ${c.comment_text.slice(0, 300)}${c.comment_text.length > 300 ? "..." : ""}`;
}
