import { App, Events, TFile, TFolder, normalizePath } from "obsidian";
import { DateStr, addDays, humanDay, isoWeek, today, weekday } from "./dates";
import { ExternalIndex, isExternalId } from "./external";
import { CalEvent, expandEvents } from "./ics";
import { mergeGoals, mergeHabits, mergeTasks } from "./merge";
import { LogEntry, parseLog, serializeLog } from "./changelog";
import { nowStamp } from "./tasknotes";
import { NoteMeta, TaskBody, emptyBody, isEmptyBody, metaOf, parseBody, safeName, serializeBody } from "./tasknotes";
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
  simpleNavbar: boolean; // hide back / forward / quick switcher / new tab in the phone bottom bar
  goalsFile: string;
  backupsFolder: string;
  backupDays: number;
  calendars: string[]; // ICS links
  savedFilters: SavedFilter[];
  taskNotesFolder: string;
  attachmentsFolder: string;
  logFolder: string;
  profiles: Profile[];
  defaultProfile: string; // tasks without [profile::] belong here
}

export interface Profile {
  id: string;
  name: string;
  color: string; // one of the theme colors: blue, green, purple, orange, cyan, pink, yellow, red
}

export interface SavedFilter {
  name: string;
  tag: string | null;
  minPriority: number | null;
  goal: string | null;
}

export interface Goal {
  id: string;
  title: string;
  done: boolean;
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
  simpleNavbar: true,
  goalsFile: "Planner/Goals.md",
  backupsFolder: "Planner/Backups",
  backupDays: 30,
  calendars: [],
  savedFilters: [],
  taskNotesFolder: "Planner/Tasks",
  attachmentsFolder: "Planner/Attachments",
  logFolder: "Planner/Log",
  profiles: [
    { id: "work", name: "Работа", color: "blue" },
    { id: "personal", name: "Личное", color: "green" },
  ],
  defaultProfile: "personal",
};

export const ALL_PROFILES = "all";

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

