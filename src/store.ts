import { App, Events, TFile, TFolder, normalizePath } from "obsidian";
import { DateStr, addDays, today, weekday } from "./dates";
import { ExternalIndex, isExternalId } from "./external";
import { Doc, Task, docTasks, emptyTask, newId, nextOccurrence, parseDoc, parseTaskBody, serializeDoc, serializeTask } from "./model";

export interface PlannerSettings {
  tasksFile: string;
  habitsFile: string;
  archiveFolder: string;
  archiveAfterDays: number;
  autoRollover: boolean;
  showDone: boolean;
  openOnStartup: boolean;
  dayCapacityHours: number;
  templatesFile: string;
  reviewsFolder: string;
  dailyFolder: string;
  scanVault: boolean;
  notifications: boolean;
  reminderMinutes: number;
  pomodoroMinutes: number;
  breakMinutes: number;
  timelineStart: number;
  timelineEnd: number;
  planningPrompt: boolean;
  lastPlannedWeek: string;
  mobileHintShown: boolean;
  navbarButton: boolean;
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  tasksFile: "Planner/Tasks.md",
  habitsFile: "Planner/Habits.md",
  archiveFolder: "Planner/Archive",
  archiveAfterDays: 30,
  autoRollover: true,
  showDone: true,
  openOnStartup: true,
  dayCapacityHours: 8,
  templatesFile: "Planner/Templates.md",
  reviewsFolder: "Planner/Reviews",
  dailyFolder: "Daily",
  scanVault: true,
  notifications: true,
  reminderMinutes: 10,
  pomodoroMinutes: 25,
  breakMinutes: 5,
  timelineStart: 7,
  timelineEnd: 23,
  planningPrompt: true,
  lastPlannedWeek: "",
  mobileHintShown: false,
  navbarButton: true,
};

export interface Template {
  name: string;
  tasks: { task: Partial<Task>; day: number | null }[];
}

export interface Habit {
  id: string;
  name: string;
  days: number[]; // ISO weekdays it is scheduled on; empty = every day
}

export interface HabitsData {
  habits: Habit[];
  log: Map<DateStr, Set<string>>;
}

const TASKS_HEADER = `# Задачи

Этот файл ведёт плагин Week Planner. Можно редактировать вручную: одна строка — одна задача.
`;

const HABITS_HEADER = "# Привычки\n";

const TEMPLATES_HEADER = `# Шаблоны

Каждый раздел «## Название» — шаблон. Строки — задачи в обычном формате.
[day:: 1] … [day:: 7] привязывает задачу к дню недели (1 — понедельник) при применении шаблона к неделе.

## Рабочий понедельник
- [ ] Планёрка #работа [time:: 10:00] [dur:: 30m] [day:: 1]
- [ ] Разобрать почту #работа [dur:: 30m] [day:: 1]
- [ ] Спланировать неделю [dur:: 15m] [day:: 1]
`;

export class Store extends Events {
  doc: Doc = { lines: [] };
  habits: HabitsData = { habits: [], log: new Map() };
  external: ExternalIndex;
  private lastWritten = new Map<string, string>();

  constructor(private app: App, public settings: PlannerSettings) {
    super();
    this.external = new ExternalIndex(app, (p) => this.isPlannerPath(p));
  }

  isPlannerPath(path: string) {
    const s = this.settings;
    return path === normalizePath(s.tasksFile) || path === normalizePath(s.habitsFile) || path === normalizePath(s.templatesFile)
      || path.startsWith(normalizePath(s.archiveFolder) + "/") || path.startsWith(normalizePath(s.reviewsFolder) + "/");
  }

  /** Tasks from Tasks.md only. */
  tasks(): Task[] {
    return docTasks(this.doc);
  }

  /** Tasks.md plus dated tasks found in other notes. */
  all(): Task[] {
    return this.settings.scanVault ? [...this.tasks(), ...this.external.all()] : this.tasks();
  }

  find(id: string): Task | undefined {
    return isExternalId(id) ? this.external.find(id) : this.tasks().find((t) => t.id === id);
  }

  /** Where a task shows up: unfinished overdue tasks from notes appear on today (we don't rewrite other notes automatically). */
  effectiveDue(t: Task): DateStr | null {
    if (t.source && !t.done && t.due && t.due < today()) return today();
    return t.due;
  }

  allTags(): string[] {
    const set = new Set<string>();
    for (const t of this.all()) t.tags.forEach((x) => set.add(x));
    return [...set].sort();
  }

  async scanExternal() {
    if (!this.settings.scanVault) return;
    await this.external.scanAll();
    this.trigger("changed");
  }

  onNoteChanged(path: string, text: string) {
    if (!this.settings.scanVault || this.isPlannerPath(path)) return;
    if (this.external.scanText(path, text)) this.trigger("changed");
  }

