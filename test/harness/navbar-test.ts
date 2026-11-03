import "obsidian";
import { injectNavbarButton } from "../../src/navbar";
// Mock of Obsidian's phone bar markup, per the class names documented on the forum.
document.body.className = "is-phone";
document.body.innerHTML = `<div class="mobile-navbar"><div class="mobile-navbar-actions">
${["back", "forward", "quick-switcher", "new-tab", "tabs", "menu"].map((n) => `<div class="mobile-navbar-action mobile-navbar-action-${n}"><div class="clickable-icon" aria-label="${n}">${n}</div></div>`).join("")}
</div></div>`;
let taps = 0;
const ok1 = injectNavbarButton(() => taps++);
const ok2 = injectNavbarButton(() => taps++); // idempotent
const order = [...document.querySelectorAll(".mobile-navbar-action")].map((e) => e.className);
(document.querySelector(".wp-navbar-add") as HTMLElement).click();
(window as any).result = { ok1, ok2, count: document.querySelectorAll(".wp-navbar-add").length, order, taps };
