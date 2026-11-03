// Small DOM helpers: Lucide icons (bundled with Obsidian) instead of emoji.

import { setIcon } from "obsidian";

export const ICON = {
  moved: "corner-up-right",
  streak: "flame",
  stale: "alert-triangle",
  review: "bar-chart-2",
  pomodoro: "timer",
  spent: "clock",
  planned: "list-todo",
  backlog: "inbox",
  done: "check",
  focus: "play",
  note: "file-text",
  project: "folder",
  repeat: "repeat",
  subtasks: "list-checks",
} as const;

/** <span class="wp-ico">[svg]</span> */
export function icon(parent: HTMLElement, name: string, cls = ""): HTMLElement {
  const el = parent.createSpan({ cls: `wp-ico ${cls}`.trim() });
  setIcon(el, name);
  return el;
}

/** Icon followed by text, e.g. a stat or a badge. */
export function iconText(parent: HTMLElement, name: string, text: string, cls = "", label?: string): HTMLElement {
  const el = parent.createSpan({ cls: `wp-icon-text ${cls}`.trim(), attr: label ? { "aria-label": label } : {} });
  icon(el, name);
  el.createSpan({ text });
  return el;
}

/** Button with an icon and optional text. */
export function iconButton(parent: HTMLElement, name: string, text: string, cls = "", label?: string): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `wp-icon-text-btn ${cls}`.trim(), attr: label ? { "aria-label": label } : {} });
  icon(b, name);
  if (text) b.createSpan({ text });
  return b;
}