  onNoteDeleted(path: string) {
    if (this.external.remove(path)) this.trigger("changed");
  }

  // ---------- files ----------

  private async ensureFile(path: string, initial: string): Promise<TFile> {
    path = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    return this.app.vault.create(path, initial);
  }

  async init() {
    await this.loadTasks();
    await this.loadHabits();
  }

  async loadTasks() {
    const file = await this.ensureFile(this.settings.tasksFile, TASKS_HEADER);
    const text = await this.app.vault.read(file);
    this.doc = parseDoc(text);
    // Tasks typed by hand have no id yet: give them one so drag & drop can address them.
    if (this.tasks().some((t) => !t.id)) await this.mutate(() => {});
    else this.trigger("changed");
  }

  async loadHabits() {
    const file = await this.ensureFile(this.settings.habitsFile, HABITS_HEADER + "\n## Список\n\n## Журнал\n");
    this.habits = parseHabits(await this.app.vault.read(file));
    this.trigger("changed");
  }

  /** Called on vault "modify": reload when the change did not come from us (other device, manual edit). */
  async onFileModified(file: TFile) {
    const path = file.path;
    if (path !== normalizePath(this.settings.tasksFile) && path !== normalizePath(this.settings.habitsFile)) return;
    const text = await this.app.vault.read(file);
    if (this.lastWritten.get(path) === text) return;
    if (path === normalizePath(this.settings.tasksFile)) {
      this.doc = parseDoc(text);
      if (this.tasks().some((t) => !t.id)) await this.mutate(() => {});
      else this.trigger("changed");
    } else {
      this.habits = parseHabits(text);
      this.trigger("changed");
    }
  }

  /** Read-modify-write against the current file contents, so edits from other devices aren't clobbered. */
  async mutate(fn: (doc: Doc) => void) {
    const file = await this.ensureFile(this.settings.tasksFile, TASKS_HEADER);
    let result: Doc = this.doc;
    await this.app.vault.process(file, (data) => {
      result = parseDoc(data);
      fn(result);
      for (const t of docTasks(result)) if (!t.id) t.id = newId();
      const out = serializeDoc(result);
      this.lastWritten.set(file.path, out);
      return out;
    });
    this.doc = result;
    this.trigger("changed");
  }

  async mutateHabits(fn: (h: HabitsData) => void) {
    const file = await this.ensureFile(this.settings.habitsFile, HABITS_HEADER);
    let result = this.habits;
    await this.app.vault.process(file, (data) => {
      result = parseHabits(data);
      fn(result);
      const out = serializeHabits(result);
      this.lastWritten.set(file.path, out);
      return out;
    });
    this.habits = result;
    this.trigger("changed");
  }

  // ---------- task operations ----------

  async add(partial: Partial<Task>, due: DateStr | null) {
    const task = emptyTask({ ...partial, due, created: today() });
    await this.mutate((doc) => {
      const idx = insertIndexForDay(doc, due);
      doc.lines.splice(idx, 0, { kind: "task", task });
    });
    return task;
  }

