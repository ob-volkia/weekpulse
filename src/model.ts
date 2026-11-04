// Task line format (compatible with the Obsidian Tasks plugin):
// - [ ] Title #tag [time:: 14:00] [dur:: 1h30m] [moved:: 2] ⏫ 🔁 every weekday ➕ 2026-11-01 📅 2026-11-04 ✅ 2026-11-04 🆔 k3j9x2
//     - [ ] subtask

import { DateStr, addDays, addMonths, weekday, DAY_SHORT } from "./dates";

export type Priority = -1 | 0 | 1 | 2 | 3;

export interface Subtask {
  done: boolean;
  text: string;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  tags: string[];
  priority: Priority;
  due: DateStr | null;
  time: string | null; // "HH:MM"
  duration: number; // minutes
  recurrence: string | null; // Tasks syntax, e.g. "every weekday"
  created: DateStr | null;
  doneDate: DateStr | null;
  moved: number;
  spent: number; // minutes actually tracked with the focus timer
  deadline: DateStr | null; // "must be done by", separate from the day it's planned for
  goal: string | null; // id of a weekly goal
  note: string | null; // vault path of the task's body note
  profile: string | null; // profile id ("work", "personal"…); null = the default profile
  subtasks: Subtask[];
  extra: string[]; // indented non-checkbox lines kept verbatim
  source?: ExternalSource; // set for tasks that live in other notes
  archivePath?: string; // set for tasks read from the archive (read-only)
}

export interface ExternalSource {
  path: string;
  line: number;
  raw: string;
}

export type Line = { kind: "raw"; text: string } | { kind: "task"; task: Task };

export interface Doc {
  lines: Line[];
}

export const PRIORITY_EMOJI: Record<Priority, string> = { 3: "🔺", 2: "⏫", 1: "🔼", 0: "", [-1]: "🔽" };
export const PRIORITY_LABEL: Record<Priority, string> = { 3: "Срочно", 2: "Высокий", 1: "Средний", 0: "Обычный", [-1]: "Низкий" };
const EMOJI_PRIORITY: Record<string, Priority> = { "🔺": 3, "⏫": 2, "🔼": 1, "🔽": -1, "⏬": -1 };

const TASK_RE = /^- \[([ xX\-])\] ?(.*)$/;
const SUB_RE = /^\s+- \[([ xX\-])\] ?(.*)$/;
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const STOP = "(?=🔺|⏫|🔼|🔽|⏬|🔁|📅|⏳|🛫|➕|✅|❌|🆔|⛔|\\[|$)";

export function newId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function emptyTask(partial: Partial<Task> = {}): Task {
  return {
    id: newId(), title: "", done: false, tags: [], priority: 0, due: null, time: null, duration: 0,
    recurrence: null, created: null, doneDate: null, moved: 0, spent: 0, deadline: null, goal: null, note: null, profile: null, subtasks: [], extra: [], ...partial,
  };
}

