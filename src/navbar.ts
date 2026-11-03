// A "+ task" button in Obsidian's phone bottom bar.
// There is no API for this bar, so we copy the look of the built-in "+" (new tab) button
// and insert our own next to it. If Obsidian changes the bar's markup, we simply find nothing
// and add nothing.

import { setIcon } from "obsidian";

const MARK = "wp-navbar-add";

export function injectNavbarButton(onTap: () => void): boolean {
  const actions = document.querySelector<HTMLElement>(".mobile-navbar-actions");
  if (!actions) return false;
  if (actions.querySelector(`.${MARK}`)) return true;
  const template =
    actions.querySelector<HTMLElement>(".mobile-navbar-action-new-tab") ??
    actions.querySelector<HTMLElement>(".mobile-navbar-action-tabs") ??
    actions.querySelector<HTMLElement>(".mobile-navbar-action");
  if (!template) return false;

  // Deep clone keeps Obsidian's styling; drop the specific class so CSS that hides
  // the built-in "+" (planner-navbar snippet) doesn't hide ours too.
  const btn = template.cloneNode(true) as HTMLElement;
  btn.className = btn.className.replace(/mobile-navbar-action-[\w-]+/g, "").trim();
  btn.addClass(MARK);
  btn.removeAttribute("id");
  btn.setAttribute("aria-label", "Новая задача");
  const iconHost = btn.querySelector<HTMLElement>(".clickable-icon") ?? btn;
  iconHost.empty();
  setIcon(iconHost, "plus");
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onTap();
  }, true);
  actions.insertBefore(btn, template.hasClass("mobile-navbar-action-new-tab") ? template : actions.firstChild);
  return true;
}

export function removeNavbarButton() {
  document.querySelectorAll(`.${MARK}`).forEach((el) => el.remove());
}
