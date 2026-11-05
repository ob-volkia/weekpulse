// Apple Pencil hover (iPad with hover support): hold the pencil over a card without touching
// the screen to peek at its details. Mouse and finger never trigger it.

import { fmtMinutes, humanDay } from "../dates";
import { PRIORITY_LABEL, displayTitle } from "../model";
import type { WeekView } from "../weekView";

const DELAY = 280;

export function setupPenHover(v: WeekView) {
  let timer: number | null = null;
  let card: HTMLElement | null = null;
  let peek: HTMLElement | null = null;

  const hide = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
    card = null;
    peek?.remove();
    peek = null;
  };

  const show = async (el: HTMLElement) => {
    const t = v.store.find(el.dataset.id!);
    if (!t) return;
    peek?.remove();
    const p = document.body.createDiv("wp-pen-peek");
    peek = p;
    p.createDiv({ cls: "wp-peek-title", text: displayTitle(t) });
    const meta: string[] = [];
    if (t.time) meta.push(t.duration ? `${t.time} · ${fmtMinutes(t.duration)}` : t.time);
    else if (t.duration) meta.push(fmtMinutes(t.duration));
    if (t.deadline) meta.push(`дедлайн ${humanDay(t.deadline)}`);
    if (t.priority) meta.push(PRIORITY_LABEL[t.priority]);
    if (t.tags.length) meta.push(t.tags.map((x) => "#" + x).join(" "));
    const goal = t.goal ? v.store.findGoal(t.goal) : null;
    if (goal) meta.push(`цель: ${goal.title}`);
    if (meta.length) p.createDiv({ cls: "wp-peek-meta", text: meta.join(" · ") });
    if (t.subtasks.length) {
      const ul = p.createEl("ul", { cls: "wp-peek-subs" });
      for (const s of t.subtasks.slice(0, 6)) ul.createEl("li", { cls: s.done ? "is-done" : "", text: s.text });
      if (t.subtasks.length > 6) ul.createEl("li", { cls: "wp-peek-more", text: `и ещё ${t.subtasks.length - 6}` });
    }
    place(p, el);
    if (t.source) return;
    const body = await v.store.readBody(t);
    if (peek !== p) return; // moved on meanwhile
    const desc = body.description.trim();
    if (desc) p.createDiv({ cls: "wp-peek-desc", text: desc.length > 220 ? desc.slice(0, 220).trimEnd() + "…" : desc });
    const extras: string[] = [];
    if (body.links.length) extras.push(`ссылок: ${body.links.length}`);
    if (body.files.length) extras.push(`файлов: ${body.files.length}`);
    if (body.comments.length) extras.push(`комментариев: ${body.comments.length}`);
    if (extras.length) p.createDiv({ cls: "wp-peek-meta", text: extras.join(" · ") });
    place(p, el);
  };

  v.registerDomEvent(v.contentEl, "pointermove", (e: PointerEvent) => {
    if (e.pointerType !== "pen" || e.buttons !== 0 || document.body.hasClass("wp-is-dragging")) {
      if (e.pointerType === "pen" && e.buttons !== 0) hide();
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>(".wp-card[data-id]");
    if (el === card) return;
    hide();
    if (!el) return;
    card = el;
    timer = window.setTimeout(() => card === el && show(el), DELAY);
  });
  v.registerDomEvent(v.contentEl, "pointerleave", hide);
  v.registerDomEvent(v.contentEl, "pointerdown", hide);
  v.registerDomEvent(v.contentEl, "scroll", hide, { capture: true });
  return hide;
}

/** Beside the card: to the right if it fits, else to the left, else below. */
function place(p: HTMLElement, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const w = p.offsetWidth;
  const h = p.offsetHeight;
  const gap = 10;
  let x = r.right + gap;
  let y = r.top;
  if (x + w > innerWidth - 8) x = r.left - w - gap;
  if (x < 8) {
    x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    y = r.bottom + gap;
  }
  y = Math.max(8, Math.min(y, innerHeight - h - 8));
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
}
