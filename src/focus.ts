import { Events, ItemView, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import { fmtMinutes, humanDay, today } from "./dates";
import { Task, compareInDay, displayTitle } from "./model";
import type WeekPlannerPlugin from "./main";
import { ICON, iconButton, iconText } from "./ui";

export const VIEW_FOCUS = "week-planner-focus";

type Phase = "work" | "break";

/** Pomodoro timer. Work time is credited to the task as [spent:: …] when a session ends or is stopped. */
export class FocusTimer extends Events {
  taskId: string | null = null;
  phase: Phase = "work";
  running = false;
  private endsAt = 0;
  private remaining = 0; // ms, while paused
  private workStartedAt = 0; // start of the current uncredited work stretch
  private credited = 0; // ms of the current session already credited
  private interval: number | null = null;
  completedToday = 0;
  private completedDay = today();

  constructor(private plugin: WeekPlannerPlugin) {
    super();
    this.remaining = this.length("work");
  }

  private length(p: Phase) {
    const s = this.plugin.settings;
    return (p === "work" ? s.pomodoroMinutes : s.breakMinutes) * 60_000;
  }

  get left(): number {
    return this.running ? Math.max(0, this.endsAt - Date.now()) : this.remaining;
  }

  get total(): number {
    return this.length(this.phase);
  }

  select(taskId: string | null) {
    if (taskId === this.taskId) return;
    this.creditWork();
    this.taskId = taskId;
    this.trigger("tick");
  }

  start(taskId?: string | null) {
    if (taskId !== undefined) this.select(taskId);
    if (this.running) return;
    this.running = true;
    this.endsAt = Date.now() + this.remaining;
    if (this.phase === "work") this.workStartedAt = Date.now();
    this.interval = window.setInterval(() => this.tick(), 1000);
    this.trigger("tick");
  }

  pause() {
    if (!this.running) return;
    this.remaining = this.left;
    this.running = false;
    this.stopInterval();
    this.creditWork();
    this.trigger("tick");
  }

  toggle() {
    if (this.running) this.pause();
    else this.start();
  }

  reset() {
    this.pause();
    this.phase = "work";
    this.remaining = this.length("work");
    this.trigger("tick");
  }

  skip() {
    this.pause();
    this.switchPhase();
  }

  private switchPhase() {
    this.phase = this.phase === "work" ? "break" : "work";
    this.remaining = this.length(this.phase);
    this.trigger("tick");
  }

  private tick() {
    if (this.left <= 0) {
      const wasWork = this.phase === "work";
      this.running = false;
      this.stopInterval();
      if (wasWork) {
        this.creditWork();
        if (this.completedDay !== today()) {
          this.completedDay = today();
          this.completedToday = 0;
        }
        this.completedToday++;
      }
      const task = this.taskId ? this.plugin.store.find(this.taskId) : null;
      this.plugin.notify(
        wasWork ? "Помодоро завершён" : "Перерыв окончен",
        wasWork ? `${task ? displayTitle(task) + " · " : ""}время на перерыв ${this.plugin.settings.breakMinutes} мин` : "Пора возвращаться к работе",
      );
      this.switchPhase();
      return;
    }
    this.trigger("tick");
  }

  /** Credit work done since the last credit to the selected task (whole minutes). */
  private creditWork() {
    if (this.phase !== "work" || !this.workStartedAt) return;
    const now = Date.now();
    const elapsed = now - this.workStartedAt + this.credited;
    const minutes = Math.floor(elapsed / 60_000);
    this.credited = elapsed - minutes * 60_000;
    this.workStartedAt = this.running ? now : 0;
    if (!this.running) this.credited = 0;
    if (minutes > 0 && this.taskId) this.plugin.store.addSpent(this.taskId, minutes);
  }

  private stopInterval() {
    if (this.interval) window.clearInterval(this.interval);
    this.interval = null;
  }

  destroy() {
    this.pause();
  }
}

export function fmtClock(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export class FocusView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: WeekPlannerPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_FOCUS; }
  getDisplayText() { return "Фокус"; }
  getIcon() { return "timer"; }

  private get timer() { return this.plugin.focus; }

  async onOpen() {
    this.contentEl.addClass("wp-root", "wp-focus-root");
    this.registerEvent(this.plugin.store.on("changed", () => this.render()));
    this.registerEvent(this.timer.on("tick", () => this.updateClock()));
    this.registerDomEvent(this.contentEl, "keydown", (e) => {
      if ((e.target as HTMLElement).closest("input")) return;
      if (e.key === " ") { e.preventDefault(); this.timer.toggle(); this.render(); }
    });
    this.contentEl.tabIndex = -1;
    this.render();
  }

  private todayTasks(): Task[] {
    const store = this.plugin.store;
    const all = store.all();
    const order = new Map(all.map((t, i) => [t.id, i]));
    return all.filter((t) => store.effectiveDue(t) === today())
      .sort((a, b) => compareInDay(a, b, order.get(a.id)!, order.get(b.id)!));
  }

  render() {
    const root = this.contentEl;
    root.empty();
    const tasks = this.todayTasks();
    const open = tasks.filter((t) => !t.done);
    if (!this.timer.taskId && open.length && !open[0].source) this.timer.taskId = open[0].id;
    const current = this.timer.taskId ? this.plugin.store.find(this.timer.taskId) : null;

    const bar = root.createDiv("wp-toolbar");
    bar.createDiv({ cls: "wp-week-title", text: `Сегодня, ${humanDay(today())}` });
    const right = bar.createDiv("wp-toolbar-right");
    const back = right.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Неделя" } });
    setIcon(back, "calendar-days");
    back.onclick = () => this.plugin.activateWeek();

    const page = root.createDiv("wp-focus-page");

    // ----- timer -----
    const panel = page.createDiv("wp-focus-panel");
    panel.createDiv({ cls: `wp-focus-phase is-${this.timer.phase}`, text: this.timer.phase === "work" ? "Работа" : "Перерыв" });
    const ring = panel.createDiv("wp-ring");
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    const bg = document.createElementNS(NS, "circle");
    bg.setAttribute("class", "wp-ring-bg");
    const fg = document.createElementNS(NS, "circle");
    fg.setAttribute("class", `wp-ring-fg is-${this.timer.phase}`);
    for (const c of [bg, fg]) {
      c.setAttribute("cx", "60");
      c.setAttribute("cy", "60");
      c.setAttribute("r", "54");
      svg.appendChild(c);
    }
    ring.appendChild(svg);
    ring.createDiv({ cls: "wp-ring-time", text: fmtClock(this.timer.left) });
    panel.createDiv({ cls: "wp-focus-task", text: current ? displayTitle(current) : "Выбери задачу справа" });

    const ctl = panel.createDiv("wp-focus-controls");
    const main = ctl.createEl("button", { cls: "mod-cta wp-focus-main", text: this.timer.running ? "Пауза" : "Старт" });
    main.onclick = () => { this.timer.toggle(); this.render(); };
    const reset = ctl.createEl("button", { text: "Сброс" });
    reset.onclick = () => { this.timer.reset(); this.render(); };
    const skip = ctl.createEl("button", { text: this.timer.phase === "work" ? "Перерыв" : "Пропустить" });
    skip.onclick = () => { this.timer.skip(); this.render(); };
    if (current && !current.done && !current.source) {
      const done = iconButton(ctl, ICON.done, "Готово");
      done.onclick = async () => {
        this.timer.pause();
        await this.plugin.store.toggle(current.id);
        const next = this.todayTasks().find((t) => !t.done && !t.source);
        this.timer.select(next?.id ?? null);
      };
    }
    const planned = open.reduce((s, t) => s + t.duration, 0);
    const spent = tasks.reduce((s, t) => s + t.spent, 0);
    const stats = panel.createDiv("wp-focus-stats");
    iconText(stats, ICON.pomodoro, String(this.timer.completedToday), "", "Помодоро сегодня");
    iconText(stats, ICON.spent, fmtMinutes(spent) || "0м", "", "Потрачено сегодня");
    iconText(stats, ICON.planned, `осталось ${fmtMinutes(planned) || "—"}`, "", "Запланировано на остаток дня");
    if (!Platform.isMobile) panel.createDiv({ cls: "wp-hint", text: "Пробел — старт/пауза" });

    // ----- today's list -----
    const listWrap = page.createDiv("wp-focus-list");
    listWrap.createDiv({ cls: "wp-chart-title", text: `Задачи на сегодня · ${tasks.filter((t) => t.done).length}/${tasks.length}` });
    if (!tasks.length) listWrap.createDiv({ cls: "wp-empty", text: "На сегодня задач нет" });
    for (const t of tasks) {
      const row = listWrap.createDiv({ cls: `wp-focus-item prio-${t.priority}` });
      if (t.done) row.addClass("is-done");
      if (t.id === this.timer.taskId) row.addClass("is-current");
      const cb = row.createEl("input", { attr: { type: "checkbox" }, cls: "task-list-item-checkbox" });
      cb.checked = t.done;
      cb.onclick = (e) => { e.stopPropagation(); this.plugin.store.toggle(t.id); };
      const body = row.createDiv("wp-focus-item-body");
      body.createDiv({ text: displayTitle(t) });
      const meta = [t.time, t.duration ? fmtMinutes(t.duration) : "", t.spent ? `в фокусе ${fmtMinutes(t.spent)}` : ""].filter(Boolean).join(" · ");
      if (meta) body.createDiv({ cls: "wp-muted", text: meta });
      if (!t.done && !t.source) {
        const play = row.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Фокус на этой задаче" } });
        setIcon(play, "play");
        play.onclick = (e) => { e.stopPropagation(); this.timer.start(t.id); this.render(); };
        row.onclick = () => { this.timer.select(t.id); this.render(); };
      }
    }
    this.updateClock();
  }

  private updateClock() {
    const time = this.contentEl.querySelector(".wp-ring-time");
    if (time) time.textContent = fmtClock(this.timer.left);
    const fg = this.contentEl.querySelector<SVGCircleElement>(".wp-ring-fg");
    if (fg) {
      const len = 2 * Math.PI * 54;
      fg.style.strokeDasharray = `${len}`;
      fg.style.strokeDashoffset = `${len * (1 - this.timer.left / this.timer.total)}`;
    }
    const main = this.contentEl.querySelector(".wp-focus-main");
    if (main) main.textContent = this.timer.running ? "Пауза" : "Старт";
    const phase = this.contentEl.querySelector(".wp-focus-phase");
    if (phase && phase.textContent !== (this.timer.phase === "work" ? "Работа" : "Перерыв")) this.render();
  }
}
