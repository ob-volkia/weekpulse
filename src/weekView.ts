import { ItemView, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";
import { DateStr, addDays, addMonths, humanDay, startOfWeek, today } from "./dates";
import { DragController, DropInfo } from "./drag";
import { PRIORITY_LABEL, Priority, Task, compareInDay, displayTitle } from "./model";
import { CalEvent } from "./ics";
import { SavedFilter } from "./store";
import { TaskModal } from "./modal";
import type WeekPlannerPlugin from "./main";
import { BACKLOG, MOBILE_BREAKPOINT, HOUR_PX, STALE_AT, Mode, tagColor, toHHMM } from "./week/shared";
import { updateFocusBadge } from "./week/card";
import { renderTimeline, renderMobileTimeline, showTimeIndicator } from "./week/timeline";
import { renderMonth } from "./week/month";
import { renderMobile } from "./week/mobile";
import { renderToolbar } from "./week/toolbar";
import { applyCursor, cursorKey } from "./week/keyboard";
import { renderDesktop, renderSelectionBar } from "./week/columns";

export { STALE_AT, tagColor };
export const VIEW_WEEK = "week-planner-view";

/** The week screen: holds view state and data helpers; rendering lives in ./week/*. */
export class WeekView extends ItemView {
  weekStart: DateStr = startOfWeek(today());
  selected: DateStr = today(); // mobile: which day is shown
  mode: Mode = "week";
  filter: SavedFilter = { name: "", tag: null, minPriority: null, goal: null };
  selection = new Set<string>();
  cursor: string | null = null; // keyboard-selected task (desktop)
  flipTimer: number | null = null;
  flipEl: HTMLElement | null = null;
  selectMode = false;
  drag: DragController | null = null;
  compact = false;
  mobile = false;
  focusKey: string | null = null;
  resizeObs: ResizeObserver | null = null;
  timeIndicator: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, public plugin: WeekPlannerPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_WEEK; }
  getDisplayText() { return "Неделя"; }
  getIcon() { return "calendar-days"; }

  get store() { return this.plugin.store; }
  get settings() { return this.plugin.settings; }

  async onOpen() {
    this.contentEl.addClass("wp-root");
    this.registerEvent(this.store.on("changed", () => this.render()));
    this.registerEvent(this.plugin.focus.on("tick", () => updateFocusBadge(this)));
    this.drag = new DragController(this.contentEl, {
      onDrop: (id, target, before, info) => this.onDrop(id, target, before, info),
      onHover: (el, top) => {
        showTimeIndicator(this, el, top);
        this.flipOnHover(el);
      },
      onSwipe: (id, dir) => {
        const t = this.store.find(id);
        if (!t) return;
        if (dir === "left") this.store.toggle(id);
        else {
          const base = t.due && t.due > today() ? t.due : today();
          this.store.move(id, addDays(base, 1), null);
          new Notice(`«${displayTitle(t)}» перенесена на завтра`);
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

  setMode(m: Mode) {
    this.mode = m;
    this.render();
  }

  shift(n: number) {
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
  monthAnchor(): DateStr {
    const mid = addDays(this.weekStart, 3);
    return mid.slice(0, 8) + "01";
  }

  onKey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement).closest("input, textarea, select");
    if (typing) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "я")) {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.key === "Escape" && (this.selection.size || this.selectMode)) {
      this.selection.clear();
      this.selectMode = false;
      this.render();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "л")) {
      e.preventDefault();
      this.plugin.openPalette();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey && !e.key.startsWith("Arrow")) return;
    if (!e.altKey && cursorKey(this, e)) return;
    const k = e.key;
    if (k === "n" || k === "т") { e.preventDefault(); this.newTask(); }
    else if (k === "t" || k === "е") this.goToday();
    else if (k === "[" || k === "х" || (k === "ArrowLeft" && e.altKey)) this.shift(-1);
    else if (k === "]" || k === "ъ" || (k === "ArrowRight" && e.altKey)) this.shift(1);
    else if (k === "d" || k === "в") this.toggleDone();
    else if (k === "w" || k === "ц") this.setMode("week");
    else if (k === "m" || k === "ь") this.setMode("month");
    else if (k === "l" || k === "д") this.setMode("timeline");
    else if (k === "p" || k === "з") this.plugin.openPlanning(this.weekStart);
    else if (k === "f" || k === "а") this.plugin.activateFocus();
  }

  // ---------- keyboard cursor (desktop) ----------

  toggleDone() {
    this.settings.showDone = !this.settings.showDone;
    this.plugin.saveSettings();
    this.render();
  }

  // ---------- data ----------

  matches(t: Task) {
    const f = this.filter;
    if (f.tag && !t.tags.includes(f.tag)) return false;
    if (f.minPriority != null && t.priority < f.minPriority) return false;
    if (f.goal && t.goal !== f.goal) return false;
    return true;
  }

  visible(t: Task) {
    if (!this.matches(t)) return false;
    if (!this.settings.showDone && t.done) return false;
    return true;
  }

  filterActive() {
    const f = this.filter;
    return !!(f.tag || f.minPriority != null || f.goal);
  }

  filterLabel() {
    const f = this.filter;
    if (f.name) return f.name;
    const parts: string[] = [];
    if (f.tag) parts.push("#" + f.tag);
    if (f.minPriority != null) parts.push(`${PRIORITY_LABEL[f.minPriority as Priority].toLowerCase()}+`);
    if (f.goal) parts.push(this.store.findGoal(f.goal)?.title ?? "цель");
    return parts.join(" · ");
  }

  setFilter(patch: Partial<SavedFilter>) {
    this.filter = { ...this.filter, name: "", ...patch };
    this.render();
  }

  events(day: DateStr): CalEvent[] {
    return this.store.eventsOn(day);
  }

  tasksFor(day: DateStr | null): Task[] {
    const all = this.store.all();
    const order = new Map(all.map((t, i) => [t.id, i]));
    return all
      .filter((t) => this.store.effectiveDue(t) === day && this.visible(t))
      .sort((a, b) => compareInDay(a, b, order.get(a.id)!, order.get(b.id)!));
  }

  dayStats(day: DateStr | null) {
    const list = this.store.all().filter((t) => this.store.effectiveDue(t) === day && this.matches(t));
    const done = list.filter((t) => t.done).length;
    const events = day ? this.events(day).reduce((s, e) => s + e.minutes, 0) : 0;
    const minutes = list.filter((t) => !t.done).reduce((s, t) => s + t.duration, 0) + events;
    return { total: list.length, done, minutes };
  }

  // ---------- drop ----------

  /** Holding a dragged card over ‹ / › flips the week, so it can be dropped on a day there. */
  flipOnHover(el: HTMLElement | null) {
    const flip = el?.dataset.flip;
    if (el === this.flipEl) return;
    if (this.flipTimer) window.clearTimeout(this.flipTimer);
    this.flipTimer = null;
    this.flipEl = el && flip ? el : null;
    if (!flip) return;
    this.flipTimer = window.setTimeout(() => {
      this.flipEl = null;
      this.shift(parseInt(flip));
    }, 650);
  }

  onDrop(id: string, target: string, before: string | null, info: DropInfo) {
    if (this.flipTimer) window.clearTimeout(this.flipTimer);
    this.flipTimer = null;
    this.flipEl = null;
    const t = this.store.find(id);
    if (!t) return;
    if (target === "week-prev" || target === "week-next") {
      const base = this.store.effectiveDue(t) ?? today();
      const to = addDays(base, target === "week-next" ? 7 : -7);
      this.store.move(id, to, null);
      new Notice(`«${displayTitle(t)}» → ${humanDay(to)}`);
      return;
    }
    const due = target === BACKLOG ? null : target;
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

  // ---------- render ----------

  render() {
    const root = this.contentEl;
    const scroll = this.saveScroll();
    root.empty();
    this.timeIndicator = null;
    const mode = this.mode;
    root.toggleClass("is-mobile", this.mobile);
    root.toggleClass("is-compact", this.compact);
    root.dataset.mode = mode;
    renderToolbar(this, root, mode);
    if (mode === "month") renderMonth(this, root);
    else if (this.mobile && mode === "timeline") renderMobileTimeline(this, root);
    else if (this.mobile) renderMobile(this, root);
    else if (mode === "timeline") renderTimeline(this, root);
    else renderDesktop(this, root);
    if (this.selectMode || this.selection.size) renderSelectionBar(this, root);
    this.restoreScroll(scroll);
    if (this.cursor) applyCursor(this);
    if (this.focusKey) {
      root.querySelector<HTMLInputElement>(`input[data-key="${this.focusKey}"]`)?.focus();
      this.focusKey = null;
    }
  }

  saveScroll() {
    const map = new Map<string, [number, number]>();
    this.contentEl.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((el) => map.set(el.dataset.scrollKey!, [el.scrollLeft, el.scrollTop]));
    return map;
  }

  restoreScroll(map: Map<string, [number, number]>) {
    this.contentEl.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((el) => {
      const v = map.get(el.dataset.scrollKey!);
      if (v) [el.scrollLeft, el.scrollTop] = v;
    });
  }

  newTask() {
    const day = this.selected !== BACKLOG && this.selected >= this.weekStart && this.selected <= addDays(this.weekStart, 6) ? this.selected : today();
    new TaskModal(this.app, this.plugin, null, day).open();
  }

  // ---------- goals dropdown ----------

  // ---------- week (desktop) ----------

  // ---------- timeline ----------

  // ---------- month ----------

  // ---------- calendar events ----------

  // ---------- multi-select & undo ----------

  async undo() {
    const label = await this.store.undo();
    new Notice(label ? `Отменено: ${label.toLowerCase()}` : "Нечего отменять");
  }

  // ---------- cards ----------

  async openTasksFile(t?: Task) {
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

}
