// Phone layout: two-row toolbar, day strip and the selected day.

import { Notice, setIcon } from "obsidian";
import {
  DAY_LONG, DAY_SHORT, DateStr, MONTH_NOM, dayNum, fmtMinutes, humanDay, parse, relativeLabel, today, weekDays, weekLabel, weekday,
} from "../dates";
import { TaskModal } from "../modal";
import { ICON, icon } from "../ui";
import type { WeekView } from "../weekView";
import { BACKLOG, Mode, cap } from "./shared";
import { renderCard } from "./card";
import { moreMenu, goalsMenu, dayMenu, filterButton, arrow, iconBtn } from "./toolbar";
import { renderEvents } from "./columns";
import { profileButton } from "../profiles";

export function renderMobileToolbar(v: WeekView, root: HTMLElement, mode: Mode) {
  const bar = root.createDiv("wp-toolbar wp-m-toolbar");
  const row1 = bar.createDiv("wp-m-row");
  arrow(v, row1, -1, "Назад", mode !== "month");
  row1.createEl("button", { text: "Сегодня", cls: "wp-today-btn" }).onclick = () => v.goToday();
  arrow(v, row1, 1, "Вперёд", mode !== "month");
  profileButton(v.plugin, row1, true);
  const title = row1.createDiv("wp-week-title");
  if (mode === "month") {
    const a = parse(v.monthAnchor());
    title.setText(`${MONTH_NOM[a.getMonth()]} ${a.getFullYear()}`);
  } else {
    // The year only when it isn't the current one: the row also holds the profile chip.
    const label = weekLabel(v.weekStart);
    title.createSpan({ text: label.endsWith(today().slice(0, 4)) ? label.slice(0, -5) : label });
  }
  const row2 = bar.createDiv("wp-m-row");
  const seg = row2.createDiv("wp-segmented wp-mode");
  for (const [m, label] of [["week", "Неделя"], ["month", "Месяц"], ["timeline", "Шкала"]] as [Mode, string][]) {
    const b = seg.createEl("button", { text: label, cls: "wp-seg-btn" });
    if (mode === m) b.addClass("is-active");
    b.onclick = () => v.setMode(m);
  }
  filterButton(v, row2, true);
  const icons = row2.createDiv("wp-toolbar-right");
  if (mode !== "month") {
    const g = icons.createEl("button", { cls: `wp-icon-btn clickable-icon ${v.filter.goal ? "is-running" : ""}`, attr: { "aria-label": "Цели недели" } });
    setIcon(g, "target");
    g.onclick = (e) => goalsMenu(v, e);
  }
  iconBtn(v, icons, "search", "Найти задачу", () => v.plugin.openPalette());
  iconBtn(v, icons, "wand-2", "Спланировать неделю", () => v.plugin.openPlanning(v.weekStart));
  iconBtn(v, icons, "timer", "Фокус", () => v.plugin.activateFocus(), v.plugin.focus.running ? "is-running" : "");
  iconBtn(v, icons, "flame", "Привычки и статистика", () => v.plugin.activateHabits());
  iconBtn(v, icons, "more-horizontal", "Ещё", (e) => moreMenu(v, e));
}

export function renderMobile(v: WeekView, root: HTMLElement) {
  renderStrip(v, root, true);
  renderDayList(v, root, v.selected === BACKLOG ? null : v.selected);
}

export function renderStrip(v: WeekView, root: HTMLElement, withBacklog: boolean) {
  const strip = root.createDiv("wp-strip");
  if (!withBacklog) strip.addClass("is-7");
  const now = today();
  const mk = (key: string, label: string, date: DateStr | null) => {
    const pill = strip.createDiv({ cls: "wp-pill", attr: { "data-drop": key } });
    if ((date ?? BACKLOG) === v.selected) pill.addClass("is-selected");
    if (date === now) pill.addClass("is-today");
    if (date && date < now) pill.addClass("is-past");
    pill.createDiv({ cls: "wp-pill-label", text: label });
    const num = pill.createDiv("wp-pill-num");
    if (date) num.setText(String(dayNum(date)));
    else icon(num, ICON.backlog);
    const st = v.dayStats(date);
    const open = st.total - st.done;
    const dot = pill.createDiv("wp-pill-count");
    if (st.total && !open) {
      icon(dot, ICON.done);
      dot.addClass("is-clear");
    } else if (open) dot.setText(String(open));
    pill.onclick = () => {
      v.selected = date ?? BACKLOG;
      v.render();
    };
  };
  for (const d of weekDays(v.weekStart)) mk(d, DAY_SHORT[weekday(d) - 1], d);
  if (withBacklog) mk(BACKLOG, "Бэкл", null);
}

/** Mobile: the selected day's header, quick add and task list. */
export function renderDayList(v: WeekView, root: HTMLElement, day: DateStr | null) {
  const now = today();
  const head = root.createDiv("wp-m-head");
  const st = v.dayStats(day);
  if (day) {
    const rel = relativeLabel(day);
    const t = head.createDiv({ cls: "wp-m-title", text: rel ? `${rel}, ${humanDay(day)}` : `${cap(DAY_LONG[weekday(day) - 1])}, ${humanDay(day)}` });
    t.onclick = () => v.plugin.openDaily(day);
  } else {
    head.createDiv({ cls: "wp-m-title", text: "Бэклог" });
  }
  const right = head.createDiv("wp-m-head-right");
  right.createSpan({ cls: "wp-muted", text: [st.total ? `${st.done}/${st.total}` : "", st.minutes ? fmtMinutes(st.minutes) : ""].filter(Boolean).join(" · ") });
  if (day) iconBtn(v, right, "more-horizontal", "Действия с днём", (e) => dayMenu(v, e, day));
  else if (st.total - st.done > 0) {
    const tr = right.createEl("button", { cls: "wp-chip-btn", text: "Разобрать" });
    tr.onclick = () => v.plugin.openTriage();
  }

  const list = root.createDiv({ cls: "wp-list wp-m-list wp-scroll-y", attr: { "data-drop": day ?? BACKLOG, "data-drop-list": "", "data-scroll-key": `mobile-${v.mode}` } });
  if (day) renderEvents(v, list, day);
  const tasks = v.tasksFor(day);
  for (const t of tasks) renderCard(v, list, t);
  if (!tasks.length) list.createDiv({ cls: "wp-empty", text: day === now ? "На сегодня всё чисто" : "Нет задач" });
  list.createDiv("wp-list-end");
  // The "+" lives in Obsidian's bottom bar now; the floating one is only a fallback
  // for when that button is turned off or Obsidian's bar changed and it couldn't be added.
  if (!(v.settings.navbarButton && document.querySelector(".wp-navbar-add"))) renderFab(v, root, day);
  maybeShowHint(v);
}

/** Floating "+" above Obsidian's bottom bar (phone). */
export function renderFab(v: WeekView, root: HTMLElement, day: DateStr | null) {
  const fab = root.createEl("button", { cls: "wp-fab", attr: { "aria-label": "Новая задача" } });
  setIcon(fab, "plus");
  fab.onclick = () => new TaskModal(v.app, v.plugin, null, day).open();
}

export function maybeShowHint(v: WeekView) {
  if (v.settings.mobileHintShown) return;
  v.settings.mobileHintShown = true;
  v.plugin.saveSettings();
  new Notice("Удерживай задачу и перетащи на день в верхней полосе.\nСвайп вправо — на завтра, влево — выполнено.", 12_000);
}
