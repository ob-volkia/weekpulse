import { ItemView, Menu, Modal, App, WorkspaceLeaf, setIcon } from "obsidian";
import { DAY_SHORT, DateStr, addDays, dayNum, fmtMinutes, humanDay, startOfWeek, today, weekDays, weekLabel, weekday } from "./dates";
import { Task, newId } from "./model";
import { Habit, Store } from "./store";
import { tagColor } from "./weekView";
import type WeekPlannerPlugin from "./main";

export const VIEW_HABITS = "week-planner-habits";

export class HabitsView extends ItemView {
  private weekStart = startOfWeek(today());
  private archive: Task[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: WeekPlannerPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_HABITS; }
  getDisplayText() { return "Привычки и статистика"; }
  getIcon() { return "flame"; }

  private get store() { return this.plugin.store; }

  async onOpen() {
    this.contentEl.addClass("wp-root", "wp-habits-root");
    this.registerEvent(this.store.on("changed", () => this.render()));
    this.archive = await this.store.loadArchive();
    this.render();
  }

  render() {
    const root = this.contentEl;
    const top = root.scrollTop;
    root.empty();
    const bar = root.createDiv("wp-toolbar");
    const nav = bar.createDiv("wp-nav");
    const b = (icon: string, label: string, fn: () => void) => {
      const el = nav.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": label } });
      setIcon(el, icon);
      el.onclick = fn;
    };
    b("chevron-left", "Прошлая неделя", () => { this.weekStart = addDays(this.weekStart, -7); this.render(); });
    nav.createEl("button", { text: "Эта неделя", cls: "wp-today-btn" }).onclick = () => { this.weekStart = startOfWeek(today()); this.render(); };
    b("chevron-right", "Следующая неделя", () => { this.weekStart = addDays(this.weekStart, 7); this.render(); });
    nav.createDiv({ cls: "wp-week-title", text: weekLabel(this.weekStart) });
    const right = bar.createDiv("wp-toolbar-right");
    const back = right.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Неделя" } });
    setIcon(back, "calendar-days");
    back.onclick = () => this.plugin.activateWeek();

    const page = root.createDiv("wp-page");
    this.renderHabits(page);
    this.renderStats(page);
    root.scrollTop = top;
  }

  // ---------- habits ----------

  private renderHabits(page: HTMLElement) {
    const sec = page.createDiv("wp-section");
    const h = sec.createDiv("wp-section-head");
    h.createEl("h3", { text: "Привычки" });
    const add = h.createEl("button", { cls: "wp-chip-btn", text: "+ Привычка" });
    add.onclick = () => new HabitModal(this.app, this.store, null).open();

    const habits = this.store.habits.habits;
    if (!habits.length) {
      sec.createDiv({ cls: "wp-empty", text: "Добавь первую привычку — например «💧 Вода» или «🏃 Пробежка»" });
      return;
    }
    const days = weekDays(this.weekStart);
    const now = today();
    const table = sec.createDiv("wp-habit-table");
    const head = table.createDiv("wp-habit-row is-head");
    head.createDiv({ cls: "wp-habit-name", text: "" });
    for (const d of days) {
      const c = head.createDiv({ cls: "wp-habit-cell", text: `${DAY_SHORT[weekday(d) - 1]} ${dayNum(d)}` });
      if (d === now) c.addClass("is-today");
    }
    head.createDiv({ cls: "wp-habit-streak", text: "Серия" });
    head.createDiv({ cls: "wp-habit-month", text: "30 дней" });

    for (const habit of habits) {
      const row = table.createDiv("wp-habit-row");
      const name = row.createDiv({ cls: "wp-habit-name", text: habit.name });
      name.addEventListener("click", (e) => this.habitMenu(habit).showAtMouseEvent(e));
      name.addEventListener("contextmenu", (e) => { e.preventDefault(); this.habitMenu(habit).showAtMouseEvent(e); });
      for (const d of days) {
        const cell = row.createDiv("wp-habit-cell");
        const due = this.store.isHabitDue(habit, d);
        const done = this.store.habits.log.get(d)?.has(habit.id) ?? false;
        const box = cell.createEl("button", { cls: "wp-habit-box", attr: { "aria-label": `${habit.name}, ${humanDay(d)}` } });
        if (done) { box.addClass("is-done"); setIcon(box, "check"); }
        if (!due) box.addClass("is-off");
        if (d > now) box.addClass("is-future");
        if (d === now) cell.addClass("is-today");
        box.onclick = () => { if (d <= now) this.store.toggleHabit(habit.id, d); };
      }
      const { current, best } = this.store.streak(habit);
      const st = row.createDiv({ cls: "wp-habit-streak", attr: { "aria-label": `Лучшая серия: ${best}` } });
      st.createSpan({ text: current ? `🔥 ${current}` : "—" });
      st.createSpan({ cls: "wp-muted", text: ` / ${best}` });
      const month = row.createDiv("wp-habit-month");
      for (let i = 29; i >= 0; i--) {
        const d = addDays(now, -i);
        const done = this.store.habits.log.get(d)?.has(habit.id);
        const sq = month.createDiv({ cls: "wp-mini", attr: { "aria-label": `${humanDay(d)}: ${done ? "выполнено" : "нет"}` } });
        if (done) sq.addClass("is-done");
        else if (!this.store.isHabitDue(habit, d)) sq.addClass("is-off");
      }
    }
  }

