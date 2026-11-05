// Keyboard cursor on the desktop week and timeline.

import { addDays, diffDays, today, weekday } from "../dates";
import type { WeekView } from "../weekView";
import { openTask } from "./card";
import { arrow } from "./toolbar";
/** Columns of task cards in screen order, for arrow-key movement. */

export function cursorColumns(v: WeekView): HTMLElement[][] {
  const lists = v.mode === "timeline"
    ? [...v.contentEl.querySelectorAll<HTMLElement>(".wp-tl-headcol")].map((col, i) => [col.querySelector(".wp-tl-untimed"), v.contentEl.querySelectorAll(".wp-tl-day")[i]])
    : [...v.contentEl.querySelectorAll<HTMLElement>(".wp-grid .wp-list")].map((l) => [l]);
  return lists.map((parts) => parts.flatMap((p) => (p ? [...p.querySelectorAll<HTMLElement>(".wp-card[data-id]")] : [])));
}

export function applyCursor(v: WeekView) {
  v.contentEl.querySelectorAll(".wp-card.is-cursor").forEach((c) => c.removeClass("is-cursor"));
  if (!v.cursor) return;
  const card = v.contentEl.querySelector<HTMLElement>(`.wp-card[data-id="${CSS.escape(v.cursor)}"]`);
  if (!card) return;
  card.addClass("is-cursor");
  card.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** ↑↓ / j k, ← →, x or space, Enter / e, 1–7, 0, Delete. Returns true when handled. */
export function cursorKey(v: WeekView, e: KeyboardEvent): boolean {
  if (v.mobile || v.mode === "month") return false;
  const k = e.key;
  const cols = cursorColumns(v);
  const pos = () => {
    for (let c = 0; c < cols.length; c++) {
      const r = cols[c].findIndex((el) => el.dataset.id === v.cursor);
      if (r >= 0) return { c, r };
    }
    return null;
  };
  const set = (el: HTMLElement | undefined) => {
    if (!el) return;
    v.cursor = el.dataset.id!;
    applyCursor(v);
  };
  const move = (dc: number, dr: number) => {
    const p = pos();
    if (!p) {
      // Start on today's column if it has tasks, else the first task anywhere.
      const todayIdx = v.mode === "timeline" ? weekday(today()) - 1 : v.mode === "days3" ? diffDays(today(), v.dayStart) + 1 : weekday(today());
      set(cols[todayIdx]?.[0] ?? cols.find((c) => c.length)?.[0]);
      return;
    }
    if (dr) return set(cols[p.c][Math.max(0, Math.min(cols[p.c].length - 1, p.r + dr))]);
    for (let c = p.c + dc; c >= 0 && c < cols.length; c += dc)
      if (cols[c].length) return set(cols[c][Math.min(p.r, cols[c].length - 1)]);
  };
  const id = v.cursor && v.store.find(v.cursor) ? v.cursor : null;
  if (k === "ArrowDown" || k === "j" || k === "о") move(0, 1);
  else if (k === "ArrowUp" || k === "k" || k === "л") move(0, -1);
  else if (k === "ArrowRight") move(1, 0);
  else if (k === "ArrowLeft") move(-1, 0);
  else if (!id) return false;
  else if (k === "x" || k === "ч" || k === " ") v.store.toggle(id);
  else if (k === "Enter" || k === "e" || k === "у") { const t = v.store.find(id); if (t) openTask(v, t); }
  else if (/^[1-7]$/.test(k)) v.store.move(id, addDays(v.weekStart, parseInt(k) - 1), null);
  else if (k === "0") v.store.move(id, null, null);
  else if (k === "Delete" || k === "Backspace") v.store.remove(id);
  else if (k === "Escape") { v.cursor = null; applyCursor(v); }
  else return false;
  e.preventDefault();
  return true;
}
