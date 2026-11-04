// Month grid.

import { DAY_SHORT, addDays, dayNum, startOfWeek, today, weekDays } from "../dates";
import type { WeekView } from "../weekView";
import { BACKLOG } from "./shared";
import { renderCard } from "./card";
import { renderDayList } from "./mobile";
import { renderColHead } from "./columns";

export function renderMonth(v: WeekView, root: HTMLElement) {
  const anchor = v.monthAnchor();
  const month = anchor.slice(0, 7);
  const start = startOfWeek(anchor);
  const now = today();
  const wrap = root.createDiv("wp-month-wrap");
  if (!v.mobile) {
    const back = wrap.createDiv("wp-col is-backlog wp-month-backlog");
    renderColHead(v, back, null);
    const list = back.createDiv({ cls: "wp-list wp-scroll-y", attr: { "data-drop": BACKLOG, "data-drop-list": "", "data-scroll-key": "m-backlog" } });
    for (const t of v.tasksFor(null)) renderCard(v, list, t);
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
      num.onclick = () => v.showWeekOf(d);
      const st = v.dayStats(d);
      if (st.total) top.createSpan({ cls: "wp-count", text: `${st.done}/${st.total}` });
      const tasks = v.tasksFor(d);
      if (v.mobile) {
        if (d === v.selected) cell.addClass("is-selected");
        const dots = cell.createDiv("wp-month-dots");
        for (const t of tasks.slice(0, 5)) dots.createDiv({ cls: `wp-dot prio-${t.priority} ${t.done ? "is-done" : ""}` });
        cell.onclick = () => {
          v.selected = d;
          v.render();
        };
      } else {
        for (const t of tasks) renderCard(v, cell, t, true);
        cell.createDiv("wp-list-end");
      }
    }
  }
  grid.style.gridTemplateRows = v.mobile ? "" : `auto repeat(${weeks}, 1fr)`;
  if (v.mobile) {
    // Below the grid: the tapped day (defaults to today).
    if (v.selected === BACKLOG || v.selected.slice(0, 7) !== month) v.selected = now.slice(0, 7) === month ? now : anchor;
    renderDayList(v, root, v.selected);
  }
}
