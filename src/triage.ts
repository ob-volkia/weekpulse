import { App, Modal, setIcon } from "obsidian";
import { DAY_SHORT, DateStr, addDays, diffDays, humanDay, startOfWeek, today, weekDays, weekday } from "./dates";
import { Task, displayTitle } from "./model";
import { TaskModal } from "./modal";
import type WeekPlannerPlugin from "./main";

/** Backlog review, one task at a time: oldest first. */
export class TriageModal extends Modal {
  private queue: string[];
  private index = 0;
  private stats = { planned: 0, kept: 0, removed: 0 };
  private pickDay = false;

  constructor(app: App, private plugin: WeekPlannerPlugin) {
    super(app);
    const key = (t: Task) => t.created ?? "0000";
    this.queue = plugin.store.tasks().filter((t) => !t.done && !t.due).sort((a, b) => key(a).localeCompare(key(b))).map((t) => t.id);
  }

  onOpen() {
    this.modalEl.addClass("wp-modal", "wp-triage-modal");
    this.titleEl.setText("Разбор бэклога");
    this.modalEl.addEventListener("keydown", (e) => this.onKey(e));
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  private current(): Task | null {
    while (this.index < this.queue.length) {
      const t = this.plugin.store.find(this.queue[this.index]);
      if (t && !t.done && !t.due) return t;
      this.index++; // gone or already planned elsewhere
    }
    return null;
  }

  private async act(fn: (t: Task) => Promise<unknown> | void, stat: keyof TriageModal["stats"]) {
    const t = this.current();
    if (!t) return;
    await fn(t);
    this.stats[stat]++;
    this.index++;
    this.pickDay = false;
    this.render();
  }

  private plan(due: DateStr) {
    return this.act((t) => this.plugin.store.move(t.id, due, null), "planned");
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input")) return;
    const now = today();
    const keys: Record<string, () => void> = {
      "1": () => this.plan(now),
      "2": () => this.plan(addDays(now, 1)),
      "3": () => { this.pickDay = !this.pickDay; this.render(); },
      "4": () => this.plan(addDays(startOfWeek(now), 7)),
      " ": () => this.act(() => {}, "kept"),
      ArrowRight: () => this.act(() => {}, "kept"),
      Delete: () => this.act((t) => this.plugin.store.remove(t.id), "removed"),
      Backspace: () => this.act((t) => this.plugin.store.remove(t.id), "removed"),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }

  private render() {
    const c = this.contentEl;
    c.empty();
    const t = this.current();
    if (!t) {
      c.createDiv({ cls: "wp-triage-done", text: this.queue.length ? "Бэклог разобран" : "Бэклог пуст" });
      if (this.queue.length) {
        const s = this.stats;
        c.createDiv({ cls: "wp-muted", text: `Запланировано ${s.planned} · оставлено ${s.kept} · удалено ${s.removed}` });
      }
      const f = c.createDiv("wp-modal-footer");
      f.createDiv({ cls: "wp-spacer" });
      f.createEl("button", { text: "Готово", cls: "mod-cta" }).onclick = () => this.close();
      return;
    }
    const now = today();
    c.createDiv({ cls: "wp-muted wp-triage-progress", text: `${this.index + 1} из ${this.queue.length}` });
    const card = c.createDiv("wp-triage-card");
    card.createDiv({ cls: "wp-triage-title", text: displayTitle(t) });
    const meta: string[] = [];
    if (t.created) {
      const age = diffDays(now, t.created);
      meta.push(age <= 0 ? "добавлена сегодня" : `в бэклоге ${age} дн.`);
    }
    if (t.tags.length) meta.push(t.tags.map((x) => "#" + x).join(" "));
    if (t.deadline) meta.push(`дедлайн ${humanDay(t.deadline)}`);
    if (meta.length) card.createDiv({ cls: "wp-muted", text: meta.join(" · ") });
    const open = card.createEl("button", { cls: "wp-chip-btn", text: "Открыть задачу" });
    open.onclick = () => new TaskModal(this.app, this.plugin, t, null).open();

    const grid = c.createDiv("wp-triage-actions");
    const btn = (key: string, label: string, ic: string, fn: () => void, cls = "") => {
      const b = grid.createEl("button", { cls: `wp-triage-btn ${cls}` });
      setIcon(b.createSpan("wp-ico"), ic);
      b.createSpan({ text: label });
      b.createSpan({ cls: "wp-triage-key", text: key });
      b.onclick = fn;
    };
    btn("1", "Сегодня", "sun", () => this.plan(now), "mod-cta");
    btn("2", "Завтра", "sunrise", () => this.plan(addDays(now, 1)));
    btn("3", "На этой неделе…", "calendar-range", () => { this.pickDay = !this.pickDay; this.render(); });
    btn("4", "След. неделя", "calendar-plus", () => this.plan(addDays(startOfWeek(now), 7)));
    btn("␣", "Оставить", "inbox", () => this.act(() => {}, "kept"));
    btn("⌫", "Удалить", "trash-2", () => this.act((x) => this.plugin.store.remove(x.id), "removed"), "wp-danger");

    if (this.pickDay) {
      const days = c.createDiv("wp-triage-days");
      for (const d of weekDays(startOfWeek(now)).filter((d) => d >= now)) {
        const b = days.createEl("button", { cls: "wp-chip-btn", text: `${DAY_SHORT[weekday(d) - 1]} ${humanDay(d)}` });
        b.onclick = () => this.plan(d);
      }
      const date = days.createEl("input", { attr: { type: "date" } });
      date.addEventListener("change", () => date.value && this.plan(date.value));
    }
  }
}
