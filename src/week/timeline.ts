// Hour grid: week timeline on desktop, one-day timeline on the phone.

import { DAY_LONG, DateStr, addDays, humanDay, relativeLabel, today, weekDays, weekday } from "../dates";
import type { WeekView } from "../weekView";
import { BACKLOG, HOUR_PX, MIN_BLOCK_PX, cap, toMin, toHHMM } from "./shared";
import { renderCard } from "./card";
import { renderStrip } from "./mobile";
import { colClasses, renderColHead } from "./columns";

export function showTimeIndicator(v: WeekView, el: HTMLElement | null, top: number) {
  v.timeIndicator?.remove();
  v.timeIndicator = null;
  if (!el?.hasAttribute("data-drop-time")) return;
  const rect = el.getBoundingClientRect();
  const steps = Math.round(((top - rect.top) / HOUR_PX) * 4);
  const min = Math.max(v.settings.timelineStart * 60, Math.min(v.settings.timelineEnd * 60 - 15, v.settings.timelineStart * 60 + steps * 15));
  const ind = el.createDiv({ cls: "wp-time-indicator", text: toHHMM(min) });
  ind.style.top = `${((min - v.settings.timelineStart * 60) / 60) * HOUR_PX}px`;
  v.timeIndicator = ind;
}

export function renderTimeline(v: WeekView, root: HTMLElement) {
  const s = v.settings;
  const days = weekDays(v.weekStart);
  const wrap = root.createDiv("wp-tl");
  const head = wrap.createDiv("wp-tl-row wp-tl-head");
  head.createDiv("wp-tl-gutter");
  for (const d of days) {
    const col = head.createDiv("wp-col wp-tl-headcol");
    colClasses(v, col, d);
    renderColHead(v, col, d);
    const untimed = col.createDiv({ cls: "wp-list wp-tl-untimed wp-scroll-y", attr: { "data-drop": d, "data-drop-list": "", "data-untimed": "", "data-scroll-key": `u-${d}` } });
    for (const t of v.tasksFor(d).filter((t) => !t.time)) renderCard(v, untimed, t);
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
  for (const d of days) renderTimelineDay(v, body, d, nowMin);
  // Start scrolled to the morning on first open.
  if (!scroller.dataset.inited) requestAnimationFrame(() => {
    if (scroller.scrollTop === 0) scroller.scrollTop = Math.max(0, (Math.max(8, now.getHours() - 1) - s.timelineStart) * HOUR_PX);
  });
}

export function renderTimelineDay(v: WeekView, body: HTMLElement, d: DateStr, nowMin: number) {
  const s = v.settings;
  const hours = s.timelineEnd - s.timelineStart;
  const col = body.createDiv({ cls: "wp-tl-day", attr: { "data-drop": d, "data-drop-time": "" } });
  colClasses(v, col, d);
  col.style.height = `${hours * HOUR_PX}px`;
  for (let h = 0; h < hours; h++) col.createDiv("wp-tl-line").style.top = `${h * HOUR_PX}px`;
  if (d === today() && nowMin >= s.timelineStart * 60 && nowMin < s.timelineEnd * 60)
    col.createDiv("wp-tl-now").style.top = `${((nowMin - s.timelineStart * 60) / 60) * HOUR_PX}px`;
  for (const ev of v.events(d)) {
    if (!ev.start) continue;
    const startMin = toMin(ev.start);
    const block = col.createDiv({ cls: `wp-event wp-tl-event cal-${ev.calendar % 4}`, attr: { "aria-label": `${ev.start} ${ev.title}` } });
    block.style.top = `${((startMin - s.timelineStart * 60) / 60) * HOUR_PX}px`;
    block.style.height = `${(Math.max(ev.minutes, 20) / 60) * HOUR_PX - 2}px`;
    block.createSpan({ cls: "wp-event-time", text: ev.start });
    block.createSpan({ text: " " + ev.title });
  }
  // Lay overlapping blocks side by side.
  const items = v.tasksFor(d).filter((t) => t.time)
    .map((t) => ({ t, start: toMin(t.time!), end: toMin(t.time!) + Math.max(t.duration || 30, Math.ceil((MIN_BLOCK_PX / HOUR_PX) * 60)), lane: 0, lanes: 1 }));
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
    const card = renderCard(v, col, it.t);
    card.addClass("wp-tl-block");
    card.style.top = `${((it.start - s.timelineStart * 60) / 60) * HOUR_PX}px`;
    card.style.height = `${((it.end - it.start) / 60) * HOUR_PX - 2}px`;
    card.style.left = `calc(${(it.lane / it.lanes) * 100}% + 2px)`;
    card.style.width = `calc(${100 / it.lanes}% - 4px)`;
  }
}

/** Phone: day strip, then the selected day's untimed tasks and an hour grid. */
export function renderMobileTimeline(v: WeekView, root: HTMLElement) {
  const s = v.settings;
  if (v.selected === BACKLOG) v.selected = today() >= v.weekStart && today() <= addDays(v.weekStart, 6) ? today() : v.weekStart;
  const day = v.selected;
  renderStrip(v, root, false);
  const head = root.createDiv("wp-m-head");
  const rel = relativeLabel(day);
  head.createDiv({ cls: "wp-m-title", text: rel ? `${rel}, ${humanDay(day)}` : `${cap(DAY_LONG[weekday(day) - 1])}, ${humanDay(day)}` });
  const untimed = root.createDiv({ cls: "wp-list wp-m-untimed", attr: { "data-drop": day, "data-drop-list": "", "data-untimed": "" } });
  const loose = v.tasksFor(day).filter((t) => !t.time);
  for (const t of loose) renderCard(v, untimed, t, true);
  if (!loose.length) untimed.createDiv({ cls: "wp-muted wp-m-untimed-empty", text: "Задачи без времени — сюда. Удерживай задачу и тяни на нужный час." });
  untimed.createDiv("wp-list-end");
  const scroller = root.createDiv({ cls: "wp-tl-scroll wp-scroll-y wp-m-tl", attr: { "data-scroll-key": "m-timeline" } });
  const body = scroller.createDiv("wp-tl-row wp-tl-body wp-m-tl-body");
  const hours = s.timelineEnd - s.timelineStart;
  const gutter = body.createDiv("wp-tl-gutter");
  gutter.style.height = `${hours * HOUR_PX}px`;
  for (let h = 0; h < hours; h++) gutter.createDiv({ cls: "wp-tl-hour", text: `${String(s.timelineStart + h).padStart(2, "0")}:00` }).style.top = `${h * HOUR_PX}px`;
  const now = new Date();
  renderTimelineDay(v, body, day, now.getHours() * 60 + now.getMinutes());
  requestAnimationFrame(() => {
    if (scroller.scrollTop === 0) scroller.scrollTop = Math.max(0, (Math.max(8, now.getHours() - 1) - s.timelineStart) * HOUR_PX);
  });
}
