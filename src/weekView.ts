import { ItemView, Menu, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import {
  DAY_LONG, DAY_SHORT, DateStr, MONTH_NOM, addDays, addMonths, dayNum, fmtMinutes, humanDay, isoWeek, parse, relativeLabel,
  startOfWeek, today, weekDays, weekLabel, weekday,
} from "./dates";
import { DragController, DropInfo } from "./drag";
import { PRIORITY_LABEL, Priority, Task, compareInDay, displayTitle, projectOf, recurrenceLabel } from "./model";
import { TaskModal } from "./modal";
import { parseQuick } from "./quickadd";
import type WeekPlannerPlugin from "./main";

export const VIEW_WEEK = "week-planner-view";
const BACKLOG = "backlog";
const MOBILE_BREAKPOINT = 720;
const HOUR_PX = 44;
export const STALE_AT = 5;

type Mode = "week" | "month" | "timeline";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function tagColor(tag: string): number {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}

const toMin = (hhmm: string) => parseInt(hhmm.slice(0, 2)) * 60 + parseInt(hhmm.slice(3, 5));
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export class WeekView extends ItemView {
  private weekStart: DateStr = startOfWeek(today());
  private selected: DateStr = today(); // mobile: which day is shown
  private mode: Mode = "week";
  private tagFilter: string | null = null;
  private drag: DragController | null = null;
  private compact = false;
  private mobile = false;
  private focusKey: string | null = null;
  private resizeObs: ResizeObserver | null = null;
  private timeIndicator: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: WeekPlannerPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_WEEK; }
  getDisplayText() { return "Неделя"; }
  getIcon() { return "calendar-days"; }

  private get store() { return this.plugin.store; }
  private get settings() { return this.plugin.settings; }

  async onOpen() {
    this.contentEl.addClass("wp-root");
    this.registerEvent(this.store.on("changed", () => this.render()));
    this.registerEvent(this.plugin.focus.on("tick", () => this.updateFocusBadge()));
    this.drag = new DragController(this.contentEl, {
      onDrop: (id, target, before, info) => this.onDrop(id, target, before, info),
      onHover: (el, top) => this.showTimeIndicator(el, top),
      onSwipe: (id, dir) => {
        const t = this.store.find(id);
        if (!t) return;
        if (dir === "left") this.store.toggle(id);
        else {
          const base = t.due && t.due > today() ? t.due : today();
          this.store.move(id, addDays(base, 1), null);
          new Notice(`«${displayTitle(t)}» → завтра`);
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

  showWeekOf(day: DateStr) {
    this.weekStart = startOfWeek(day);
    this.selected = day;
    if (this.mode === "month") this.mode = "week";
    this.render();
  }

  focusQuickAdd() {
    this.contentEl.querySelector<HTMLInputElement>(".wp-quick input")?.focus();
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.render();
  }

  private shift(n: number) {
    if (this.mode === "month") {
      const anchor = addMonths(this.monthAnchor(), n);
      this.weekStart = startOfWeek(anchor);
    } else {
      this.weekStart = addDays(this.weekStart, 7 * n);
      if (this.selected !== BACKLOG) this.selected = addDays(this.selected, 7 * n);
    }
    this.render();
  }

  /** First day of the month the current week mostly belongs to. */
  private monthAnchor(): DateStr {
    const mid = addDays(this.weekStart, 3);
    return mid.slice(0, 8) + "01";
  }

  private onKey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement).closest("input, textarea, select");
    if (typing) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "л")) {
      e.preventDefault();
      this.plugin.openPalette();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey && !e.key.startsWith("Arrow")) return;
    const k = e.key;
    if (k === "n" || k === "т") { e.preventDefault(); this.focusQuickAdd(); }
    else if (k === "t" || k === "е") this.goToday();
    else if (k === "[" || k === "х" || (k === "ArrowLeft" && e.altKey)) this.shift(-1);
    else if (k === "]" || k === "ъ" || (k === "ArrowRight" && e.altKey)) this.shift(1);
    else if (k === "d" || k === "в") this.toggleDone();
    else if (k === "w" || k === "ц") this.setMode("week");
    else if (k === "m" || k === "ь") this.setMode("month");
    else if ((k === "l" || k === "д") && !this.mobile) this.setMode("timeline");
    else if (k === "p" || k === "з") this.plugin.openPlanning(this.weekStart);
    else if (k === "f" || k === "а") this.plugin.activateFocus();
  }

  private toggleDone() {
    this.settings.showDone = !this.settings.showDone;
    this.plugin.saveSettings();
    this.render();
  }

  // ---------- data ----------

  private visible(t: Task) {
    if (this.tagFilter && !t.tags.includes(this.tagFilter)) return false;
    if (!this.settings.showDone && t.done) return false;
    return true;
  }

  private tasksFor(day: DateStr | null): Task[] {
    const all = this.store.all();
    const order = new Map(all.map((t, i) => [t.id, i]));
    return all
      .filter((t) => this.store.effectiveDue(t) === day && this.visible(t))
      .sort((a, b) => compareInDay(a, b, order.get(a.id)!, order.get(b.id)!));
  }

  private dayStats(day: DateStr | null) {
    const list = this.store.all().filter((t) => this.store.effectiveDue(t) === day && (!this.tagFilter || t.tags.includes(this.tagFilter)));
    const done = list.filter((t) => t.done).length;
    const minutes = list.filter((t) => !t.done).reduce((s, t) => s + t.duration, 0);
    return { total: list.length, done, minutes };
  }

  // ---------- drop ----------

  private onDrop(id: string, target: string, before: string | null, info: DropInfo) {
    const due = target === BACKLOG ? null : target;
    const t = this.store.find(id);
    if (!t) return;
    if (info.el.hasAttribute("data-drop-time")) {
      const rect = info.el.getBoundingClientRect();
      const min = this.settings.timelineStart * 60 + Math.round(((info.top - rect.top) / HOUR_PX) * 4) * 15;
      const clamped = Math.max(this.settings.timelineStart * 60, Math.min(this.settings.timelineEnd * 60 - 15, min));
      const patch: Partial<Task> = { time: toHHMM(clamped) };
      if (!t.duration) patch.duration = 30;
      if (t.source) {
        new Notice("Время можно задать только у задач из файла задач");
        this.store.move(id, due, null);
      } else this.store.move(id, due, null, patch);
      return;
    }
    if (info.el.hasAttribute("data-untimed") && t.time && !t.source) {
      this.store.move(id, due, before, { time: null });
      return;
    }
    if (t.source && before === null && t.due === due) return;
    this.store.move(id, due, before);
  }

  private showTimeIndicator(el: HTMLElement | null, top: number) {
    this.timeIndicator?.remove();
    this.timeIndicator = null;
    if (!el?.hasAttribute("data-drop-time")) return;
    const rect = el.getBoundingClientRect();
    const steps = Math.round(((top - rect.top) / HOUR_PX) * 4);
    const min = Math.max(this.settings.timelineStart * 60, Math.min(this.settings.timelineEnd * 60 - 15, this.settings.timelineStart * 60 + steps * 15));
    const ind = el.createDiv({ cls: "wp-time-indicator", text: toHHMM(min) });
    ind.style.top = `${((min - this.settings.timelineStart * 60) / 60) * HOUR_PX}px`;
    this.timeIndicator = ind;
  }

  // ---------- render ----------

  render() {
    const root = this.contentEl;
    const scroll = this.saveScroll();
    root.empty();
    this.timeIndicator = null;
    const mode = this.mobile && this.mode === "timeline" ? "week" : this.mode;
    root.toggleClass("is-mobile", this.mobile);
    root.toggleClass("is-compact", this.compact);
    root.dataset.mode = mode;
    this.renderToolbar(root, mode);
    if (mode === "month") this.renderMonth(root);
    else if (this.mobile) this.renderMobile(root);
    else if (mode === "timeline") this.renderTimeline(root);
    else this.renderDesktop(root);
    this.restoreScroll(scroll);
    if (this.focusKey) {
      root.querySelector<HTMLInputElement>(`input[data-key="${this.focusKey}"]`)?.focus();
      this.focusKey = null;
    }
  }

  private saveScroll() {
    const map = new Map<string, [number, number]>();
    this.contentEl.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((el) => map.set(el.dataset.scrollKey!, [el.scrollLeft, el.scrollTop]));
    return map;
  }

  private restoreScroll(map: Map<string, [number, number]>) {
    this.contentEl.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((el) => {
      const v = map.get(el.dataset.scrollKey!);
      if (v) [el.scrollLeft, el.scrollTop] = v;
    });
  }

  private iconBtn(parent: HTMLElement, icon: string, label: string, fn: (e: MouseEvent) => void, cls = "") {
    const b = parent.createEl("button", { cls: `wp-icon-btn clickable-icon ${cls}`, attr: { "aria-label": label } });
    setIcon(b, icon);
    b.onclick = fn;
    return b;
  }

  private renderToolbar(root: HTMLElement, mode: Mode) {
    const bar = root.createDiv("wp-toolbar");
    const nav = bar.createDiv("wp-nav");
    const unit = mode === "month" ? "месяц" : "неделя";
    this.iconBtn(nav, "chevron-left", `Прошлый ${unit === "месяц" ? "месяц" : "неделя"} ([)`, () => this.shift(-1));
    nav.createEl("button", { text: "Сегодня", cls: "wp-today-btn" }).onclick = () => this.goToday();
    this.iconBtn(nav, "chevron-right", `Следующ${unit === "месяц" ? "ий месяц" : "ая неделя"} (])`, () => this.shift(1));
    const title = nav.createDiv("wp-week-title");
    if (mode === "month") {
      const a = parse(this.monthAnchor());
      title.createSpan({ text: `${MONTH_NOM[a.getMonth()]} ${a.getFullYear()}` });
    } else {
      title.createSpan({ text: weekLabel(this.weekStart) });
      title.createSpan({ cls: "wp-week-num", text: `W${isoWeek(this.weekStart)}` });
    }

    const seg = bar.createDiv("wp-segmented wp-mode");
    const modes: [Mode, string, string][] = [["week", "Неделя", "w"], ["month", "Месяц", "m"]];
    if (!this.mobile) modes.push(["timeline", "Шкала", "l"]);
    for (const [m, label, key] of modes) {
      const b = seg.createEl("button", { text: label, cls: "wp-seg-btn", attr: { "aria-label": `${label} (${key})` } });
      if (mode === m) b.addClass("is-active");
      b.onclick = () => this.setMode(m);
    }

    if (mode !== "month") {
      const days = weekDays(this.weekStart);
      const weekTasks = this.store.all().filter((t) => t.due && t.due >= days[0] && t.due <= days[6]);
      const done = weekTasks.filter((t) => t.done).length;
      const prog = bar.createDiv({ cls: "wp-week-progress", attr: { "aria-label": `Выполнено ${done} из ${weekTasks.length}` } });
      const pct = weekTasks.length ? Math.round((done / weekTasks.length) * 100) : 0;
      prog.createDiv("wp-bar").createDiv({ cls: "wp-bar-fill", attr: { style: `width:${pct}%` } });
      prog.createSpan({ cls: "wp-muted", text: `${done}/${weekTasks.length} · ${pct}%` });
    }

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
    this.iconBtn(right, "search", "Найти задачу (⌘K)", () => this.plugin.openPalette());
    this.iconBtn(right, "wand-2", "Спланировать неделю (p)", () => this.plugin.openPlanning(this.weekStart));
    this.iconBtn(right, "layout-template", "Шаблоны", (e) => this.templatesMenu(e));
    this.iconBtn(right, "timer", "Фокус: сегодня и помодоро (f)", () => this.plugin.activateFocus(), this.plugin.focus.running ? "is-running" : "");
    this.iconBtn(right, this.settings.showDone ? "eye" : "eye-off", this.settings.showDone ? "Скрыть выполненные (d)" : "Показать выполненные (d)", () => this.toggleDone());
    if (!this.mobile && mode === "week") this.iconBtn(right, this.compact ? "unfold-vertical" : "fold-vertical", "Компактный вид", () => { this.compact = !this.compact; this.render(); });
    this.iconBtn(right, "flame", "Привычки и статистика", () => this.plugin.activateHabits());
    this.iconBtn(right, "file-text", "Открыть файл задач", () => this.openTasksFile());
  }

  private async templatesMenu(e: MouseEvent) {
    const templates = await this.store.loadTemplates();
    const m = new Menu();
    if (!templates.length) m.addItem((i) => i.setTitle("Шаблонов пока нет").setDisabled(true));
    for (const tpl of templates)
      m.addItem((i) => i.setTitle(`Применить к неделе: ${tpl.name}`).setIcon("layout-template").onClick(async () => {
        await this.store.applyTemplate(tpl, this.weekStart, null);
        new Notice(`Шаблон «${tpl.name}»: добавлено задач ${tpl.tasks.length}`);
      }));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Сохранить эту неделю как шаблон").setIcon("save").onClick(() => {
      const days = weekDays(this.weekStart);
      const tasks = this.store.tasks().filter((t) => t.due && t.due >= days[0] && t.due <= days[6]);
      this.plugin.promptText("Название шаблона недели", "Моя неделя", async (name) => {
        await this.store.saveTemplate(name, tasks, true);
        new Notice(`Шаблон «${name}» сохранён`);
      });
    }));
    m.addItem((i) => i.setTitle("Редактировать шаблоны").setIcon("pencil").onClick(() => this.plugin.openFile(this.settings.templatesFile)));
    m.showAtMouseEvent(e);
  }

  private async dayMenu(e: MouseEvent, day: DateStr) {
    const templates = await this.store.loadTemplates();
    const m = new Menu();
    m.addItem((i) => i.setTitle("Заметка дня").setIcon("calendar-check").onClick(() => this.plugin.openDaily(day)));
    m.addItem((i) => i.setTitle("Фокус на этом дне").setIcon("timer").onClick(() => this.plugin.activateFocus()));
    m.addSeparator();
    for (const tpl of templates)
      m.addItem((i) => i.setTitle(`Шаблон: ${tpl.name}`).setIcon("layout-template").onClick(() => this.store.applyTemplate(tpl, this.weekStart, day)));
    m.addItem((i) => i.setTitle("Сохранить день как шаблон").setIcon("save").onClick(() => {
      const tasks = this.store.tasks().filter((t) => t.due === day);
      this.plugin.promptText("Название шаблона дня", cap(DAY_LONG[weekday(day) - 1]), async (name) => {
        await this.store.saveTemplate(name, tasks, false);
        new Notice(`Шаблон «${name}» сохранён`);
      });
    }));
    m.addSeparator();
    const open = this.store.tasks().filter((t) => t.due === day && !t.done);
    if (open.length)
      m.addItem((i) => i.setTitle(`Перенести невыполненные (${open.length}) на следующий день`).setIcon("arrow-right").onClick(async () => {
        for (const t of open) await this.store.move(t.id, addDays(day, 1), null);
      }));
    m.showAtMouseEvent(e);
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

  // ---------- week (desktop) ----------

  private renderDesktop(root: HTMLElement) {
    const grid = root.createDiv({ cls: "wp-grid wp-scroll-x", attr: { "data-scroll-key": "grid" } });
    this.renderColumn(grid, null);
    for (const d of weekDays(this.weekStart)) this.renderColumn(grid, d);
  }

  private colClasses(col: HTMLElement, day: DateStr | null) {
    const now = today();
    if (day === null) return col.addClass("is-backlog");
    if (day === now) col.addClass("is-today");
    if (day < now) col.addClass("is-past");
    if (weekday(day) >= 6) col.addClass("is-weekend");
  }

  private renderColHead(col: HTMLElement, day: DateStr | null) {
    const head = col.createDiv("wp-col-head");
    const stats = this.dayStats(day);
    const line1 = head.createDiv("wp-col-title");
    if (day) {
      const link = line1.createSpan({ cls: "wp-day-link", attr: { "aria-label": "Заметка дня" } });
      link.createSpan({ cls: "wp-dow", text: DAY_SHORT[weekday(day) - 1] });
      link.createSpan({ cls: "wp-daynum", text: String(dayNum(day)) });
      link.onclick = () => this.plugin.openDaily(day);
      const rel = relativeLabel(day);
      if (rel) line1.createSpan({ cls: "wp-rel", text: rel });
    } else {
      line1.createSpan({ cls: "wp-dow", text: "Бэклог" });
    }
    line1.createSpan({ cls: "wp-count", text: stats.total ? `${stats.done}/${stats.total}` : "" });
    if (day) {
      const more = line1.createSpan({ cls: "wp-col-menu clickable-icon", attr: { "aria-label": "Действия с днём" } });
      setIcon(more, "more-horizontal");
      more.onclick = (e) => this.dayMenu(e, day);
      head.addEventListener("contextmenu", (e) => { e.preventDefault(); this.dayMenu(e, day); });
      const load = head.createDiv("wp-load");
      const cap = this.settings.dayCapacityHours * 60;
      const ratio = cap ? stats.minutes / cap : 0;
      if (ratio > 1) col.addClass("is-overloaded");
      const bar = load.createDiv("wp-bar");
      bar.createDiv({ cls: `wp-bar-fill ${ratio > 1 ? "is-over" : ratio > 0.8 ? "is-high" : ""}`, attr: { style: `width:${Math.min(100, ratio * 100)}%` } });
      load.createSpan({
        cls: "wp-muted", text: stats.minutes ? fmtMinutes(stats.minutes) + (ratio > 1 ? ` · +${fmtMinutes(stats.minutes - cap)}` : "") : "",
        attr: ratio > 1 ? { "aria-label": `Перегруз: план больше ${this.settings.dayCapacityHours}ч` } : {},
      });
    }
  }

  private renderColumn(grid: HTMLElement, day: DateStr | null) {
    const col = grid.createDiv("wp-col");
    this.colClasses(col, day);
    this.renderColHead(col, day);
    const list = col.createDiv({ cls: "wp-list wp-scroll-y", attr: { "data-drop": day ?? BACKLOG, "data-drop-list": "", "data-scroll-key": day ?? BACKLOG } });
    for (const t of this.tasksFor(day)) this.renderCard(list, t);
    list.createDiv("wp-list-end");
    const foot = col.createDiv("wp-col-foot");
    this.renderQuickAdd(foot, day, `col-${day ?? BACKLOG}`, "Добавить…");
  }

  // ---------- timeline ----------

  private renderTimeline(root: HTMLElement) {
    const s = this.settings;
    const days = weekDays(this.weekStart);
    const wrap = root.createDiv("wp-tl");
    const head = wrap.createDiv("wp-tl-row wp-tl-head");
    head.createDiv("wp-tl-gutter");
    for (const d of days) {
      const col = head.createDiv("wp-col wp-tl-headcol");
      this.colClasses(col, d);
      this.renderColHead(col, d);
      const untimed = col.createDiv({ cls: "wp-list wp-tl-untimed wp-scroll-y", attr: { "data-drop": d, "data-drop-list": "", "data-untimed": "", "data-scroll-key": `u-${d}` } });
      for (const t of this.tasksFor(d).filter((t) => !t.time)) this.renderCard(untimed, t);
      untimed.createDiv("wp-list-end");
    }
    const scroller = wrap.createDiv({ cls: "wp-tl-scroll wp-scroll-y", attr: { "data-scroll-key": "timeline" } });
    const body = scroller.createDiv("wp-tl-row wp-tl-body");
    const hours = s.timelineEnd - s.timelineStart;
    const gutter = body.createDiv("wp-tl-gutter");
    gutter.style.height = `${hours * HOUR_PX}px`;
    for (let h = 0; h < hours; h++) gutter.createDiv({ cls: "wp-tl-hour", text: `${String(s.timelineStart + h).padStart(2, "0")}:00` }).style.top = `${h * HOUR_PX}px`;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const d of days) {
      const col = body.createDiv({ cls: "wp-tl-day", attr: { "data-drop": d, "data-drop-time": "" } });
      this.colClasses(col, d);
      col.style.height = `${hours * HOUR_PX}px`;
      for (let h = 0; h < hours; h++) col.createDiv("wp-tl-line").style.top = `${h * HOUR_PX}px`;
      if (d === today() && nowMin >= s.timelineStart * 60 && nowMin < s.timelineEnd * 60)
        col.createDiv("wp-tl-now").style.top = `${((nowMin - s.timelineStart * 60) / 60) * HOUR_PX}px`;
      const timed = this.tasksFor(d).filter((t) => t.time);
      // Lay overlapping blocks side by side.
      const items = timed.map((t) => ({ t, start: toMin(t.time!), end: toMin(t.time!) + Math.max(t.duration || 30, 20), lane: 0, lanes: 1 }));
      items.sort((a, b) => a.start - b.start);
      let cluster: typeof items = [];
      let clusterEnd = -1;
      const flush = () => {
        const laneEnds: number[] = [];
        for (const it of cluster) {
          let lane = laneEnds.findIndex((e) => e <= it.start);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = it.end;
          it.lane = lane;
        }
        for (const it of cluster) it.lanes = laneEnds.length;
        cluster = [];
      };
      for (const it of items) {
        if (it.start >= clusterEnd && cluster.length) flush();
        cluster.push(it);
        clusterEnd = Math.max(clusterEnd, it.end);
      }
      flush();
      for (const it of items) {
        const card = this.renderCard(col, it.t);
        card.addClass("wp-tl-block");
        card.style.top = `${((it.start - s.timelineStart * 60) / 60) * HOUR_PX}px`;
        card.style.height = `${((it.end - it.start) / 60) * HOUR_PX - 2}px`;
        card.style.left = `calc(${(it.lane / it.lanes) * 100}% + 2px)`;
        card.style.width = `calc(${100 / it.lanes}% - 4px)`;
      }
    }
    // Start scrolled to the morning on first open.
    if (!scroller.dataset.inited) requestAnimationFrame(() => {
      if (scroller.scrollTop === 0) scroller.scrollTop = Math.max(0, (Math.max(8, now.getHours() - 1) - s.timelineStart) * HOUR_PX);
    });
  }

  // ---------- month ----------

  private renderMonth(root: HTMLElement) {
    const anchor = this.monthAnchor();
    const month = anchor.slice(0, 7);
    const start = startOfWeek(anchor);
    const now = today();
    const wrap = root.createDiv("wp-month-wrap");
    if (!this.mobile) {
      const back = wrap.createDiv("wp-col is-backlog wp-month-backlog");
      this.renderColHead(back, null);
      const list = back.createDiv({ cls: "wp-list wp-scroll-y", attr: { "data-drop": BACKLOG, "data-drop-list": "", "data-scroll-key": "m-backlog" } });
      for (const t of this.tasksFor(null)) this.renderCard(list, t);
      list.createDiv("wp-list-end");
    }
    const grid = wrap.createDiv("wp-month");
    for (const d of DAY_SHORT) grid.createDiv({ cls: "wp-month-dow", text: d });
    let weeks = 0;
    for (let w = start; w.slice(0, 7) <= month || weeks < 5; w = addDays(w, 7)) {
      if (weeks >= 6) break;
      weeks++;
      for (const d of weekDays(w)) {
        const cell = grid.createDiv({ cls: "wp-month-cell", attr: { "data-drop": d, "data-drop-list": "" } });
        if (d.slice(0, 7) !== month) cell.addClass("is-other");
        if (d === now) cell.addClass("is-today");
        if (d < now) cell.addClass("is-past");
        const top = cell.createDiv("wp-month-top");
        const num = top.createSpan({ cls: "wp-month-num", text: String(dayNum(d)), attr: { "aria-label": "Открыть неделю" } });
        num.onclick = () => this.showWeekOf(d);
        const st = this.dayStats(d);
        if (st.total) top.createSpan({ cls: "wp-count", text: `${st.done}/${st.total}` });
        const tasks = this.tasksFor(d);
        if (this.mobile) {
          const dots = cell.createDiv("wp-month-dots");
          for (const t of tasks.slice(0, 6)) dots.createDiv({ cls: `wp-dot prio-${t.priority} ${t.done ? "is-done" : ""}` });
          cell.onclick = () => this.showWeekOf(d);
        } else {
          for (const t of tasks) this.renderCard(cell, t, true);
          cell.createDiv("wp-list-end");
        }
      }
    }
    grid.style.gridTemplateRows = `auto repeat(${weeks}, 1fr)`;
  }

  // ---------- cards ----------

  private renderCard(parent: HTMLElement, t: Task, mini = false): HTMLElement {
    const card = parent.createDiv({ cls: `wp-card prio-${t.priority}`, attr: { "data-id": t.id } });
    if (mini) card.addClass("is-mini");
    if (t.done) card.addClass("is-done");
    if (t.source) card.addClass("is-external");
    const stale = !t.done && t.moved >= STALE_AT;
    if (t.moved >= 3 && !t.done) card.addClass("is-stale");
    if (this.plugin.focus.taskId === t.id) card.addClass("is-focus");
    const overdue = !!t.source && !t.done && t.due! < today();
    const row = card.createDiv("wp-card-row");
    const cb = row.createEl("input", { attr: { type: "checkbox", "aria-label": "Выполнено" }, cls: "task-list-item-checkbox wp-check" });
    cb.checked = t.done;
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      this.store.toggle(t.id);
    });
    const body = row.createDiv("wp-card-body");
    const title = body.createDiv({ cls: "wp-card-title", text: displayTitle(t) });
    if (stale) {
      const warn = title.createSpan({ cls: "wp-stale-icon", attr: { "aria-label": `Переносилась ${t.moved} раз — пора решить, что с ней делать` } });
      setIcon(warn, "alert-triangle");
    }
    if (!mini) {
      const meta = body.createDiv("wp-card-meta");
      if (t.time) meta.createSpan({ cls: "wp-meta wp-time", text: t.time });
      if (t.duration) meta.createSpan({ cls: "wp-meta", text: fmtMinutes(t.duration) });
      if (t.spent) meta.createSpan({ cls: "wp-meta wp-spent", text: `⏱${fmtMinutes(t.spent)}`, attr: { "aria-label": "Потрачено в фокусе" } });
      if (t.recurrence) setIcon(meta.createSpan({ cls: "wp-meta wp-icon-meta", attr: { "aria-label": recurrenceLabel(t.recurrence) } }), "repeat");
      if (t.moved) meta.createSpan({ cls: "wp-meta wp-moved", text: `↪${t.moved}`, attr: { "aria-label": `Переносилась ${t.moved} раз(а)` } });
      if (overdue) meta.createSpan({ cls: "wp-meta wp-overdue", text: `с ${humanDay(t.due!)}` });
      if (t.subtasks.length) {
        const done = t.subtasks.filter((s) => s.done).length;
        const s = meta.createSpan({ cls: "wp-meta wp-icon-meta" });
        setIcon(s, "list-checks");
        s.createSpan({ text: `${done}/${t.subtasks.length}` });
      }
      const project = projectOf(t);
      if (project) {
        const p = meta.createSpan({ cls: "wp-project", attr: { "aria-label": "Открыть проект" } });
        setIcon(p.createSpan(), "folder");
        p.createSpan({ text: project });
        p.addEventListener("click", (e) => {
          e.stopPropagation();
          this.app.workspace.openLinkText(project, t.source?.path ?? this.settings.tasksFile, "tab");
        });
      }
      if (t.source) {
        const src = meta.createSpan({ cls: "wp-meta wp-icon-meta wp-source", attr: { "aria-label": `Из заметки: ${t.source.path}` } });
        setIcon(src, "file-symlink");
        src.createSpan({ text: t.source.path.split("/").pop()!.replace(/\.md$/, "") });
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
    }

    card.addEventListener("click", () => this.openTask(t));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.cardMenu(t).showAtMouseEvent(e);
    });
    return card;
  }

  private openTask(t: Task) {
    if (t.source) this.plugin.openSource(t);
    else new TaskModal(this.app, this.plugin, t, t.due).open();
  }

  private updateFocusBadge() {
    const btn = this.contentEl.querySelector(".wp-toolbar .wp-icon-btn[aria-label^='Фокус']");
    btn?.toggleClass("is-running", this.plugin.focus.running);
  }

  cardMenu(t: Task) {
    const m = new Menu();
    const now = today();
    const moveTo = (title: string, icon: string, due: DateStr | null) =>
      m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => this.store.move(t.id, due, null)));
    m.addItem((i) => i.setTitle(t.done ? "Вернуть в работу" : "Выполнено").setIcon("check").onClick(() => this.store.toggle(t.id)));
    if (!t.done && !t.source) m.addItem((i) => i.setTitle("Фокус на задаче").setIcon("timer").onClick(() => this.plugin.activateFocus(t.id)));
    m.addSeparator();
    moveTo("На сегодня", "sun", now);
    moveTo("На завтра", "sunrise", addDays(now, 1));
    moveTo("На следующую неделю", "calendar-plus", addDays(startOfWeek(now), 7));
    moveTo("В бэклог", "inbox", null);
    if (t.source) {
      m.addSeparator();
      m.addItem((i) => i.setTitle("Открыть заметку").setIcon("file-symlink").onClick(() => this.plugin.openSource(t)));
      return m;
    }
    m.addSeparator();
    const prios: Priority[] = [3, 2, 1, 0, -1];
    for (const p of prios)
      m.addItem((i) => i.setTitle(`Приоритет: ${PRIORITY_LABEL[p]}`).setChecked(t.priority === p).onClick(() => this.store.update(t.id, { priority: p })));
    m.addSeparator();
    if (t.moved) m.addItem((i) => i.setTitle("Сбросить счётчик переносов").setIcon("rotate-ccw").onClick(() => this.store.update(t.id, { moved: 0 })));
    m.addItem((i) => i.setTitle("Дублировать").setIcon("copy").onClick(() => {
      const { id, ...rest } = t;
      void id;
      this.store.add({ ...rest, done: false, doneDate: null, moved: 0, spent: 0 }, t.due);
    }));
    m.addItem((i) => i.setTitle("Открыть в файле").setIcon("file-text").onClick(() => this.openTasksFile(t)));
    m.addItem((i) => i.setTitle("Удалить").setIcon("trash").setWarning(true).onClick(() => this.store.remove(t.id)));
    return m;
  }

  private async openTasksFile(t?: Task) {
    const file = this.app.vault.getAbstractFileByPath(this.settings.tasksFile);
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
      if (st.total && !open) {
        dot.setText("✓");
        dot.addClass("is-clear");
      } else if (open) dot.setText(String(open));
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
      const t = head.createDiv({ cls: "wp-m-title", text: rel ? `${rel}, ${humanDay(day)}` : `${cap(DAY_LONG[weekday(day) - 1])}, ${humanDay(day)}` });
      t.onclick = () => this.plugin.openDaily(day);
    } else head.createDiv({ cls: "wp-m-title", text: "Бэклог" });
    const right = head.createDiv("wp-m-head-right");
    right.createSpan({ cls: "wp-muted", text: [st.total ? `${st.done}/${st.total}` : "Пусто", st.minutes ? fmtMinutes(st.minutes) : ""].filter(Boolean).join(" · ") });
    if (day) this.iconBtn(right, "more-horizontal", "Действия с днём", (e) => this.dayMenu(e, day));

    this.renderQuickAdd(root, day, "mobile", "Добавить: 14:00 1ч #тег !! …");
    const list = root.createDiv({ cls: "wp-list wp-m-list wp-scroll-y", attr: { "data-drop": day ?? BACKLOG, "data-drop-list": "", "data-scroll-key": "mobile" } });
    const tasks = this.tasksFor(day);
    for (const t of tasks) this.renderCard(list, t);
    if (!tasks.length) list.createDiv({ cls: "wp-empty", text: day === now ? "На сегодня всё чисто ✨" : "Нет задач" });
    list.createDiv("wp-list-end");
    root.createDiv({ cls: "wp-hint", text: "Удерживай задачу, чтобы перетащить на другой день · свайп → завтра · свайп ← готово" });
  }
}
