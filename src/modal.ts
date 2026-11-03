import { App, Modal, Notice } from "obsidian";
import { DAY_SHORT, DateStr, weekday } from "./dates";
import { PRIORITY_LABEL, Priority, Task, emptyTask, formatDuration, parseDuration, recurrenceLabel, weekOnRule } from "./model";
import { parseQuick } from "./quickadd";
import { Store } from "./store";
import type WeekPlannerPlugin from "./main";
import { STALE_AT } from "./weekView";

const PRIORITIES: Priority[] = [3, 2, 1, 0, -1];

export class TaskModal extends Modal {
  private draft: Task;
  private isNew: boolean;
  private store: Store;

  constructor(app: App, private plugin: WeekPlannerPlugin, task: Task | null, defaultDue: DateStr | null) {
    super(app);
    this.store = plugin.store;
    this.isNew = !task;
    this.draft = task ? structuredClone(task) : emptyTask({ due: defaultDue });
  }

  onOpen() {
    this.modalEl.addClass("wp-modal");
    this.titleEl.setText(this.isNew ? "Новая задача" : "Задача");
    this.render();
  }

  private render() {
    const t = this.draft;
    const c = this.contentEl;
    c.empty();

    if (!this.isNew && !t.done && t.moved >= STALE_AT) this.renderStaleBanner(c);

    const title = c.createEl("input", { cls: "wp-modal-title", attr: { type: "text", placeholder: this.isNew ? "Что сделать? (можно: завтра 14:00 1ч #тег !!)" : "Название" } });
    title.value = t.title;
    title.addEventListener("input", () => (t.title = title.value));
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        this.save();
      }
    });
    setTimeout(() => title.focus(), 10);

    const grid = c.createDiv("wp-modal-grid");
    const field = (label: string) => {
      const row = grid.createDiv("wp-field");
      row.createDiv({ cls: "wp-field-label", text: label });
      return row.createDiv("wp-field-control");
    };

    // date
    const dateCtl = field("Дата");
    const date = dateCtl.createEl("input", { attr: { type: "date" } });
    date.value = t.due ?? "";
    date.addEventListener("change", () => (t.due = date.value || null));
    const backlogBtn = dateCtl.createEl("button", { text: "В бэклог", cls: "wp-chip-btn" });
    backlogBtn.onclick = () => {
      t.due = null;
      date.value = "";
    };

    // time + duration
    const timeCtl = field("Время");
    const time = timeCtl.createEl("input", { attr: { type: "time" } });
    time.value = t.time ?? "";
    time.addEventListener("change", () => (t.time = time.value || null));
    const dur = timeCtl.createEl("input", { cls: "wp-dur", attr: { type: "text", placeholder: "1ч 30м" } });
    dur.value = t.duration ? formatDuration(t.duration) : "";
    dur.addEventListener("change", () => (t.duration = parseDuration(dur.value)));
    for (const m of [15, 30, 60, 120]) {
      const b = timeCtl.createEl("button", { text: m < 60 ? `${m}м` : `${m / 60}ч`, cls: "wp-chip-btn" });
      b.onclick = () => {
        t.duration = m;
        dur.value = formatDuration(m);
      };
    }

    // priority
    const prCtl = field("Приоритет").createDiv("wp-segmented");
    for (const p of PRIORITIES) {
      const b = prCtl.createEl("button", { text: PRIORITY_LABEL[p], cls: `wp-prio-btn prio-${p}` });
      if (t.priority === p) b.addClass("is-active");
      b.onclick = () => {
        t.priority = p;
        this.render();
      };
    }

    // tags
    const tagCtl = field("Теги");
    const tags = tagCtl.createEl("input", { attr: { type: "text", placeholder: "работа, дом" } });
    tags.value = t.tags.join(", ");
    tags.addEventListener("change", () => {
      t.tags = tags.value.split(/[,\s]+/).map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
    });
    const known = this.store.allTags().filter((x) => !t.tags.includes(x)).slice(0, 8);
    for (const k of known) {
      const b = tagCtl.createEl("button", { text: "#" + k, cls: "wp-chip-btn" });
      b.onclick = () => {
        t.tags.push(k);
        this.render();
      };
    }

    // recurrence
    const recCtl = field("Повтор");
    const sel = recCtl.createEl("select", { cls: "dropdown" });
    const wd = t.due ? weekday(t.due) : 1;
    const options: [string, string][] = [
      ["", "Не повторять"],
      ["every day", "Каждый день"],
      ["every weekday", "По будням"],
      [weekOnRule([wd]), `Каждую неделю (${DAY_SHORT[wd - 1]})`],
      ["every 2 weeks", "Раз в 2 недели"],
      ["every month", "Каждый месяц"],
      ["custom", "Дни недели…"],
    ];
    if (t.recurrence && !options.some(([v]) => v === t.recurrence)) options.splice(1, 0, [t.recurrence, recurrenceLabel(t.recurrence)]);
    for (const [v, l] of options) sel.createEl("option", { value: v, text: l });
    sel.value = t.recurrence?.startsWith("every week on") && !options.some(([v]) => v === t.recurrence) ? "custom" : t.recurrence ?? "";
    const daysRow = recCtl.createDiv("wp-days");
    const renderDays = () => {
      daysRow.empty();
      if (sel.value !== "custom" && !t.recurrence?.startsWith("every week on")) return;
      const current = (t.recurrence?.match(/every week on (.+)/)?.[1] ?? "")
        .split(",").map((s) => ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].indexOf(s.trim().toLowerCase()) + 1)
        .filter((n) => n > 0);
      DAY_SHORT.forEach((d, i) => {
        const b = daysRow.createEl("button", { text: d, cls: "wp-chip-btn" });
        if (current.includes(i + 1)) b.addClass("is-active");
        b.onclick = () => {
          const next = current.includes(i + 1) ? current.filter((x) => x !== i + 1) : [...current, i + 1];
          t.recurrence = next.length ? weekOnRule(next) : null;
          renderDays();
        };
      });
    };
    sel.addEventListener("change", () => {
      t.recurrence = sel.value && sel.value !== "custom" ? sel.value : sel.value === "custom" ? weekOnRule([wd]) : null;
      renderDays();
    });
    renderDays();

    // subtasks
    const subWrap = c.createDiv("wp-subtasks");
    subWrap.createDiv({ cls: "wp-field-label", text: `Подзадачи ${t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : ""}` });
    t.subtasks.forEach((s, i) => {
      const row = subWrap.createDiv("wp-subtask");
      const cb = row.createEl("input", { attr: { type: "checkbox" }, cls: "task-list-item-checkbox" });
      cb.checked = s.done;
      cb.onchange = () => (s.done = cb.checked);
      const inp = row.createEl("input", { attr: { type: "text" } });
      inp.value = s.text;
      inp.oninput = () => (s.text = inp.value);
      const del = row.createEl("button", { text: "×", cls: "wp-icon-btn" });
      del.onclick = () => {
        t.subtasks.splice(i, 1);
        this.render();
      };
    });
    const addSub = subWrap.createEl("input", { attr: { type: "text", placeholder: "+ подзадача (Enter)" }, cls: "wp-add-sub" });
    addSub.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && addSub.value.trim() && !e.isComposing) {
        e.preventDefault();
        t.subtasks.push({ done: false, text: addSub.value.trim() });
        this.render();
        (this.contentEl.querySelector(".wp-add-sub") as HTMLInputElement)?.focus();
      }
    });

    if (t.moved && t.moved < STALE_AT) c.createDiv({ cls: "wp-modal-note", text: `↪ Переносилась ${t.moved} раз(а)` });
    if (t.spent) c.createDiv({ cls: "wp-modal-note is-muted", text: `⏱ В фокусе: ${formatDuration(t.spent).replace("h", "ч ").replace("m", "м")}` });

    // buttons
    const footer = c.createDiv("wp-modal-footer");
    if (!this.isNew) {
      const del = footer.createEl("button", { text: "Удалить", cls: "mod-warning" });
      del.onclick = async () => {
        await this.store.remove(t.id);
        new Notice("Задача удалена");
        this.close();
      };
    }
    if (!this.isNew && !t.done) {
      const focus = footer.createEl("button", { text: "▶ Фокус" });
      focus.onclick = () => {
        this.close();
        this.plugin.activateFocus(t.id);
      };
    }
    footer.createDiv({ cls: "wp-spacer" });
    footer.createEl("button", { text: "Отмена" }).onclick = () => this.close();
    footer.createEl("button", { text: "Сохранить", cls: "mod-cta" }).onclick = () => this.save();
  }

  private renderStaleBanner(c: HTMLElement) {
    const t = this.draft;
    const b = c.createDiv("wp-stale-banner");
    b.createDiv({ cls: "wp-stale-text", text: `⚠️ Задача переносилась ${t.moved} раз. Похоже, она слишком большая или уже не нужна.` });
    const actions = b.createDiv("wp-stale-actions");
    const act = (label: string, fn: () => void | Promise<void>) => {
      const btn = actions.createEl("button", { text: label, cls: "wp-chip-btn" });
      btn.onclick = async () => { await fn(); };
    };
    act("Разбить на подзадачи", () => {
      t.moved = 0;
      (this.contentEl.querySelector(".wp-add-sub") as HTMLInputElement)?.focus();
      b.remove();
    });
    act("В бэклог", async () => {
      await this.store.update(t.id, { due: null, moved: 0 });
      this.close();
    });
    act("Сбросить счётчик", () => {
      t.moved = 0;
      b.remove();
    });
    act("Удалить", async () => {
      await this.store.remove(t.id);
      this.close();
    });
  }

  private async save() {
    const t = this.draft;
    if (this.isNew) {
      // Allow quick-add syntax in the title of a new task.
      const q = parseQuick(t.title, t.due ?? undefined);
      const merged: Partial<Task> = { ...t, title: q.task.title || t.title };
      if (q.task.time && !t.time) merged.time = q.task.time;
      if (q.task.duration && !t.duration) merged.duration = q.task.duration;
      if (q.task.priority && !t.priority) merged.priority = q.task.priority;
      if (q.task.recurrence && !t.recurrence) merged.recurrence = q.task.recurrence;
      merged.tags = [...new Set([...t.tags, ...(q.task.tags ?? [])])];
      if (!merged.title?.trim()) return;
      const due = q.due !== undefined ? q.due : t.due;
      delete merged.id;
      await this.store.add(merged, due);
    } else {
      if (!t.title.trim()) return;
      const { id, ...patch } = t;
      await this.store.update(id, patch);
    }
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
