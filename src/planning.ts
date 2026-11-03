import { App, Modal, setIcon } from "obsidian";
import { DAY_SHORT, DateStr, addDays, dayNum, fmtMinutes, today, weekDays, weekLabel, weekday } from "./dates";
import { DragController } from "./drag";
import { Task, displayTitle } from "./model";
import type WeekPlannerPlugin from "./main";
import { ICON, iconButton, iconText } from "./ui";

/** Weekly planning: spread leftovers and backlog over the days, watching each day's load. */
export class PlanningModal extends Modal {
  private drag: DragController | null = null;
  private unsub: (() => void) | null = null;
  private leftovers = new Set<string>(); // snapshot taken on open, so tasks leave the pool once placed

  constructor(app: App, private plugin: WeekPlannerPlugin, private weekStart: DateStr) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("wp-modal", "wp-plan-modal");
    this.contentEl.addClass("wp-root");
    this.titleEl.setText(`Планирование недели · ${weekLabel(this.weekStart)}`);
    const ref = this.plugin.store.on("changed", () => this.render());
    this.unsub = () => this.plugin.store.offref(ref);
    const days = weekDays(this.weekStart);
    for (const t of this.plugin.store.tasks())
      if (!t.done && t.moved > 0 && t.due && t.due >= days[0] && t.due <= days[6]) this.leftovers.add(t.id);
    this.drag = new DragController(this.contentEl, {
      onDrop: (id, target, before) => {
        this.leftovers.delete(id);
        // Placing a task during planning is a decision, not procrastination: keep the counter.
        const t = this.plugin.store.find(id);
        this.plugin.store.move(id, target === "backlog" ? null : target, before, t ? { moved: t.moved } : {});
      },
    });
    this.render();
  }

  onClose() {
    this.drag?.destroy();
    this.unsub?.();
    this.contentEl.empty();
  }

  private render() {
    const c = this.contentEl;
    const scrollTop = c.querySelector(".wp-plan-pool")?.scrollTop ?? 0;
    c.empty();
    const store = this.plugin.store;
    const days = weekDays(this.weekStart);
    const now = today();

    const intro = c.createDiv("wp-plan-intro");
    intro.createSpan({ text: "Перетащи задачи из левой колонки на дни. Полоска показывает загрузку дня относительно " + `${this.plugin.settings.dayCapacityHours}ч.` });
    const prevReview = iconButton(intro, ICON.review, "Итоги прошлой недели", "wp-chip-btn");
    prevReview.onclick = () => this.plugin.createReview(addDays(this.weekStart, -7));

    const body = c.createDiv("wp-plan-body");
    const pool = body.createDiv({ cls: "wp-plan-pool wp-list", attr: { "data-drop": "backlog", "data-drop-list": "" } });
    const leftovers = store.tasks().filter((t) => this.leftovers.has(t.id) && !t.done);
    const backlog = store.tasks().filter((t) => !t.done && t.due === null);
    const section = (title: string, list: Task[], hint: string) => {
      pool.createDiv({ cls: "wp-plan-section", text: `${title} · ${list.length}` });
      if (!list.length) pool.createDiv({ cls: "wp-muted wp-plan-empty", text: hint });
      for (const t of list) this.card(pool, t, true);
    };
    section("Хвосты (переносились)", leftovers, "Хвостов нет");
    section("Бэклог", backlog, "Бэклог пуст");
    pool.createDiv("wp-list-end");
    pool.scrollTop = scrollTop;

    const daysEl = body.createDiv("wp-plan-days");
    const cap = this.plugin.settings.dayCapacityHours * 60;
    for (const d of days) {
      const tasks = store.tasks().filter((t) => t.due === d && !this.leftovers.has(t.id));
      const minutes = tasks.filter((t) => !t.done).reduce((s, t) => s + t.duration, 0);
      const day = daysEl.createDiv("wp-plan-day");
      if (d === now) day.addClass("is-today");
      if (d < now) day.addClass("is-past");
      if (minutes > cap) day.addClass("is-overloaded");
      const head = day.createDiv("wp-plan-day-head");
      head.createSpan({ cls: "wp-dow", text: DAY_SHORT[weekday(d) - 1] });
      head.createSpan({ cls: "wp-daynum", text: String(dayNum(d)) });
      head.createSpan({ cls: "wp-count", text: `${tasks.length} · ${fmtMinutes(minutes) || "0"}` });
      const bar = day.createDiv("wp-bar");
      const ratio = cap ? minutes / cap : 0;
      bar.createDiv({ cls: `wp-bar-fill ${ratio > 1 ? "is-over" : ratio > 0.8 ? "is-high" : ""}`, attr: { style: `width:${Math.min(100, ratio * 100)}%` } });
      const list = day.createDiv({ cls: "wp-list", attr: { "data-drop": d, "data-drop-list": "" } });
      for (const t of tasks) this.card(list, t, false);
      list.createDiv("wp-list-end");
    }

    const footer = c.createDiv("wp-modal-footer");
    const untimed = days.reduce((n, d) => n + store.tasks().filter((t) => t.due === d && !t.done && !t.duration).length, 0);
    if (untimed) footer.createSpan({ cls: "wp-muted", text: `У ${untimed} задач не указана длительность — загрузка может быть выше` });
    footer.createDiv({ cls: "wp-spacer" });
    const done = footer.createEl("button", { cls: "mod-cta", text: "Неделя спланирована" });
    done.onclick = async () => {
      this.plugin.settings.lastPlannedWeek = this.weekStart;
      await this.plugin.saveSettings();
      this.close();
    };
  }

  private card(parent: HTMLElement, t: Task, full: boolean) {
    const card = parent.createDiv({ cls: `wp-card prio-${t.priority} ${full ? "" : "is-mini"}`, attr: { "data-id": t.id } });
    if (t.done) card.addClass("is-done");
    const row = card.createDiv("wp-card-row");
    const body = row.createDiv("wp-card-body");
    body.createDiv({ cls: "wp-card-title", text: displayTitle(t) });
    if (full) {
      const meta = body.createDiv("wp-card-meta");
      if (t.duration) meta.createSpan({ cls: "wp-meta", text: fmtMinutes(t.duration) });
      if (t.moved) iconText(meta, ICON.moved, String(t.moved), "wp-meta wp-moved");
      for (const tag of t.tags) meta.createSpan({ cls: "wp-meta", text: "#" + tag });
    } else if (t.duration) {
      row.createSpan({ cls: "wp-meta", text: fmtMinutes(t.duration) });
    }
    const grip = row.createSpan("wp-grip");
    setIcon(grip, "grip-vertical");
  }
}
