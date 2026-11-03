import { ItemView, Menu, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import {
  DAY_LONG, DAY_SHORT, DateStr, addDays, dayNum, fmtMinutes, humanDay, isoWeek, relativeLabel, startOfWeek, today, weekDays,
  weekLabel, weekday,
} from "./dates";
import { DragController } from "./drag";
import { PRIORITY_LABEL, Priority, Task, compareInDay, recurrenceLabel } from "./model";
import { TaskModal } from "./modal";
import { parseQuick } from "./quickadd";
import type WeekPlannerPlugin from "./main";

export const VIEW_WEEK = "week-planner-view";
const BACKLOG = "backlog";
const MOBILE_BREAKPOINT = 720;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function tagColor(tag: string): number {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}

export class WeekView extends ItemView {
  private weekStart: DateStr = startOfWeek(today());
  private selected: DateStr = today(); // mobile: which day is shown
  private tagFilter: string | null = null;
  private drag: DragController | null = null;
  private compact = false;
  private mobile = false;
  private focusKey: string | null = null;
  private resizeObs: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: WeekPlannerPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_WEEK; }
  getDisplayText() { return "Неделя"; }
  getIcon() { return "calendar-days"; }

  private get store() { return this.plugin.store; }

  async onOpen() {
    this.contentEl.addClass("wp-root");
    this.registerEvent(this.store.on("changed", () => this.render()));
    this.drag = new DragController(this.contentEl, {
      onDrop: (id, target, before) => this.store.move(id, target === BACKLOG ? null : target, before),
      onSwipe: (id, dir) => {
        const t = this.store.find(id);
        if (!t) return;
        if (dir === "left") this.store.toggle(id);
        else {
          const base = t.due && t.due > today() ? t.due : today();
          this.store.move(id, addDays(base, 1), null);
          new Notice(`«${t.title}» → завтра`);
        }
      },
    });
    this.resizeObs = new ResizeObserver(() => {
      const m = Platform.isPhone || this.contentEl.clientWidth < MOBILE_BREAKPOINT;
      if (m !== this.mobile) {
        this.mobile = m;
        this.render();
      }
    });
    this.resizeObs.observe(this.contentEl);
    this.mobile = Platform.isPhone || this.contentEl.clientWidth < MOBILE_BREAKPOINT;
    this.registerDomEvent(this.contentEl, "keydown", (e) => this.onKey(e));
    this.contentEl.tabIndex = -1;
    this.render();
  }

  async onClose() {
    this.drag?.destroy();
    this.resizeObs?.disconnect();
  }

  goToday() {
    this.weekStart = startOfWeek(today());
    this.selected = today();
    this.render();
  }

  focusQuickAdd() {
    const el = this.contentEl.querySelector<HTMLInputElement>(".wp-quick input");
    el?.focus();
  }

  private shiftWeek(n: number) {
    this.weekStart = addDays(this.weekStart, 7 * n);
    if (this.selected !== BACKLOG) this.selected = addDays(this.selected, 7 * n);
    this.render();
  }

  private onKey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement).closest("input, textarea, select");
    if (typing) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === "n" || e.key === "т") { e.preventDefault(); this.focusQuickAdd(); }
    else if (e.key === "t" || e.key === "е") this.goToday();
    else if (e.key === "[" || e.key === "х" || (e.key === "ArrowLeft" && e.altKey)) this.shiftWeek(-1);
    else if (e.key === "]" || e.key === "ъ" || (e.key === "ArrowRight" && e.altKey)) this.shiftWeek(1);
    else if (e.key === "d" || e.key === "в") this.toggleDone();
  }

  private toggleDone() {
    this.store.settings.showDone = !this.store.settings.showDone;
    this.plugin.saveSettings();
    this.render();
  }

  // ---------- data ----------

  private visible(t: Task) {
    if (this.tagFilter && !t.tags.includes(this.tagFilter)) return false;
    if (!this.store.settings.showDone && t.done) return false;
    return true;
  }

  private tasksFor(day: DateStr | null): Task[] {
    const all = this.store.tasks();
    const order = new Map(all.map((t, i) => [t.id, i]));
    return all
      .filter((t) => t.due === day && this.visible(t))
      .sort((a, b) => compareInDay(a, b, order.get(a.id)!, order.get(b.id)!));
  }

  private dayStats(day: DateStr | null) {
    const list = this.store.tasks().filter((t) => t.due === day && (!this.tagFilter || t.tags.includes(this.tagFilter)));
    const done = list.filter((t) => t.done).length;
    const minutes = list.filter((t) => !t.done).reduce((s, t) => s + t.duration, 0);
    return { total: list.length, done, minutes };
  }

  // ---------- render ----------

  render() {
    const root = this.contentEl;
    const scroll = this.saveScroll();
    root.empty();
    root.toggleClass("is-mobile", this.mobile);
    root.toggleClass("is-compact", this.compact);
    this.renderToolbar(root);
    if (this.mobile) this.renderMobile(root);
    else this.renderDesktop(root);
    this.restoreScroll(scroll);
    if (this.focusKey) {
      root.querySelector<HTMLInputElement>(`input[data-key="${this.focusKey}"]`)?.focus();
      this.focusKey = null;
    }
  }

  private saveScroll() {
    const map = new Map<string, number>();
    this.contentEl.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((el) => {
      map.set(el.dataset.scrollKey!, el.dataset.scrollKey === "grid" ? el.scrollLeft : el.scrollTop);
    });
    return map;
  }

  private restoreScroll(map: Map<string, number>) {
    this.contentEl.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((el) => {
      const v = map.get(el.dataset.scrollKey!);
      if (v == null) return;
      if (el.dataset.scrollKey === "grid") el.scrollLeft = v;
      else el.scrollTop = v;
    });
  }

  private renderToolbar(root: HTMLElement) {
    const bar = root.createDiv("wp-toolbar");
    const nav = bar.createDiv("wp-nav");
    const btn = (parent: HTMLElement, icon: string, label: string, fn: () => void, cls = "") => {
      const b = parent.createEl("button", { cls: `wp-icon-btn clickable-icon ${cls}`, attr: { "aria-label": label } });
      setIcon(b, icon);
      b.onclick = fn;
      return b;
    };
    btn(nav, "chevron-left", "Прошлая неделя ([)", () => this.shiftWeek(-1));
    const todayBtn = nav.createEl("button", { text: "Сегодня", cls: "wp-today-btn" });
    todayBtn.onclick = () => this.goToday();
    btn(nav, "chevron-right", "Следующая неделя (])", () => this.shiftWeek(1));
    const title = nav.createDiv("wp-week-title");
    title.createSpan({ text: weekLabel(this.weekStart) });
    title.createSpan({ cls: "wp-week-num", text: `W${isoWeek(this.weekStart)}` });

    // week progress
    const days = weekDays(this.weekStart);
    const weekTasks = this.store.tasks().filter((t) => t.due && t.due >= days[0] && t.due <= days[6]);
    const done = weekTasks.filter((t) => t.done).length;
    const prog = bar.createDiv({ cls: "wp-week-progress", attr: { "aria-label": `Выполнено ${done} из ${weekTasks.length}` } });
    const pct = weekTasks.length ? Math.round((done / weekTasks.length) * 100) : 0;
    prog.createDiv("wp-bar").createDiv({ cls: "wp-bar-fill", attr: { style: `width:${pct}%` } });
    prog.createSpan({ cls: "wp-muted", text: `${done}/${weekTasks.length} · ${pct}%` });

    if (!this.mobile) this.renderQuickAdd(bar, today(), "toolbar");

    const right = bar.createDiv("wp-toolbar-right");
    const tags = this.store.allTags();
    if (tags.length) {
      const tb = right.createEl("button", { cls: "wp-chip-btn wp-filter-btn", text: this.tagFilter ? `#${this.tagFilter}` : "Все теги" });
      if (this.tagFilter) tb.addClass("is-active", `tag-c${tagColor(this.tagFilter)}`);
      tb.onclick = (e) => {
        const m = new Menu();
        m.addItem((i) => i.setTitle("Все теги").setChecked(!this.tagFilter).onClick(() => { this.tagFilter = null; this.render(); }));
        for (const t of tags) m.addItem((i) => i.setTitle("#" + t).setChecked(this.tagFilter === t).onClick(() => { this.tagFilter = t; this.render(); }));
        m.showAtMouseEvent(e);
      };
    }
    btn(right, this.store.settings.showDone ? "eye" : "eye-off", this.store.settings.showDone ? "Скрыть выполненные (d)" : "Показать выполненные (d)", () => this.toggleDone());
    if (!this.mobile) btn(right, this.compact ? "unfold-vertical" : "fold-vertical", "Компактный вид", () => { this.compact = !this.compact; this.render(); });
    btn(right, "flame", "Привычки и статистика", () => this.plugin.activateHabits());
    btn(right, "file-text", "Открыть файл задач", () => this.openFile());
  }

  private renderQuickAdd(parent: HTMLElement, day: DateStr | null, key: string, placeholder = "Быстро добавить: завтра 14:00 1ч #работа !! Созвон") {
    const wrap = parent.createDiv("wp-quick");
    const icon = wrap.createSpan("wp-quick-icon");
    setIcon(icon, "plus");
    const input = wrap.createEl("input", { attr: { type: "text", placeholder, "data-key": key, enterkeyhint: "done" } });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || e.isComposing || !input.value.trim()) return;
      e.preventDefault();
      const q = parseQuick(input.value, day ?? today());
      if (!q.task.title) return;
      const due = q.due !== undefined ? q.due : day;
      this.focusKey = key;
      input.value = "";
      await this.store.add(q.task, due);
      if (due !== day) new Notice(`Добавлено: ${due ? humanDay(due) : "бэклог"}`);
    });
    return input;
  }

  private renderDesktop(root: HTMLElement) {
    const grid = root.createDiv({ cls: "wp-grid wp-scroll-x", attr: { "data-scroll-key": "grid" } });
    this.renderColumn(grid, null);
    for (const d of weekDays(this.weekStart)) this.renderColumn(grid, d);
  }

  private renderColumn(grid: HTMLElement, day: DateStr | null) {
    const now = today();
    const col = grid.createDiv("wp-col");
    if (day === null) col.addClass("is-backlog");
    else {
      if (day === now) col.addClass("is-today");
      if (day < now) col.addClass("is-past");
      if (weekday(day) >= 6) col.addClass("is-weekend");
    }
    const head = col.createDiv("wp-col-head");
    const stats = this.dayStats(day);
    const line1 = head.createDiv("wp-col-title");
    if (day) {
      line1.createSpan({ cls: "wp-dow", text: DAY_SHORT[weekday(day) - 1] });
      line1.createSpan({ cls: "wp-daynum", text: String(dayNum(day)) });
      const rel = relativeLabel(day);
      if (rel) line1.createSpan({ cls: "wp-rel", text: rel });
    } else {
      line1.createSpan({ cls: "wp-dow", text: "Бэклог" });
    }
    line1.createSpan({ cls: "wp-count", text: stats.total ? `${stats.done}/${stats.total}` : "" });
    if (day) {
      const load = head.createDiv("wp-load");
      const cap = this.store.settings.dayCapacityHours * 60;
      const ratio = cap ? stats.minutes / cap : 0;
      const bar = load.createDiv("wp-bar");
      bar.createDiv({ cls: `wp-bar-fill ${ratio > 1 ? "is-over" : ratio > 0.8 ? "is-high" : ""}`, attr: { style: `width:${Math.min(100, ratio * 100)}%` } });
      load.createSpan({ cls: "wp-muted", text: stats.minutes ? fmtMinutes(stats.minutes) : "" });
    }
    const list = col.createDiv({ cls: "wp-list wp-scroll-y", attr: { "data-drop": day ?? BACKLOG, "data-drop-list": "", "data-scroll-key": day ?? BACKLOG } });
    for (const t of this.tasksFor(day)) this.renderCard(list, t);
    list.createDiv("wp-list-end");
    const foot = col.createDiv("wp-col-foot");
    this.renderQuickAdd(foot, day, `col-${day ?? BACKLOG}`, "Добавить…");
  }

  private renderCard(parent: HTMLElement, t: Task) {
    const card = parent.createDiv({ cls: `wp-card prio-${t.priority}`, attr: { "data-id": t.id } });
    if (t.done) card.addClass("is-done");
    if (t.moved >= 3 && !t.done) card.addClass("is-stale");
    const row = card.createDiv("wp-card-row");
    const cb = row.createEl("input", { attr: { type: "checkbox", "aria-label": "Выполнено" }, cls: "task-list-item-checkbox wp-check" });
    cb.checked = t.done;
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      this.store.toggle(t.id);
    });
    const body = row.createDiv("wp-card-body");
    body.createDiv({ cls: "wp-card-title", text: t.title });
    const meta = body.createDiv("wp-card-meta");
    if (t.time) meta.createSpan({ cls: "wp-meta wp-time", text: t.time });
    if (t.duration) meta.createSpan({ cls: "wp-meta", text: fmtMinutes(t.duration) });
    if (t.recurrence) {
      const r = meta.createSpan({ cls: "wp-meta wp-icon-meta", attr: { "aria-label": recurrenceLabel(t.recurrence) } });
      setIcon(r, "repeat");
    }
    if (t.moved) meta.createSpan({ cls: "wp-meta wp-moved", text: `↪${t.moved}`, attr: { "aria-label": `Переносилась ${t.moved} раз(а)` } });
    if (t.subtasks.length) {
      const done = t.subtasks.filter((s) => s.done).length;
      const s = meta.createSpan({ cls: "wp-meta wp-icon-meta" });
      setIcon(s, "list-checks");
      s.createSpan({ text: `${done}/${t.subtasks.length}` });
    }
    for (const tag of t.tags) {
      const chip = meta.createSpan({ cls: `wp-tag tag-c${tagColor(tag)}`, text: "#" + tag });
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        this.tagFilter = this.tagFilter === tag ? null : tag;
        this.render();
      });
    }
    if (!meta.childElementCount) meta.remove();

    card.addEventListener("click", () => new TaskModal(this.app, this.store, t, t.due).open());
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.cardMenu(t).showAtMouseEvent(e);
    });
  }

  private cardMenu(t: Task) {
    const m = new Menu();
    const now = today();
    const moveTo = (title: string, icon: string, due: DateStr | null) =>
      m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => this.store.move(t.id, due, null)));
    m.addItem((i) => i.setTitle(t.done ? "Вернуть в работу" : "Выполнено").setIcon("check").onClick(() => this.store.toggle(t.id)));
    m.addSeparator();
    moveTo("На сегодня", "sun", now);
    moveTo("На завтра", "sunrise", addDays(now, 1));
    moveTo("На следующую неделю", "calendar-plus", addDays(startOfWeek(now), 7));
    moveTo("В бэклог", "inbox", null);
    m.addSeparator();
    const prios: Priority[] = [3, 2, 1, 0, -1];
    for (const p of prios)
      m.addItem((i) => i.setTitle(`Приоритет: ${PRIORITY_LABEL[p]}`).setChecked(t.priority === p).onClick(() => this.store.update(t.id, { priority: p })));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Дублировать").setIcon("copy").onClick(() => {
      const { id, ...rest } = t;
      void id;
      this.store.add({ ...rest, done: false, doneDate: null, moved: 0 }, t.due);
    }));
    m.addItem((i) => i.setTitle("Открыть в файле").setIcon("file-text").onClick(() => this.openFile(t)));
    m.addItem((i) => i.setTitle("Удалить").setIcon("trash").setWarning(true).onClick(() => this.store.remove(t.id)));
    return m;
  }

  private async openFile(t?: Task) {
    const file = this.app.vault.getAbstractFileByPath(this.store.settings.tasksFile);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    if (t) {
      const text = await this.app.vault.read(file);
      const line = text.split("\n").findIndex((l) => l.includes(`🆔 ${t.id}`));
      if (line >= 0) leaf.setEphemeralState({ line });
    }
  }

  // ---------- mobile ----------

  private renderMobile(root: HTMLElement) {
    const strip = root.createDiv("wp-strip");
    const now = today();
    const mk = (key: string, label: string, sub: string, date: DateStr | null) => {
      const pill = strip.createDiv({ cls: "wp-pill", attr: { "data-drop": key } });
      if ((date ?? BACKLOG) === this.selected) pill.addClass("is-selected");
      if (date === now) pill.addClass("is-today");
      if (date && date < now) pill.addClass("is-past");
      pill.createDiv({ cls: "wp-pill-label", text: label });
      pill.createDiv({ cls: "wp-pill-num", text: sub });
      const st = this.dayStats(date);
      const open = st.total - st.done;
      const dot = pill.createDiv("wp-pill-count");
      if (st.total && !open) dot.setText("✓"), dot.addClass("is-clear");
      else if (open) dot.setText(String(open));
      pill.onclick = () => {
        this.selected = date ?? BACKLOG;
        this.render();
      };
    };
    for (const d of weekDays(this.weekStart)) mk(d, DAY_SHORT[weekday(d) - 1], String(dayNum(d)), d);
    mk(BACKLOG, "Бэкл", "∞", null);

    const day = this.selected === BACKLOG ? null : this.selected;
    const head = root.createDiv("wp-m-head");
    const st = this.dayStats(day);
    if (day) {
      const rel = relativeLabel(day);
      head.createDiv({ cls: "wp-m-title", text: rel ? `${rel}, ${humanDay(day)}` : `${cap(DAY_LONG[weekday(day) - 1])}, ${humanDay(day)}` });
    } else head.createDiv({ cls: "wp-m-title", text: "Бэклог" });
    head.createDiv({ cls: "wp-muted", text: [st.total ? `${st.done}/${st.total}` : "Пусто", st.minutes ? fmtMinutes(st.minutes) : ""].filter(Boolean).join(" · ") });

    this.renderQuickAdd(root, day, "mobile", "Добавить: 14:00 1ч #тег !! …");
    const list = root.createDiv({ cls: "wp-list wp-m-list wp-scroll-y", attr: { "data-drop": day ?? BACKLOG, "data-drop-list": "", "data-scroll-key": "mobile" } });
    const tasks = this.tasksFor(day);
    for (const t of tasks) this.renderCard(list, t);
    if (!tasks.length) list.createDiv({ cls: "wp-empty", text: day === now ? "На сегодня всё чисто ✨" : "Нет задач" });
    list.createDiv("wp-list-end");
    root.createDiv({ cls: "wp-hint", text: "Удерживай задачу, чтобы перетащить на другой день · свайп → завтра · свайп ← готово" });
  }
}