  async update(id: string, patch: Partial<Task>) {
    if (isExternalId(id)) {
      const t = this.external.find(id);
      if (t && "due" in patch) await this.external.setDue(t, patch.due ?? null);
      return;
    }
    await this.mutate((doc) => {
      const t = docTasks(doc).find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
  }

  async remove(id: string) {
    if (isExternalId(id)) return;
    await this.mutate((doc) => {
      doc.lines = doc.lines.filter((l) => !(l.kind === "task" && l.task.id === id));
    });
  }

  async toggle(id: string) {
    if (isExternalId(id)) {
      const t = this.external.find(id);
      if (t) await this.external.toggle(t);
      return;
    }
    await this.mutate((doc) => {
      const idx = doc.lines.findIndex((l) => l.kind === "task" && l.task.id === id);
      if (idx < 0) return;
      const t = (doc.lines[idx] as { task: Task }).task;
      if (t.done) {
        t.done = false;
        t.doneDate = null;
        return;
      }
      t.done = true;
      t.doneDate = today();
      if (t.recurrence) {
        const next = nextOccurrence(t.recurrence, t.due ?? today());
        if (next) {
          const clone: Task = {
            ...t, id: newId(), done: false, doneDate: null, due: next, moved: 0, created: today(),
            subtasks: t.subtasks.map((s) => ({ ...s, done: false })), extra: [...t.extra],
          };
          // The finished instance no longer recurs; the new one carries the rule.
          t.recurrence = null;
          doc.lines.splice(idx, 0, { kind: "task", task: clone });
        }
      }
    });
  }

  /** Move a task to `due` (null = backlog), placing it before `beforeId` or at the end of that day. */
  async move(id: string, due: DateStr | null, beforeId: string | null, patch: Partial<Task> = {}) {
    if (isExternalId(id)) {
      const t = this.external.find(id);
      if (t && t.due !== due) await this.external.setDue(t, due);
      return;
    }
    if (beforeId && isExternalId(beforeId)) beforeId = null;
    await this.mutate((doc) => {
      const idx = doc.lines.findIndex((l) => l.kind === "task" && l.task.id === id);
      if (idx < 0) return;
      const [line] = doc.lines.splice(idx, 1);
      const t = (line as { task: Task }).task;
      if (t.due !== due) {
        // Pushing an unfinished task later counts as a reschedule.
        if (!t.done && t.due && due && due > t.due && t.due <= today()) t.moved += 1;
        t.due = due;
      }
      Object.assign(t, patch);
      let at = beforeId ? doc.lines.findIndex((l) => l.kind === "task" && l.task.id === beforeId) : -1;
      if (at < 0) at = insertIndexForDay(doc, due);
      doc.lines.splice(at, 0, line);
    });
  }

  async addMany(items: { task: Partial<Task>; due: DateStr | null }[]) {
    await this.mutate((doc) => {
      for (const it of items) {
        const task = emptyTask({ ...it.task, id: newId(), due: it.due, created: today() });
        doc.lines.splice(insertIndexForDay(doc, it.due), 0, { kind: "task", task });
      }
    });
  }

  async addSpent(id: string, minutes: number) {
    if (isExternalId(id) || minutes <= 0) return;
    await this.mutate((doc) => {
      const t = docTasks(doc).find((x) => x.id === id);
      if (t) t.spent += minutes;
    });
  }

  // ---------- templates ----------
  // Templates.md: "## Name" followed by task lines; [day:: 1-7] pins a task to a weekday.

  async loadTemplates(): Promise<Template[]> {
    const file = await this.ensureFile(this.settings.templatesFile, TEMPLATES_HEADER);
    const out: Template[] = [];
    let cur: Template | null = null;
    for (const line of (await this.app.vault.read(file)).split(/\r?\n/)) {
      const h = line.match(/^##\s+(.+)$/);
      if (h) {
        cur = { name: h[1].trim(), tasks: [] };
        out.push(cur);
        continue;
      }
      const m = line.match(/^- \[[ xX]\] (.*)$/);
      if (!m || !cur) continue;
      let body = m[1];
      let day: number | null = null;
      const dm = body.match(/\[day::\s*(\d)\s*\]/);
      if (dm) {
        day = parseInt(dm[1]);
        body = body.replace(dm[0], " ");
      }
      const t = parseTaskBody(" ", body);
      const { id, due, created, doneDate, done, ...rest } = t;
      void id; void due; void created; void doneDate; void done;
      cur.tasks.push({ task: rest, day });
    }
    return out;
  }

  async applyTemplate(tpl: Template, weekStart: DateStr, day: DateStr | null) {
    await this.addMany(tpl.tasks.map((x) => ({
      task: x.task,
      due: day ?? (x.day ? addDays(weekStart, x.day - 1) : weekStart),
    })));
  }

  async saveTemplate(name: string, tasks: Task[], withDays: boolean) {
    const file = await this.ensureFile(this.settings.templatesFile, TEMPLATES_HEADER);
    const lines = tasks.filter((t) => !t.source).map((t) => {
      const clean: Task = { ...t, id: "", done: false, due: null, doneDate: null, created: null, moved: 0, spent: 0 };
      let line = serializeTask(clean)[0];
      if (withDays && t.due) line += ` [day:: ${weekday(t.due)}]`;
      return line;
    });
    await this.app.vault.process(file, (data) => data.replace(/\n*$/, "\n") + `\n## ${name}\n` + lines.join("\n") + "\n");
  }

  async toggleSubtask(id: string, i: number) {
    await this.mutate((doc) => {
      const t = docTasks(doc).find((x) => x.id === id);
      if (t?.subtasks[i]) t.subtasks[i].done = !t.subtasks[i].done;
    });
  }

  /** Unfinished past tasks move to today; recurring ones jump to their next occurrence. Returns how many moved. */
  async rollover(): Promise<number> {
    const now = today();
    if (!this.tasks().some((t) => !t.done && t.due && t.due < now)) return 0;
    let count = 0;
    await this.mutate((doc) => {
      for (const t of docTasks(doc)) {
        if (t.done || !t.due || t.due >= now) continue;
        if (t.recurrence) {
          let d: DateStr | null = t.due;
          for (let i = 0; i < 1000 && d && d < now; i++) d = nextOccurrence(t.recurrence, d);
          t.due = d && d >= now ? d : now;
        } else {
          t.due = now;
          t.moved += 1;
        }
        count++;
      }
    });
    return count;
  }

  /** Move tasks finished more than N days ago into Archive/YYYY-MM.md. */
  async archiveOld(): Promise<number> {
    const cutoff = addDays(today(), -this.settings.archiveAfterDays);
    const old = this.tasks().filter((t) => t.done && t.doneDate && t.doneDate < cutoff);
    if (!old.length) return 0;
    const byMonth = new Map<string, Task[]>();
    for (const t of old) {
      const key = t.doneDate!.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), t]);
    }
    for (const [month, list] of byMonth) {
      const path = `${this.settings.archiveFolder}/${month}.md`;
      const file = await this.ensureFile(path, `# Архив ${month}\n\n`);
      await this.app.vault.process(file, (data) => data.replace(/\n*$/, "\n") + list.flatMap(serializeTask).join("\n") + "\n");
    }
    const ids = new Set(old.map((t) => t.id));
    await this.mutate((doc) => {
      doc.lines = doc.lines.filter((l) => !(l.kind === "task" && ids.has(l.task.id)));
    });
    return old.length;
  }

