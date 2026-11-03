import { App, FuzzyMatch, FuzzySuggestModal, Modal, Notice, SuggestModal } from "obsidian";
import { addDays, humanDay, startOfWeek, today } from "./dates";
import { Task, displayTitle, projectOf } from "./model";
import { TaskModal } from "./modal";
import type WeekPlannerPlugin from "./main";

/** ⌘K: fuzzy-find any task, then pick an action for it. */
export class TaskPalette extends FuzzySuggestModal<Task> {
  constructor(app: App, private plugin: WeekPlannerPlugin) {
    super(app);
    this.setPlaceholder("Найти задачу…");
    this.setInstructions([
      { command: "↑↓", purpose: "выбрать" },
      { command: "↵", purpose: "действия" },
      { command: "esc", purpose: "закрыть" },
    ]);
    this.modalEl.addClass("wp-palette");
  }

  getItems(): Task[] {
    const now = today();
    return this.plugin.store.all().slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const da = a.due ?? "9999", db = b.due ?? "9999";
      // today and upcoming first, then overdue, then backlog
      const ka = da >= now ? da : "8" + da, kb = db >= now ? db : "8" + db;
      return ka.localeCompare(kb);
    });
  }

  getItemText(t: Task): string {
    return [displayTitle(t), ...t.tags.map((x) => "#" + x), projectOf(t) ?? "", t.due ?? "бэклог"].join(" ");
  }

  renderSuggestion(item: FuzzyMatch<Task>, el: HTMLElement) {
    const t = item.item;
    el.addClass("wp-palette-item");
    if (t.done) el.addClass("is-done");
    el.createDiv({ cls: `wp-palette-prio prio-${t.priority}` });
    const body = el.createDiv("wp-palette-body");
    body.createDiv({ cls: "wp-palette-title", text: displayTitle(t) });
    const meta = [t.due ? humanDay(t.due) : "бэклог", t.time ?? "", ...t.tags.map((x) => "#" + x), t.source ? `📄 ${t.source.path}` : ""].filter(Boolean);
    body.createDiv({ cls: "wp-muted", text: meta.join(" · ") });
  }

  onChooseItem(t: Task) {
    new ActionModal(this.app, this.plugin, t).open();
  }
}

interface Action {
  label: string;
  hint?: string;
  run: () => void | Promise<unknown>;
}

class ActionModal extends SuggestModal<Action> {
  constructor(app: App, private plugin: WeekPlannerPlugin, private task: Task) {
    super(app);
    this.setPlaceholder(`«${displayTitle(task)}» — что сделать?`);
  }

  getSuggestions(query: string): Action[] {
    const t = this.task;
    const s = this.plugin.store;
    const now = today();
    const list: Action[] = [
      { label: t.done ? "Вернуть в работу" : "Выполнено", hint: "x", run: () => s.toggle(t.id) },
      { label: "На сегодня", run: () => s.move(t.id, now, null) },
      { label: "На завтра", run: () => s.move(t.id, addDays(now, 1), null) },
      { label: "На следующую неделю", run: () => s.move(t.id, addDays(startOfWeek(now), 7), null) },
      { label: "В бэклог", run: () => s.move(t.id, null, null) },
      { label: "Показать в неделе", run: () => this.plugin.activateWeek(t.due ?? now) },
    ];
    if (t.source) list.push({ label: "Открыть заметку", run: () => this.plugin.openSource(t) });
    else {
      list.push({ label: "Изменить", hint: "e", run: () => new TaskModal(this.app, this.plugin, t, t.due).open() });
      if (!t.done) list.push({ label: "Фокус на задаче", hint: "f", run: () => this.plugin.activateFocus(t.id) });
      list.push({ label: "Удалить", run: async () => { await s.remove(t.id); new Notice("Задача удалена"); } });
    }
    const q = query.toLowerCase().trim();
    return q ? list.filter((a) => a.label.toLowerCase().includes(q) || a.hint === q) : list;
  }

  renderSuggestion(a: Action, el: HTMLElement) {
    el.createSpan({ text: a.label });
    if (a.hint) el.createSpan({ cls: "wp-muted wp-palette-hint", text: a.hint });
  }

  onChooseSuggestion(a: Action) {
    a.run();
  }
}

export class PromptModal extends Modal {
  constructor(app: App, private title: string, private initial: string, private onSubmit: (v: string) => void) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("wp-modal");
    this.titleEl.setText(this.title);
    const input = this.contentEl.createEl("input", { cls: "wp-modal-title", attr: { type: "text" } });
    input.value = this.initial;
    setTimeout(() => input.select(), 10);
    const submit = () => {
      if (!input.value.trim()) return;
      this.onSubmit(input.value.trim());
      this.close();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) submit(); });
    const f = this.contentEl.createDiv("wp-modal-footer");
    f.createDiv({ cls: "wp-spacer" });
    f.createEl("button", { text: "Отмена" }).onclick = () => this.close();
    f.createEl("button", { text: "Сохранить", cls: "mod-cta" }).onclick = submit;
  }

  onClose() {
    this.contentEl.empty();
  }
}