  private habitMenu(h: Habit) {
    const m = new Menu();
    m.addItem((i) => i.setTitle("Изменить").setIcon("pencil").onClick(() => new HabitModal(this.app, this.store, h).open()));
    m.addItem((i) => i.setTitle("Удалить").setIcon("trash").setWarning(true).onClick(() =>
      this.store.mutateHabits((d) => { d.habits = d.habits.filter((x) => x.id !== h.id); })));
    return m;
  }

  // ---------- stats ----------

  private renderStats(page: HTMLElement) {
    const sec = page.createDiv("wp-section");
    sec.createDiv("wp-section-head").createEl("h3", { text: "Статистика недели" });
    const days = weekDays(this.weekStart);
    const all = [...this.store.tasks(), ...this.archive];
    const inWeek = all.filter((t) => t.due && t.due >= days[0] && t.due <= days[6]);
    const done = inWeek.filter((t) => t.done);
    const minutesDone = done.reduce((s, t) => s + t.duration, 0);
    const minutesPlanned = inWeek.reduce((s, t) => s + t.duration, 0);
    const moved = inWeek.filter((t) => t.moved > 0).length;

    // KPI tiles
    const tiles = sec.createDiv("wp-tiles");
    const tile = (label: string, value: string, sub = "") => {
      const t = tiles.createDiv("wp-tile");
      t.createDiv({ cls: "wp-tile-label", text: label });
      t.createDiv({ cls: "wp-tile-value", text: value });
      if (sub) t.createDiv({ cls: "wp-tile-sub", text: sub });
    };
    tile("Выполнено", inWeek.length ? `${Math.round((done.length / inWeek.length) * 100)}%` : "—", `${done.length} из ${inWeek.length} задач`);
    tile("Время в работе", fmtMinutes(minutesDone) || "0", minutesPlanned ? `из ${fmtMinutes(minutesPlanned)} запланированных` : "длительность не указана");
    tile("Переносились", String(moved), moved ? "задач сдвигались хотя бы раз" : "ничего не откладывали 👍");
    const bestHabit = this.store.habits.habits.map((h) => ({ h, s: this.store.streak(h).current })).sort((a, b) => b.s - a.s)[0];
    tile("Лучшая серия", bestHabit?.s ? `🔥 ${bestHabit.s}` : "—", bestHabit?.s ? bestHabit.h.name : "привычек пока нет");

    // per-day bars: done vs planned (one series: done; the track is the plan)
    const chart = sec.createDiv("wp-chart");
    chart.createDiv({ cls: "wp-chart-title", text: "Выполнено по дням" });
    const bars = chart.createDiv("wp-bars");
    const max = Math.max(1, ...days.map((d) => inWeek.filter((t) => t.due === d).length));
    for (const d of days) {
      const list = inWeek.filter((t) => t.due === d);
      const dn = list.filter((t) => t.done).length;
      const col = bars.createDiv({ cls: "wp-bar-col", attr: { "aria-label": `${humanDay(d)}: ${dn} из ${list.length}` } });
      const track = col.createDiv("wp-vbar-track");
      track.style.height = `${(list.length / max) * 100}%`;
      const fill = track.createDiv("wp-vbar-fill");
      fill.style.height = list.length ? `${(dn / list.length) * 100}%` : "0";
      col.createDiv({ cls: "wp-bar-value", text: list.length ? `${dn}/${list.length}` : "" });
      col.createDiv({ cls: `wp-bar-label ${d === today() ? "is-today" : ""}`, text: DAY_SHORT[weekday(d) - 1] });
    }

    // by tag
    const tagMap = new Map<string, { total: number; done: number }>();
    for (const t of inWeek) for (const tag of t.tags.length ? t.tags : ["без тега"]) {
      const e = tagMap.get(tag) ?? { total: 0, done: 0 };
      e.total++;
      if (t.done) e.done++;
      tagMap.set(tag, e);
    }
    if (tagMap.size) {
      const tc = sec.createDiv("wp-chart");
      tc.createDiv({ cls: "wp-chart-title", text: "По тегам" });
      const tmax = Math.max(...[...tagMap.values()].map((v) => v.total));
      for (const [tag, v] of [...tagMap.entries()].sort((a, b) => b[1].total - a[1].total)) {
        const row = tc.createDiv({ cls: "wp-hbar-row", attr: { "aria-label": `${tag}: ${v.done} из ${v.total}` } });
        row.createDiv({ cls: `wp-hbar-label`, text: tag === "без тега" ? tag : "#" + tag });
        const track = row.createDiv("wp-hbar-track");
        const inner = track.createDiv("wp-hbar-total");
        inner.style.width = `${(v.total / tmax) * 100}%`;
        const fill = inner.createDiv(`wp-hbar-fill ${tag === "без тега" ? "" : `tag-c${tagColor(tag)}`}`);
        fill.style.width = `${(v.done / v.total) * 100}%`;
        row.createDiv({ cls: "wp-hbar-value", text: `${v.done}/${v.total}` });
      }
    }

    // 12-week heatmap of completed tasks
    const hm = sec.createDiv("wp-chart");
    hm.createDiv({ cls: "wp-chart-title", text: "Активность за 12 недель" });
    const counts = new Map<DateStr, number>();
    for (const t of all) if (t.done && t.doneDate) counts.set(t.doneDate, (counts.get(t.doneDate) ?? 0) + 1);
    const start = addDays(startOfWeek(today()), -7 * 11);
    const hmax = Math.max(1, ...counts.values());
    const grid = hm.createDiv("wp-heatmap");
    for (let w = 0; w < 12; w++) {
      const col = grid.createDiv("wp-heat-col");
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, w * 7 + i);
        const n = counts.get(d) ?? 0;
        const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / hmax) * 4));
        const cell = col.createDiv({ cls: `wp-heat lvl-${level}`, attr: { "aria-label": `${humanDay(d)}: ${n} выполнено` } });
        if (d > today()) cell.addClass("is-future");
      }
    }
    const legend = hm.createDiv("wp-heat-legend");
    legend.createSpan({ text: "меньше" });
    for (let l = 0; l <= 4; l++) legend.createDiv(`wp-heat lvl-${l}`);
    legend.createSpan({ text: "больше" });

    // most postponed
    const stale = this.store.tasks().filter((t) => !t.done && t.moved >= 2).sort((a, b) => b.moved - a.moved).slice(0, 5);
    if (stale.length) {
      const sc = sec.createDiv("wp-chart");
      sc.createDiv({ cls: "wp-chart-title", text: "Чаще всего откладываются" });
      for (const t of stale) {
        const r = sc.createDiv("wp-stale-row");
        r.createSpan({ text: t.title });
        r.createSpan({ cls: "wp-moved", text: `↪${t.moved}` });
      }
    }
  }
}

