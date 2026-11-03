import { App, Modal, setIcon } from "obsidian";
import { DateStr, weekLabel } from "./dates";
import type WeekPlannerPlugin from "./main";

/** Add, rename, check off and remove the week's goals. */
export class GoalsModal extends Modal {
  private unsub: (() => void) | null = null;

  constructor(app: App, private plugin: WeekPlannerPlugin, private weekStart: DateStr) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("wp-modal", "wp-goals-modal");
    this.titleEl.setText(`Цели недели · ${weekLabel(this.weekStart)}`);
    const ref = this.plugin.store.on("changed", () => this.render());
    this.unsub = () => this.plugin.store.offref(ref);
    this.render();
  }

  onClose() {
    this.unsub?.();
    this.contentEl.empty();
  }

  private render() {
    const store = this.plugin.store;
    const c = this.contentEl;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.goal;
    c.empty();
    const goals = store.goalsFor(this.weekStart);
    const tasks = store.tasks();
    if (!goals.length) c.createDiv({ cls: "wp-muted", text: "1–3 главные цели на неделю. Задачи привязываются к цели в окне задачи." });
    for (const g of goals) {
      const row = c.createDiv("wp-goal-row");
      const cb = row.createEl("input", { attr: { type: "checkbox", "aria-label": "Цель достигнута" }, cls: "task-list-item-checkbox" });
      cb.checked = g.done;
      cb.onchange = () => store.updateGoal(g.id, { done: cb.checked });
      const inp = row.createEl("input", { attr: { type: "text", "data-goal": g.id } });
      inp.value = g.title;
      inp.addEventListener("change", () => inp.value.trim() && store.updateGoal(g.id, { title: inp.value.trim() }));
      const linked = tasks.filter((t) => t.goal === g.id);
      if (linked.length) row.createSpan({ cls: "wp-muted", text: `${linked.filter((t) => t.done).length}/${linked.length}` });
      const del = row.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Удалить цель" } });
      setIcon(del, "trash-2");
      del.onclick = () => store.removeGoal(g.id);
    }
    if (goals.length < 5) {
      const add = c.createEl("input", { cls: "wp-goal-new", attr: { type: "text", placeholder: "Новая цель, Enter" } });
      add.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter" || e.isComposing || !add.value.trim()) return;
        e.preventDefault();
        await store.addGoal(this.weekStart, add.value.trim());
        (this.contentEl.querySelector(".wp-goal-new") as HTMLInputElement | null)?.focus();
      });
      if (!focused) setTimeout(() => add.focus(), 10);
    }
  }
}
