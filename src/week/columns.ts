// Desktop week columns, quick add, calendar events and the multi-select bar.

import { Notice, setIcon } from "obsidian";
import { DAY_SHORT, DateStr, addDays, dayNum, fmtMinutes, humanDay, relativeLabel, startOfWeek, today, weekDays, weekday } from "../dates";
import { parseQuick } from "../quickadd";
import { icon } from "../ui";
import type { WeekView } from "../weekView";
import { BACKLOG, cap } from "./shared";
import { renderCard } from "./card";
import { dayMenu } from "./toolbar";

export function renderQuickAdd(v: WeekView, parent: HTMLElement, day: DateStr | null, key: string, placeholder = "Быстро добавить: завтра 14:00 1ч #работа !! Созвон") {
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
    v.focusKey = key;
    input.value = "";
    await v.store.add(q.task, due);
    if (due !== day) new Notice(`Добавлено: ${due ? humanDay(due) : "бэклог"}`);
  });
  return input;
}

export function renderDesktop(v: WeekView, root: HTMLElement) {
  const grid = root.createDiv({ cls: "wp-grid wp-scroll-x", attr: { "data-scroll-key": "grid" } });
  renderColumn(v, grid, null);
  for (const d of weekDays(v.weekStart)) renderColumn(v, grid, d);
}

export function colClasses(v: WeekView, col: HTMLElement, day: DateStr | null) {
  const now = today();
  if (day === null) return col.addClass("is-backlog");
  if (day === now) col.addClass("is-today");
  if (day < now) col.addClass("is-past");
  if (weekday(day) >= 6) col.addClass("is-weekend");
}

export function renderColHead(v: WeekView, col: HTMLElement, day: DateStr | null) {
  const head = col.createDiv("wp-col-head");
  const stats = v.dayStats(day);
  const line1 = head.createDiv("wp-col-title");
  if (day) {
    const link = line1.createSpan({ cls: "wp-day-link", attr: { "aria-label": "Заметка дня" } });
    link.createSpan({ cls: "wp-dow", text: DAY_SHORT[weekday(day) - 1] });
    link.createSpan({ cls: "wp-daynum", text: String(dayNum(day)) });
    link.onclick = () => v.plugin.openDaily(day);
    const rel = relativeLabel(day);
    if (rel) line1.createSpan({ cls: "wp-rel", text: rel });
  } else {
    line1.createSpan({ cls: "wp-dow", text: "Бэклог" });
    if (stats.total - stats.done > 0) {
      const tr = line1.createSpan({ cls: "wp-col-menu wp-triage-link clickable-icon", attr: { "aria-label": "Разобрать бэклог по одной задаче" } });
      setIcon(tr, "list-checks");
      tr.onclick = () => v.plugin.openTriage();
    }
  }
  line1.createSpan({ cls: "wp-count", text: stats.total ? `${stats.done}/${stats.total}` : "" });
  if (day) {
    const more = line1.createSpan({ cls: "wp-col-menu clickable-icon", attr: { "aria-label": "Действия с днём" } });
    setIcon(more, "more-horizontal");
    more.onclick = (e) => dayMenu(v, e, day);
    head.addEventListener("contextmenu", (e) => { e.preventDefault(); dayMenu(v, e, day); });
    const load = head.createDiv("wp-load");
    const cap = v.settings.dayCapacityHours * 60;
    const ratio = cap ? stats.minutes / cap : 0;
    if (ratio > 1) col.addClass("is-overloaded");
    const bar = load.createDiv("wp-bar");
    bar.createDiv({ cls: `wp-bar-fill ${ratio > 1 ? "is-over" : ratio > 0.8 ? "is-high" : ""}`, attr: { style: `width:${Math.min(100, ratio * 100)}%` } });
    load.createSpan({
      cls: "wp-muted", text: stats.minutes ? fmtMinutes(stats.minutes) + (ratio > 1 ? ` · +${fmtMinutes(stats.minutes - cap)}` : "") : "",
      attr: ratio > 1 ? { "aria-label": `Перегруз: план больше ${v.settings.dayCapacityHours}ч` } : {},
    });
  }
}

export function renderColumn(v: WeekView, grid: HTMLElement, day: DateStr | null) {
  const col = grid.createDiv("wp-col");
  colClasses(v, col, day);
  renderColHead(v, col, day);
  const list = col.createDiv({ cls: "wp-list wp-scroll-y", attr: { "data-drop": day ?? BACKLOG, "data-drop-list": "", "data-scroll-key": day ?? BACKLOG } });
  if (day) renderEvents(v, list, day);
  for (const t of v.tasksFor(day)) renderCard(v, list, t);
  list.createDiv("wp-list-end");
  const foot = col.createDiv("wp-col-foot");
  renderQuickAdd(v, foot, day, `col-${day ?? BACKLOG}`, "Добавить…");
}

export function renderEvents(v: WeekView, parent: HTMLElement, day: DateStr) {
  for (const ev of v.events(day)) {
    const row = parent.createDiv({ cls: `wp-event cal-${ev.calendar % 4}`, attr: { "aria-label": "Событие календаря" } });
    if (ev.start) row.createSpan({ cls: "wp-event-time", text: ev.start });
    else icon(row, "calendar");
    row.createSpan({ cls: "wp-event-title", text: ev.title });
    if (ev.minutes) row.createSpan({ cls: "wp-muted", text: fmtMinutes(ev.minutes) });
  }
}

export function renderSelectionBar(v: WeekView, root: HTMLElement) {
  const bar = root.createDiv("wp-selbar");
  const ids = [...v.selection];
  bar.createSpan({ cls: "wp-selbar-count", text: ids.length ? `Выбрано: ${ids.length}` : "Нажимай на задачи" });
  const act = (ic: string, label: string, fn: () => unknown) => {
    const b = bar.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": label } });
    setIcon(b, ic);
    b.disabled = !ids.length;
    b.onclick = async () => {
      await fn();
      v.selection.clear();
      v.selectMode = false;
      v.render();
    };
  };
  const now = today();
  act("check", "Выполнено", () => v.store.bulk(ids, "done"));
  act("sun", "На сегодня", () => v.store.bulk(ids, { due: now }));
  act("sunrise", "На завтра", () => v.store.bulk(ids, { due: addDays(now, 1) }));
  act("calendar-plus", "На следующую неделю", () => v.store.bulk(ids, { due: addDays(startOfWeek(now), 7) }));
  act("inbox", "В бэклог", () => v.store.bulk(ids, { due: null }));
  act("trash-2", "Удалить", () => v.store.bulk(ids, "remove"));
  const close = bar.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Отмена" } });
  setIcon(close, "x");
  close.onclick = () => {
    v.selection.clear();
    v.selectMode = false;
    v.render();
  };
}