export function parseDuration(s: string): number {
  s = s.trim().toLowerCase().replace(",", ".");
  let min = 0;
  let matched = false;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(h|ч|час)/);
  const m = s.match(/(\d+)\s*(m|м)/);
  if (h) { min += Math.round(parseFloat(h[1]) * 60); matched = true; }
  if (m) { min += parseInt(m[1]); matched = true; }
  if (!matched && /^\d+$/.test(s)) min = parseInt(s);
  return min;
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h ? h + "h" : ""}${m ? m + "m" : ""}` || "0m";
}

export function parseTaskBody(status: string, body: string): Task {
  const t = emptyTask({ id: "", done: status.toLowerCase() === "x" });
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = body.match(re);
    if (m) body = body.replace(m[0], " ");
    return m;
  };
  let m: RegExpMatchArray | null;
  if ((m = take(new RegExp("🆔\\s*([\\w-]+)")))) t.id = m[1];
  if ((m = take(new RegExp("📅\\s*" + DATE)))) t.due = m[1];
  if ((m = take(new RegExp("✅\\s*" + DATE)))) t.doneDate = m[1];
  if ((m = take(new RegExp("➕\\s*" + DATE)))) t.created = m[1];
  if ((m = take(new RegExp("🔁\\s*(.+?)\\s*" + STOP, "u")))) t.recurrence = m[1].trim() || null;
  if ((m = take(/(🔺|⏫|🔼|🔽|⏬)/u))) t.priority = EMOJI_PRIORITY[m[1]];
  if ((m = take(/\[time::\s*(\d{1,2}:\d{2})\s*\]/))) t.time = m[1].padStart(5, "0");
  if ((m = take(/\[dur::\s*([^\]]+)\]/))) t.duration = parseDuration(m[1]);
  if ((m = take(/\[moved::\s*(\d+)\s*\]/))) t.moved = parseInt(m[1]);
  if ((m = take(/\[spent::\s*([^\]]+)\]/))) t.spent = parseDuration(m[1]);
  if ((m = take(/\[deadline::\s*(\d{4}-\d{2}-\d{2})\s*\]/))) t.deadline = m[1];
  if ((m = take(/\[goal::\s*([\w-]+)\s*\]/))) t.goal = m[1];
  if ((m = take(/\[note::\s*([^\]]+?)\s*\]/))) t.note = m[1];
  if ((m = take(/\[profile::\s*([\w-]+)\s*\]/))) t.profile = m[1];
  body = body.replace(/\s\^[\w-]+\s*$/, " "); // block id
  t.tags = [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_\/-]+)/gu)].map((x) => x[1]);
  body = body.replace(/(?:^|\s)#[\p{L}\p{N}_\/-]+/gu, " ");
  t.title = body.replace(/\s+/g, " ").trim();
  return t;
}

export function serializeTask(t: Task): string[] {
  const parts = [`- [${t.done ? "x" : " "}]`, t.title];
  for (const tag of t.tags) parts.push("#" + tag);
  if (t.time) parts.push(`[time:: ${t.time}]`);
  if (t.duration) parts.push(`[dur:: ${formatDuration(t.duration)}]`);
  if (t.moved) parts.push(`[moved:: ${t.moved}]`);
  if (t.spent) parts.push(`[spent:: ${formatDuration(t.spent)}]`);
  if (t.deadline) parts.push(`[deadline:: ${t.deadline}]`);
  if (t.goal) parts.push(`[goal:: ${t.goal}]`);
  if (t.note) parts.push(`[note:: ${t.note}]`);
  if (t.profile) parts.push(`[profile:: ${t.profile}]`);
  if (t.priority) parts.push(PRIORITY_EMOJI[t.priority]);
  if (t.recurrence) parts.push(`🔁 ${t.recurrence}`);
  if (t.created) parts.push(`➕ ${t.created}`);
  if (t.due) parts.push(`📅 ${t.due}`);
  if (t.doneDate) parts.push(`✅ ${t.doneDate}`);
  if (t.id) parts.push(`🆔 ${t.id}`);
  const out = [parts.filter(Boolean).join(" ")];
  for (const s of t.subtasks) out.push(`    - [${s.done ? "x" : " "}] ${s.text}`);
  out.push(...t.extra);
  return out;
}

export function parseDoc(text: string): Doc {
  const lines: Line[] = [];
  let current: Task | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const tm = raw.match(TASK_RE);
    if (tm) {
      current = parseTaskBody(tm[1], tm[2]);
      lines.push({ kind: "task", task: current });
      continue;
    }
    if (current && /^\s+\S/.test(raw)) {
      const sm = raw.match(SUB_RE);
      if (sm) current.subtasks.push({ done: sm[1].toLowerCase() === "x", text: sm[2].trim() });
      else current.extra.push(raw);
      continue;
    }
    current = null;
    lines.push({ kind: "raw", text: raw });
  }
  return { lines };
}

export function serializeDoc(doc: Doc): string {
  return doc.lines.flatMap((l) => (l.kind === "raw" ? [l.text] : serializeTask(l.task))).join("\n");
}

export function docTasks(doc: Doc): Task[] {
  return doc.lines.flatMap((l) => (l.kind === "task" ? [l.task] : []));
}

// ---------- recurrence ----------

const EN_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Next occurrence strictly after `from`. Returns null for an unknown rule. */
export function nextOccurrence(rule: string, from: DateStr): DateStr | null {
  const r = rule.toLowerCase().trim();
  let m: RegExpMatchArray | null;
  if (r === "every day") return addDays(from, 1);
  if ((m = r.match(/^every (\d+) days?$/))) return addDays(from, parseInt(m[1]));
  if (r === "every weekday") {
    let d = addDays(from, 1);
    while (weekday(d) > 5) d = addDays(d, 1);
    return d;
  }
  if ((m = r.match(/^every week on (.+)$/))) {
    const wanted = m[1].split(/,|\band\b/).map((s) => EN_DAYS.indexOf(s.trim()) + 1).filter((n) => n > 0);
    if (!wanted.length) return null;
    let d = addDays(from, 1);
    for (let i = 0; i < 7 && !wanted.includes(weekday(d)); i++) d = addDays(d, 1);
    return d;
  }
  if ((m = r.match(/^every (?:(\d+) )?weeks?$/))) return addDays(from, 7 * parseInt(m[1] || "1"));
  if ((m = r.match(/^every (?:(\d+) )?months?$/))) return addMonths(from, parseInt(m[1] || "1"));
  if ((m = r.match(/^every (?:(\d+) )?years?$/))) return addMonths(from, 12 * parseInt(m[1] || "1"));
  return null;
}

export function weekOnRule(days: number[]): string {
  return "every week on " + days.sort().map((d) => EN_DAYS[d - 1][0].toUpperCase() + EN_DAYS[d - 1].slice(1)).join(", ");
}

export function recurrenceLabel(rule: string): string {
  const r = rule.toLowerCase().trim();
  let m: RegExpMatchArray | null;
  if (r === "every day") return "каждый день";
  if (r === "every weekday") return "по будням";
  if ((m = r.match(/^every (\d+) days?$/))) return `каждые ${m[1]} дн.`;
  if ((m = r.match(/^every week on (.+)$/)))
    return m[1].split(/,|\band\b/).map((s) => DAY_SHORT[EN_DAYS.indexOf(s.trim())] ?? s).join(", ");
  if ((m = r.match(/^every (?:(\d+) )?weeks?$/))) return m[1] ? `каждые ${m[1]} нед.` : "каждую неделю";
  if ((m = r.match(/^every (?:(\d+) )?months?$/))) return m[1] ? `каждые ${m[1]} мес.` : "каждый месяц";
  if ((m = r.match(/^every (?:(\d+) )?years?$/))) return "каждый год";
  return rule;
}

// Display order inside a day: undone first; timed tasks by time; then file order.
export function compareInDay(a: Task, b: Task, ia: number, ib: number): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.time && b.time) return a.time.localeCompare(b.time) || ia - ib;
  if (a.time) return -1;
  if (b.time) return 1;
  return ia - ib;
}

// ---------- projects & display ----------

/** A task belongs to a project via the first [[wikilink]] in its title. */
export function projectOf(t: Task): string | null {
  const m = t.title.match(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/);
  return m ? m[1].trim() : null;
}

/** Title without [[link]] brackets, for display. */
export function displayTitle(t: Task): string {
  return t.title.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1");
}

export function isExternal(t: Task): boolean {
  return !!t.source;
}

// ---------- notes (indented lines under a task) ----------

export function taskNotes(t: Task): string {
  return t.extra.map((l) => l.replace(/^(\t| {1,4})/, "")).join("\n").trim();
}

export function setTaskNotes(t: Task, text: string) {
  t.extra = text.trim() ? text.trim().split("\n").map((l) => "    " + l) : [];
}