Этот файл ведёт плагин Weekpulse. Можно редактировать вручную: одна строка — одна задача.
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
  goals = new Map<string, Goal[]>(); // week key ("2026-W45") -> goals
  feeds: string[] = []; // raw ICS texts, index = calendar
  noteMeta = new Map<string, NoteMeta>(); // task body note path -> counts for card badges
  private eventCache = new Map<string, CalEvent[]>(); // month "2026-11" -> events
  private lastWritten = new Map<string, string>(); // our latest write per file
  private base = new Map<string, string>(); // last version we shared with other devices
  device = "Устройство"; // set by the plugin: "Mac", "iPhone"…
  profile: string = ALL_PROFILES; // active profile on this device
  private logQueue: Promise<void> = Promise.resolve();
  private undoStack: { label: string; path: string; text: string }[] = [];

  constructor(private app: App, public settings: PlannerSettings) {
    super();
    this.external = new ExternalIndex(app, (p) => this.isPlannerPath(p));
  }

  isPlannerPath(path: string) {
    const s = this.settings;
    return path === normalizePath(s.tasksFile) || path === normalizePath(s.habitsFile) || path === normalizePath(s.templatesFile)
      || path === normalizePath(s.goalsFile)
      || [s.archiveFolder, s.reviewsFolder, s.backupsFolder, s.taskNotesFolder, s.attachmentsFolder, s.logFolder].some((f) => path.startsWith(normalizePath(f) + "/"));
  }

  /** Tasks from Tasks.md only. */
  tasks(): Task[] {
    return docTasks(this.doc);
  }

  /** Tasks.md plus dated tasks found in other notes. */
  all(): Task[] {
    return this.settings.scanVault ? [...this.tasks(), ...this.external.all()] : this.tasks();
  }

  profileOf(t: Task): string {
    const id = t.profile ?? this.settings.defaultProfile;
    return this.settings.profiles.some((p) => p.id === id) ? id : this.settings.defaultProfile;
  }

  profileInfo(id: string): Profile | undefined {
    return this.settings.profiles.find((p) => p.id === id);
  }

  inProfile(t: Task): boolean {
    return this.profile === ALL_PROFILES || this.profileOf(t) === this.profile;
  }

  /** Tasks of the active profile (all profiles when «Всё» is selected). */
  shown(): Task[] {
    return this.all().filter((t) => this.inProfile(t));
  }

  /** Profile a new task should get: the active one, or the default under «Всё». */
  newTaskProfile(): string | null {
    return this.profile === ALL_PROFILES ? this.settings.defaultProfile : this.profile;
  }

  setProfile(id: string) {
    this.profile = id;
    this.trigger("changed");
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
    if (this.inNotesFolder(path)) {
      this.noteMeta.set(path, metaOf(parseBody(text)));
      this.trigger("changed");
      return;
    }
    if (!this.settings.scanVault || this.isPlannerPath(path)) return;
    if (this.external.scanText(path, text)) this.trigger("changed");
  }

  setFeeds(feeds: string[]) {
    this.feeds = feeds;
    this.eventCache.clear();
    this.trigger("changed");
  }

  eventsOn(day: DateStr): CalEvent[] {
    if (!this.feeds.length) return [];
    const month = day.slice(0, 7);
    let list = this.eventCache.get(month);
    if (!list) {
      list = expandEvents(this.feeds, `${month}-01`, `${month}-31`);
      this.eventCache.set(month, list);
    }
    return list.filter((e) => e.date === day);
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
    await this.loadGoals();
    await this.loadNoteMeta();
  }

  // ---------- task body notes ----------

  private inNotesFolder(path: string) {
    return path.startsWith(normalizePath(this.settings.taskNotesFolder) + "/");
  }

  async loadNoteMeta() {
    this.noteMeta.clear();
    for (const f of this.app.vault.getMarkdownFiles())
      if (this.inNotesFolder(f.path)) this.noteMeta.set(f.path, metaOf(parseBody(await this.app.vault.cachedRead(f))));
    this.trigger("changed");
  }

  async readBody(t: Task): Promise<TaskBody> {
    if (t.note) {
      const f = this.app.vault.getAbstractFileByPath(t.note);
      if (f instanceof TFile) return parseBody(await this.app.vault.read(f));
    }
    // v2.3 kept notes as indented lines under the task: show them as the description.
    const body = emptyBody();
    body.description = t.extra.map((l) => l.replace(/^(\t| {1,4})/, "")).join("\n").trim();
    return body;
  }

  /** Write the body note (created on first content) and link it from the task. */
  async saveBody(taskId: string, title: string, body: TaskBody) {
    const t = this.find(taskId);
    if (!t || t.source) return;
    if (!t.note && isEmptyBody(body)) {
      if (t.extra.length) await this.update(taskId, { extra: [] });
      return;
    }
    let path = t.note;
    if (!path) {
      const folder = normalizePath(this.settings.taskNotesFolder);
      path = `${folder}/${safeName(title)}.md`;
      if (this.app.vault.getAbstractFileByPath(path)) path = `${folder}/${safeName(title)} ${taskId}.md`;
    }
    const text = serializeBody(taskId, title, body);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.vault.process(file, () => text);
    else await this.ensureFile(path, text);
    this.noteMeta.set(path, metaOf(body));
    if (t.note !== path || t.extra.length) await this.update(taskId, { note: path, extra: [] });
    else this.trigger("changed");
  }

  async attach(taskId: string, name: string, data: ArrayBuffer): Promise<string> {
    const folder = normalizePath(this.settings.attachmentsFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const dot = name.lastIndexOf(".");
    const base = safeName(dot > 0 ? name.slice(0, dot) : name);
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
    let path = `${folder}/${taskId}-${base}${ext}`;
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = `${folder}/${taskId}-${base}-${i}${ext}`;
    await this.app.vault.createBinary(path, data);
    return path;
  }

  /** Files in the attachments folder that no task note or other note embeds or links. */
  async findUnusedAttachments(): Promise<TFile[]> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.attachmentsFolder));
    if (!(folder instanceof TFolder)) return [];
    const used = new Set<string>();
    for (const f of this.app.vault.getMarkdownFiles())
      if (this.inNotesFolder(f.path)) parseBody(await this.app.vault.cachedRead(f)).files.forEach((x) => used.add(x));
    const links = (this.app.metadataCache as unknown as { resolvedLinks?: Record<string, Record<string, number>> }).resolvedLinks ?? {};
    for (const targets of Object.values(links)) for (const t of Object.keys(targets)) used.add(t);
    const out: TFile[] = [];
    const walk = (dir: TFolder) => {
      for (const c of dir.children) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && !used.has(c.path)) out.push(c);
      }
    };
    walk(folder);
    return out;
  }

  metaFor(t: Task): NoteMeta | null {
    return t.note ? this.noteMeta.get(t.note) ?? null : null;
  }

  async loadGoals() {
    const file = await this.ensureFile(this.settings.goalsFile, GOALS_HEADER);
    const text = await this.app.vault.read(file);
    this.base.set(file.path, text);
    this.goals = parseGoals(text);
    this.trigger("changed");
  }

  async loadTasks() {
    const file = await this.ensureFile(this.settings.tasksFile, TASKS_HEADER);
    const text = await this.app.vault.read(file);
    this.base.set(file.path, text);
    this.doc = parseDoc(text);
    // Tasks typed by hand have no id yet: give them one so drag & drop can address them.
    if (this.tasks().some((t) => !t.id)) await this.mutate(() => {});
    else this.trigger("changed");
  }

  async loadHabits() {
    const file = await this.ensureFile(this.settings.habitsFile, HABITS_HEADER + "\n## Список\n\n## Журнал\n");
    const htext = await this.app.vault.read(file);
    this.base.set(file.path, htext);
    this.habits = parseHabits(htext);
    this.trigger("changed");
  }

  /** Called on vault "modify": reload when the change did not come from us (other device, manual edit). */
  async onFileModified(file: TFile) {
    const path = file.path;
    const s = this.settings;
    if (![s.tasksFile, s.habitsFile, s.goalsFile].map(normalizePath).includes(path)) {
      if (this.isConflictCopy(path)) this.trigger("conflict", path);
      return;
    }
    const theirs = await this.app.vault.read(file);
    const ours = this.lastWritten.get(path);
    if (ours === theirs) return; // our own write coming back
    const base = this.base.get(path);
    let result = theirs;
    // We changed the file since we last shared it: replay our edits on top of theirs.
    if (ours !== undefined && base !== undefined && ours !== base) {
      if (path === normalizePath(s.tasksFile)) {
        const m = mergeTasks(base, ours, theirs);
        result = m.text;
        if (m.stats.added + m.stats.removed + m.stats.changed) this.logAction("Объединено с другим устройством", `задач: ${m.stats.added + m.stats.changed + m.stats.removed}`);
        if (m.stats.added + m.stats.removed + m.stats.changed)
          this.trigger("merged", `Задачи с другого устройства объединены с твоими правками (${m.stats.added + m.stats.changed + m.stats.removed})`);
      } else if (path === normalizePath(s.habitsFile)) {
        result = serializeHabits(mergeHabits(parseHabits(base), parseHabits(ours), parseHabits(theirs)));
      } else {
        result = serializeGoals(mergeGoals(parseGoals(base), parseGoals(ours), parseGoals(theirs)));
      }
    }
    this.base.set(path, theirs);
    if (result !== theirs) {
      await this.app.vault.process(file, () => result);
      this.lastWritten.set(path, result);
    } else {
      this.lastWritten.delete(path);
    }
    if (path === normalizePath(s.goalsFile)) this.goals = parseGoals(result);
    else if (path === normalizePath(s.habitsFile)) this.habits = parseHabits(result);
    else {
      this.doc = parseDoc(result);
      if (this.tasks().some((t) => !t.id)) return void (await this.mutate(() => {}));
    }
    this.trigger("changed");
  }


  /** Read-modify-write against the current file contents, so edits from other devices aren't clobbered. */
  async mutate(fn: (doc: Doc) => void, undoLabel?: string) {
    const file = await this.ensureFile(this.settings.tasksFile, TASKS_HEADER);
    let result: Doc = this.doc;
    await this.app.vault.process(file, (data) => {
      if (undoLabel) this.pushUndo(undoLabel, file.path, data);
      result = parseDoc(data);
      fn(result);
      for (const t of docTasks(result)) if (!t.id) t.id = newId();
      const out = serializeDoc(result);
      this.lastWritten.set(file.path, out);
      return out;
    });
    this.doc = result;
    this.trigger("changed");
    if (undoLabel) this.trigger("undoable", undoLabel);
  }

  private pushUndo(label: string, path: string, text: string) {
    this.undoStack.push({ label, path, text });
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  /** Put the file back as it was before the last undoable action. Returns that action's label. */
  async undo(): Promise<string | null> {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) return null;
    await this.app.vault.process(file, () => {
      this.lastWritten.set(entry.path, entry.text);
      return entry.text;
    });
    if (entry.path === normalizePath(this.settings.tasksFile)) this.doc = parseDoc(entry.text);
    else if (entry.path === normalizePath(this.settings.habitsFile)) this.habits = parseHabits(entry.text);
    else if (entry.path === normalizePath(this.settings.goalsFile)) this.goals = parseGoals(entry.text);
    this.trigger("changed");
    this.logAction("Отменено", entry.label);
    return entry.label;
  }

  async mutateHabits(fn: (h: HabitsData) => void, undoLabel?: string) {
    const file = await this.ensureFile(this.settings.habitsFile, HABITS_HEADER);
    let result = this.habits;
    await this.app.vault.process(file, (data) => {
      if (undoLabel) this.pushUndo(undoLabel, file.path, data);
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
    const task = emptyTask({ profile: this.newTaskProfile(), ...partial, due, created: today() });
    await this.mutate((doc) => {
      const idx = insertIndexForDay(doc, due);
      doc.lines.splice(idx, 0, { kind: "task", task });
    });
    this.logAction("Добавлена", task.title);
    return task;
  }

  async update(id: string, patch: Partial<Task>) {
    if (isExternalId(id)) {
      const t = this.external.find(id);
      if (t && "due" in patch) await this.external.setDue(t, patch.due ?? null);
      return;
    }
    const before = this.find(id);
    await this.mutate((doc) => {
      const t = docTasks(doc).find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
    const after = this.find(id);
    if (before && after && serializeTask(before).join("\n") !== serializeTask(after).join("\n")) this.logAction("Изменена", after.title);
  }

  async remove(id: string) {
    if (isExternalId(id)) return;
    const gone = this.find(id);
    if (gone) this.logAction("Удалена", gone.title, serializeTask(gone));
    await this.mutate((doc) => {
      doc.lines = doc.lines.filter((l) => !(l.kind === "task" && l.task.id === id));
    }, "Задача удалена");
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
    }, this.find(id)?.done ? "Задача возвращена в работу" : "Задача выполнена");
    const t = this.find(id);
    if (t) this.logAction(t.done ? "Выполнена" : "Возвращена", t.title);
  }

  /** Move a task to `due` (null = backlog), placing it before `beforeId` or at the end of that day. */
  async move(id: string, due: DateStr | null, beforeId: string | null, patch: Partial<Task> = {}) {
    if (isExternalId(id)) {
      const t = this.external.find(id);
      if (t && t.due !== due) await this.external.setDue(t, due);
      return;
    }
    if (beforeId && isExternalId(beforeId)) beforeId = null;
    const fromDue = this.find(id)?.due;
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
    }, this.find(id)?.due === due ? undefined : `Перенесено: ${due ? humanDay(due) : "бэклог"}`);
    this.moveLog(id, fromDue, due);
  }

  private moveLog(id: string, from: DateStr | null | undefined, due: DateStr | null) {
    const t = this.find(id);
    if (t && from !== due) this.logAction(`Перенесена → ${due ? humanDay(due) : "бэклог"}`, t.title);
  }

  // ---------- bulk (multi-select) ----------

  async bulk(ids: string[], op: "done" | "remove" | { due: DateStr | null }) {
    const own = ids.filter((id) => !isExternalId(id));
    for (const id of ids.filter(isExternalId)) {
      if (op === "done") await this.toggle(id);
      else if (op !== "remove") await this.move(id, op.due, null);
    }
    if (!own.length) return;
    const set = new Set(own);
    const removed = op === "remove" ? own.map((id) => this.find(id)).filter((t): t is Task => !!t) : [];
    const label = op === "done" ? `Выполнено задач: ${own.length}` : op === "remove" ? `Удалено задач: ${own.length}` : `Перенесено задач: ${own.length}`;
    await this.mutate((doc) => {
      if (op === "remove") {
        doc.lines = doc.lines.filter((l) => !(l.kind === "task" && set.has(l.task.id)));
        return;
      }
      for (const t of docTasks(doc)) {
        if (!set.has(t.id)) continue;
        if (op === "done") {
          if (!t.done) { t.done = true; t.doneDate = today(); }
        } else if (t.due !== op.due) {
          if (!t.done && t.due && op.due && op.due > t.due && t.due <= today()) t.moved += 1;
          t.due = op.due;
        }
      }
    }, label);
    this.logAction(label.replace(/:.*$/, ""), String(op === "remove" ? removed.length : own.length), removed.flatMap(serializeTask));
  }

  async addMany(items: { task: Partial<Task>; due: DateStr | null }[]) {
    await this.mutate((doc) => {
      for (const it of items) {
        const task = emptyTask({ profile: this.newTaskProfile(), ...it.task, id: newId(), due: it.due, created: today() });
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

  // ---------- change log ----------

  private logPath(device = this.device) {
    return `${normalizePath(this.settings.logFolder)}/${device}.md`;
  }

  /** Append an entry to this device's log (serialized, never throws). */
  logAction(action: string, title: string, lines: string[] = []) {
    const entry: LogEntry = { at: nowStamp(), action, title, lines, device: this.device };
    this.logQueue = this.logQueue.then(async () => {
      try {
        const path = this.logPath();
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.app.vault.process(file, (data) => serializeLog(this.device, [entry, ...parseLog(data, this.device)]));
        else await this.ensureFile(path, serializeLog(this.device, [entry]));
      } catch (e) {
        console.error("Weekpulse: log write failed", e);
      }
    });
  }

  /** Entries from every device, newest first. */
  async readLog(): Promise<LogEntry[]> {
    await this.logQueue;
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.logFolder));
    if (!(folder instanceof TFolder)) return [];
    const out: LogEntry[] = [];
    for (const f of folder.children)
      if (f instanceof TFile && f.extension === "md") out.push(...parseLog(await this.app.vault.cachedRead(f), f.basename));
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Put task lines from a log entry back into Tasks.md (skips tasks that already exist). */
  async restoreLines(lines: string[]): Promise<number> {
    const tasks = docTasks(parseDoc(lines.join("\n")));
    const existing = new Set(this.tasks().map((t) => t.id));
    const back = tasks.filter((t) => !existing.has(t.id));
    if (!back.length) return 0;
    await this.mutate((doc) => {
      for (const t of back) doc.lines.splice(insertIndexForDay(doc, t.due), 0, { kind: "task", task: t });
    }, `Возвращено задач: ${back.length}`);
    this.logAction("Возвращена из журнала", back.map((t) => t.title).join(", "));
    return back.length;
  }

  // ---------- backups ----------
  // Planner/Backups/2026-11-03 Tasks.md (+ Habits, Goals), one set per day, last N days kept.

  private backupSources() {
    const s = this.settings;
    return [s.tasksFile, s.habitsFile, s.goalsFile].map(normalizePath);
  }

  async backup(force = false): Promise<boolean> {
    const folder = normalizePath(this.settings.backupsFolder);
    const day = today();
    const stamp = force ? `${day} ${new Date().toTimeString().slice(0, 5).replace(":", "-")}` : day;
    let made = false;
    for (const src of this.backupSources()) {
      const file = this.app.vault.getAbstractFileByPath(src);
      if (!(file instanceof TFile)) continue;
      const target = `${folder}/${stamp} ${file.name}`;
      if (this.app.vault.getAbstractFileByPath(target)) continue;
      await this.ensureFile(target, await this.app.vault.read(file));
      made = true;
    }
    await this.pruneBackups();
    return made;
  }

  async listBackups(): Promise<string[]> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.backupsFolder));
    if (!(folder instanceof TFolder)) return [];
    const stamps = new Set<string>();
    for (const f of folder.children) {
      const m = f.name.match(/^(\d{4}-\d{2}-\d{2}(?: \d{2}-\d{2})?) /);
      if (m && f instanceof TFile) stamps.add(m[1]);
    }
    return [...stamps].sort().reverse();
  }

  private async pruneBackups() {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.backupsFolder));
    if (!(folder instanceof TFolder)) return;
    const cutoff = addDays(today(), -this.settings.backupDays);
    for (const f of [...folder.children]) {
      const m = f.name.match(/^(\d{4}-\d{2}-\d{2})/);
      if (f instanceof TFile && m && m[1] < cutoff) await this.app.vault.delete(f);
    }
  }

  /** Restore all planner files from a backup set (the current state is backed up first). */
  async restore(stamp: string) {
    await this.backup(true);
    const folder = normalizePath(this.settings.backupsFolder);
    for (const src of this.backupSources()) {
      const name = src.split("/").pop()!;
      const copy = this.app.vault.getAbstractFileByPath(`${folder}/${stamp} ${name}`);
      const file = this.app.vault.getAbstractFileByPath(src);
      if (!(copy instanceof TFile) || !(file instanceof TFile)) continue;
      const text = await this.app.vault.read(copy);
      await this.app.vault.process(file, () => {
        this.lastWritten.set(src, text);
        return text;
      });
    }
    this.undoStack = [];
    await this.init();
    this.logAction("Восстановлено из копии", stamp);
  }

  // ---------- iCloud conflict copies ("Tasks 2.md") ----------

  isConflictCopy(path: string): boolean {
    return this.backupSources().some((src) => {
      const dir = src.split("/").slice(0, -1).join("/");
      const base = src.split("/").pop()!.replace(/\.md$/, "");
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^${dir ? dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/" : ""}${esc}( \\d+| \\(.+\\))\\.md$`);
      return re.test(path);
    });
  }

  findConflicts(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => this.isConflictCopy(f.path));
  }

  /** Merge a conflict copy into the main file, then move the copy into Backups. */
  async mergeConflict(copy: TFile): Promise<string> {
    const text = await this.app.vault.read(copy);
    const s = this.settings;
    const base = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
    let summary = "";
    if (copy.basename.startsWith(base(s.tasksFile))) {
      const theirs = docTasks(parseDoc(text));
      let added = 0, completed = 0;
      await this.mutate((doc) => {
        const mine = new Map(docTasks(doc).map((t) => [t.id, t]));
        for (const t of theirs) {
          const m = t.id ? mine.get(t.id) : undefined;
          if (!m) {
            if (!t.id) t.id = newId();
            doc.lines.splice(insertIndexForDay(doc, t.due), 0, { kind: "task", task: t });
            added++;
          } else if (t.done && !m.done) {
            m.done = true;
            m.doneDate = t.doneDate ?? today();
            completed++;
          }
        }
      }, "Слияние копии iCloud");
      summary = `добавлено ${added}, отмечено выполненными ${completed}`;
    } else if (copy.basename.startsWith(base(s.habitsFile))) {
      const theirs = parseHabits(text);
      await this.mutateHabits((h) => {
        for (const x of theirs.habits) if (!h.habits.some((y) => y.id === x.id)) h.habits.push(x);
        for (const [d, ids] of theirs.log) h.log.set(d, new Set([...(h.log.get(d) ?? []), ...ids]));
      }, "Слияние копии iCloud");
      summary = "привычки и отметки объединены";
    } else {
      const theirs = parseGoals(text);
      await this.mutateGoals((g) => {
        for (const [wk, list] of theirs) {
          const cur = g.get(wk) ?? [];
          for (const x of list) if (!cur.some((y) => y.id === x.id)) cur.push(x);
          g.set(wk, cur);
        }
      });
      summary = "цели объединены";
    }
    const folder = normalizePath(s.backupsFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    await this.app.vault.rename(copy, `${folder}/${today()} конфликт ${copy.name}`);
    this.logAction("Слита копия iCloud", `${copy.name}: ${summary}`);
    return summary;
  }

  // ---------- weekly goals ----------
  // Goals.md: "## 2026-W45" then "- [ ] Title 🆔 id"

  goalsFor(weekStart: DateStr): Goal[] {
    return this.goals.get(weekKey(weekStart)) ?? [];
  }

  findGoal(id: string): Goal | undefined {
    for (const list of this.goals.values()) {
      const g = list.find((x) => x.id === id);
      if (g) return g;
    }
    return undefined;
  }

  async mutateGoals(fn: (g: Map<string, Goal[]>) => void) {
    const file = await this.ensureFile(this.settings.goalsFile, GOALS_HEADER);
    let result = this.goals;
    await this.app.vault.process(file, (data) => {
      this.pushUndo("Цели изменены", file.path, data);
      result = parseGoals(data);
      fn(result);
      const out = serializeGoals(result);
      this.lastWritten.set(file.path, out);
      return out;
    });
    this.goals = result;
    this.trigger("changed");
  }

  async addGoal(weekStart: DateStr, title: string) {
    const id = newId();
    await this.mutateGoals((g) => g.set(weekKey(weekStart), [...(g.get(weekKey(weekStart)) ?? []), { id, title, done: false }]));
    return id;
  }

  async updateGoal(id: string, patch: Partial<Goal>) {
    await this.mutateGoals((g) => {
      for (const list of g.values()) {
        const x = list.find((y) => y.id === id);
        if (x) Object.assign(x, patch);
      }
    });
  }

  async removeGoal(id: string) {
    await this.mutateGoals((g) => {
      for (const [k, list] of g) g.set(k, list.filter((x) => x.id !== id));
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
    if (count) this.logAction("Перенесено на сегодня", `задач: ${count}`);
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
    this.logAction("В архив", `задач: ${old.length}`);
    return old.length;
  }

  async loadArchive(): Promise<Task[]> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.archiveFolder));
    if (!(folder instanceof TFolder)) return [];
    const out: Task[] = [];
    for (const f of folder.children) {
      if (f instanceof TFile && f.extension === "md")
        out.push(...docTasks(parseDoc(await this.app.vault.cachedRead(f))).map((t) => ({ ...t, archivePath: f.path })));
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

export function weekKey(weekStart: DateStr): string {
  return `${addDays(weekStart, 3).slice(0, 4)}-W${String(isoWeek(weekStart)).padStart(2, "0")}`;
}

const GOALS_HEADER = "# Цели недели\n";

export function parseGoals(text: string): Map<string, Goal[]> {
  const out = new Map<string, Goal[]>();
  let cur: Goal[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^##\s+(\d{4}-W\d{2})/);
    if (h) {
      cur = out.get(h[1]) ?? [];
      out.set(h[1], cur);
      continue;
    }
    const m = line.match(/^- \[([ xX])\] (.+?)\s*🆔\s*([\w-]+)\s*$/u);
    if (m && cur) cur.push({ id: m[3], title: m[2].trim(), done: m[1] !== " " });
  }
  return out;
}

export function serializeGoals(goals: Map<string, Goal[]>): string {
  const out = [GOALS_HEADER];
  for (const k of [...goals.keys()].sort().reverse()) {
    const list = goals.get(k)!;
    if (!list.length) continue;
    out.push(`## ${k}`);
    for (const g of list) out.push(`- [${g.done ? "x" : " "}] ${g.title} 🆔 ${g.id}`);
    out.push("");
  }
  return out.join("\n");
}