  async loadArchive(): Promise<Task[]> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.archiveFolder));
    if (!(folder instanceof TFolder)) return [];
    const out: Task[] = [];
    for (const f of folder.children) {
      if (f instanceof TFile && f.extension === "md") out.push(...docTasks(parseDoc(await this.app.vault.cachedRead(f))));
    }
    return out;
  }

  // ---------- habits ----------

  isHabitDue(h: Habit, d: DateStr) {
    return !h.days.length || h.days.includes(weekday(d));
  }

  async toggleHabit(habitId: string, d: DateStr) {
    await this.mutateHabits((h) => {
      const set = h.log.get(d) ?? new Set<string>();
      if (set.has(habitId)) set.delete(habitId);
      else set.add(habitId);
      if (set.size) h.log.set(d, set);
      else h.log.delete(d);
    });
  }

  streak(h: Habit): { current: number; best: number } {
    let current = 0;
    let best = 0;
    let run = 0;
    const dates = [...this.habits.log.keys()].filter((d) => this.habits.log.get(d)!.has(h.id)).sort();
    if (!dates.length) return { current: 0, best: 0 };
    // Walk scheduled days from the first log entry to today.
    const now = today();
    for (let d = dates[0]; d <= now; d = addDays(d, 1)) {
      if (!this.isHabitDue(h, d)) continue;
      const done = this.habits.log.get(d)?.has(h.id);
      if (done) run++;
      else if (d !== now) run = 0; // today isn't over yet
      best = Math.max(best, run);
    }
    current = run;
    return { current, best };
  }
}

function insertIndexForDay(doc: Doc, due: DateStr | null): number {
  let last = -1;
  let lastTask = -1;
  doc.lines.forEach((l, i) => {
    if (l.kind !== "task") return;
    lastTask = i;
    if (l.task.due === due) last = i;
  });
  if (last >= 0) return last + 1;
  if (lastTask >= 0) return lastTask + 1;
  // No tasks yet: append after the header, dropping trailing blank lines.
  let end = doc.lines.length;
  while (end > 0 && doc.lines[end - 1].kind === "raw" && !(doc.lines[end - 1] as { text: string }).text.trim()) end--;
  doc.lines.splice(end, doc.lines.length - end, { kind: "raw", text: "" });
  return end + 1;
}

// Habits.md:
// ## Список
// - 💧 Пить воду [days:: 1,3,5] 🆔 water
// ## Журнал
// - 2026-11-03: water, run
export function parseHabits(text: string): HabitsData {
  const data: HabitsData = { habits: [], log: new Map() };
  for (const line of text.split(/\r?\n/)) {
    const lm = line.match(/^- (\d{4}-\d{2}-\d{2}):\s*(.*)$/);
    if (lm) {
      const ids = lm[2].split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length) data.log.set(lm[1], new Set(ids));
      continue;
    }
    const hm = line.match(/^- (.+?)\s*🆔\s*([\w-]+)\s*$/u);
    if (hm) {
      let name = hm[1];
      let days: number[] = [];
      const dm = name.match(/\[days::\s*([\d,\s]+)\]/);
      if (dm) {
        days = dm[1].split(",").map((x) => parseInt(x)).filter((n) => n >= 1 && n <= 7);
        name = name.replace(dm[0], "").trim();
      }
      data.habits.push({ id: hm[2], name, days });
    }
  }
  return data;
}

export function serializeHabits(h: HabitsData): string {
  const out = [HABITS_HEADER, "## Список", ""];
  for (const x of h.habits) out.push(`- ${x.name}${x.days.length ? ` [days:: ${x.days.join(",")}]` : ""} 🆔 ${x.id}`);
  out.push("", "## Журнал", "");
  for (const d of [...h.log.keys()].sort().reverse()) out.push(`- ${d}: ${[...h.log.get(d)!].join(", ")}`);
  return out.join("\n") + "\n";
}
