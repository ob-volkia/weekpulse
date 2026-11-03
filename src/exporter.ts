// Planner/Export/planner.json — a small machine-readable snapshot for things outside Obsidian
// (the Scriptable widget and Reminders sync on the iPhone). Written only when its content changes.
//
// Planner/Export/inbox.json — the other direction: the script appends {op:"done", id} when a
// reminder is ticked off; the plugin applies those and empties the file.

import { App, TFile, normalizePath } from "obsidian";
import { DateStr, addDays, today } from "./dates";
import { compareInDay, displayTitle } from "./model";
import type { Store } from "./store";

export interface ExportTask {
  id: string;
  title: string;
  time: string | null;
  duration: number;
  done: boolean;
  priority: number;
  tags: string[];
  deadline: string | null;
}

export interface ExportData {
  version: 1;
  today: DateStr;
  reminderMinutes: number;
  days: { date: DateStr; tasks: ExportTask[]; events: { title: string; start: string | null; minutes: number }[] }[];
  overdueDeadlines: ExportTask[];
  backlog: number;
  habits: { name: string; done: boolean }[];
}

export function buildExport(store: Store, reminderMinutes: number, days = 8): ExportData {
  const now = today();
  const own = store.tasks();
  const all = store.all();
  const order = new Map(all.map((t, i) => [t.id, i]));
  const pack = (t: (typeof all)[number]): ExportTask => ({
    id: t.id, title: displayTitle(t), time: t.time, duration: t.duration, done: t.done, priority: t.priority, tags: t.tags, deadline: t.deadline,
  });
  const out: ExportData = {
    version: 1, today: now, reminderMinutes, days: [], overdueDeadlines: [],
    backlog: own.filter((t) => !t.done && !t.due).length,
    habits: store.habits.habits.filter((h) => store.isHabitDue(h, now)).map((h) => ({ name: h.name, done: !!store.habits.log.get(now)?.has(h.id) })),
  };
  for (let i = 0; i < days; i++) {
    const d = addDays(now, i);
    const tasks = all.filter((t) => store.effectiveDue(t) === d).sort((a, b) => compareInDay(a, b, order.get(a.id)!, order.get(b.id)!));
    out.days.push({ date: d, tasks: tasks.map(pack), events: store.eventsOn(d).map((e) => ({ title: e.title, start: e.start, minutes: e.minutes })) });
  }
  out.overdueDeadlines = own.filter((t) => !t.done && t.deadline && t.deadline < now).map(pack);
  return out;
}

export class Exporter {
  private timer: number | null = null;

  constructor(private app: App, private store: Store, private folder: () => string, private reminderMinutes: () => number) {}

  private path(name: string) {
    return normalizePath(`${this.folder()}/${name}`);
  }

  schedule() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.write(), 1500);
  }

  async write() {
    const text = JSON.stringify(buildExport(this.store, this.reminderMinutes()), null, 1);
    const path = this.path("planner.json");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      if ((await this.app.vault.read(file)) === text) return;
      await this.app.vault.process(file, () => text);
    } else {
      if (!this.app.vault.getAbstractFileByPath(this.folder())) await this.app.vault.createFolder(this.folder());
      await this.app.vault.create(path, text);
    }
  }

  isInbox(path: string) {
    return path === this.path("inbox.json");
  }

  /** Apply completions sent from Reminders; returns how many tasks were marked done. */
  async readInbox(): Promise<number> {
    const file = this.app.vault.getAbstractFileByPath(this.path("inbox.json"));
    if (!(file instanceof TFile)) return 0;
    let ops: { op: string; id: string }[] = [];
    try {
      ops = JSON.parse((await this.app.vault.read(file)) || "[]");
    } catch {
      return 0;
    }
    if (!Array.isArray(ops) || !ops.length) return 0;
    let n = 0;
    for (const op of ops) {
      const t = this.store.find(op.id);
      if (op.op === "done" && t && !t.done) {
        await this.store.toggle(op.id);
        n++;
      }
    }
    await this.app.vault.process(file, () => "[]");
    if (n) this.store.logAction("Отмечено в Напоминаниях", `задач: ${n}`);
    return n;
  }
}