class HabitModal extends Modal {
  constructor(app: App, private store: Store, private habit: Habit | null) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("wp-modal");
    this.titleEl.setText(this.habit ? "Привычка" : "Новая привычка");
    const c = this.contentEl;
    const name = c.createEl("input", { cls: "wp-modal-title", attr: { type: "text", placeholder: "💧 Пить воду" } });
    name.value = this.habit?.name ?? "";
    setTimeout(() => name.focus(), 10);
    c.createDiv({ cls: "wp-field-label", text: "Дни (ничего не выбрано — каждый день)" });
    const daysRow = c.createDiv("wp-days");
    const days = new Set(this.habit?.days ?? []);
    DAY_SHORT.forEach((d, i) => {
      const b = daysRow.createEl("button", { text: d, cls: "wp-chip-btn" });
      if (days.has(i + 1)) b.addClass("is-active");
      b.onclick = () => {
        if (days.has(i + 1)) days.delete(i + 1);
        else days.add(i + 1);
        b.toggleClass("is-active", days.has(i + 1));
      };
    });
    const save = async () => {
      const n = name.value.trim();
      if (!n) return;
      const list = [...days].sort();
      await this.store.mutateHabits((h) => {
        const ex = this.habit && h.habits.find((x) => x.id === this.habit!.id);
        if (ex) { ex.name = n; ex.days = list; }
        else h.habits.push({ id: newId(), name: n, days: list });
      });
      this.close();
    };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) save(); });
    const f = c.createDiv("wp-modal-footer");
    f.createDiv({ cls: "wp-spacer" });
    f.createEl("button", { text: "Отмена" }).onclick = () => this.close();
    f.createEl("button", { text: "Сохранить", cls: "mod-cta" }).onclick = save;
  }

  onClose() {
    this.contentEl.empty();
  }
}
