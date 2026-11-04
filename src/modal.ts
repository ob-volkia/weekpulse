// Task window: a row of property chips on top (date, time, deadline, priority, tags, repeat,
// goal — each opens a small picker), and the task's body below (description / spec, subtasks,
// links, files, comments). The body is stored in the task's own note (see tasknotes.ts).

import { App, Modal, Notice, Platform, TFile, requestUrl, setIcon } from "obsidian";
import { DAY_SHORT, DateStr, addDays, diffDays, fmtMinutes, humanDay, relativeLabel, startOfWeek, today, weekday } from "./dates";
import { PRIORITY_LABEL, Priority, Task, emptyTask, parseDuration, recurrenceLabel, weekOnRule } from "./model";
import { parseQuick } from "./quickadd";
import { Store } from "./store";
import { TaskBody, emptyBody, nowStamp, titleFromHtml } from "./tasknotes";
import type WeekPlannerPlugin from "./main";
import { STALE_AT } from "./weekView";
import { ICON, icon, iconButton, iconText } from "./ui";

const PRIORITIES: Priority[] = [3, 2, 1, 0, -1];
const EN_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|svg)$/i;

type Panel = "date" | "time" | "deadline" | "priority" | "tags" | "repeat" | "goal" | null;

export class TaskModal extends Modal {
  private draft: Task;
  private isNew: boolean;
  private store: Store;
  private body: TaskBody = emptyBody();
  private bodyLoaded = "";
  private panel: Panel = null;
  private chipsEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private linksEl!: HTMLElement;
  private filesEl!: HTMLElement;
  private commentsEl!: HTMLElement;
  private subsEl!: HTMLElement;

  constructor(app: App, private plugin: WeekPlannerPlugin, task: Task | null, defaultDue: DateStr | null, initial: Partial<Task> = {}) {
    super(app);
    this.store = plugin.store;
    this.isNew = !task;
    this.draft = task ? structuredClone(task) : emptyTask({ ...initial, due: defaultDue });
  }

  async onOpen() {
    this.modalEl.addClass("wp-modal", "wp-task-modal");
    this.titleEl.setText(this.isNew ? "Новая задача" : "");
    if (!this.isNew) this.body = await this.store.readBody(this.draft);
    this.bodyLoaded = JSON.stringify(this.body);
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  // ---------- layout ----------

  private render() {
    const t = this.draft;
    const c = this.contentEl;
    c.empty();
    if (!this.isNew && !t.done && t.moved >= STALE_AT) this.renderStaleBanner(c);

    const title = c.createEl("textarea", {
      cls: "wp-task-title",
      attr: { rows: "1", placeholder: this.isNew ? "Что сделать? Можно: завтра 14:00 1ч #тег !! до пт" : "Название" },
    });
    title.value = t.title;
    const fit = () => { title.style.height = "auto"; title.style.height = `${title.scrollHeight}px`; };
    title.addEventListener("input", () => { t.title = title.value.replace(/\n/g, " "); fit(); });
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); this.save(); }
    });
    setTimeout(fit, 0);
    // On a phone the keyboard would cover the form when just viewing a task.
    if (this.isNew || !Platform.isMobile) setTimeout(() => title.focus(), 10);

    this.chipsEl = c.createDiv("wp-chips");
    this.panelEl = c.createDiv("wp-panel");
    this.renderChips();

    const body = c.createDiv("wp-task-body");
    this.renderDescription(body);
    this.subsEl = body.createDiv("wp-section-block");
    this.renderSubtasks();
    this.linksEl = body.createDiv("wp-section-block");
    this.renderLinks();
    this.filesEl = body.createDiv("wp-section-block");
    this.renderFiles();
    this.commentsEl = body.createDiv("wp-section-block");
    this.renderComments();

    const notes: string[] = [];
    if (t.moved && t.moved < STALE_AT) notes.push(`переносилась ${t.moved} раз(а)`);
    if (t.spent) notes.push(`в фокусе ${fmtMinutes(t.spent)}`);
    if (t.created) notes.push(`создана ${humanDay(t.created)}`);
    if (notes.length && !this.isNew) c.createDiv({ cls: "wp-task-foot-note", text: notes.join(" · ") });

    const footer = c.createDiv("wp-modal-footer wp-task-footer");
    if (!this.isNew) {
      const del = iconButton(footer, "trash-2", "", "wp-square-btn wp-danger", "Удалить");
      del.onclick = async () => {
        await this.store.remove(t.id);
        this.close();
      };
      if (!t.done) {
        const focus = iconButton(footer, ICON.focus, "", "wp-square-btn", "Фокус на задаче");
        focus.onclick = async () => {
          await this.save(false);
          this.plugin.activateFocus(t.id);
        };
      }
    }
    const asNote = iconButton(footer, "file-text", "", "wp-square-btn", "Открыть как заметку");
    asNote.onclick = () => this.openAsNote();
    footer.createDiv({ cls: "wp-spacer" });
    footer.createEl("button", { text: "Отмена" }).onclick = () => this.close();
    footer.createEl("button", { text: "Сохранить", cls: "mod-cta" }).onclick = () => this.save();
  }

  private section(parent: HTMLElement, ic: string, label: string, count?: string) {
    parent.empty();
    const h = parent.createDiv("wp-section-title");
    icon(h, ic);
    h.createSpan({ text: label });
    if (count) h.createSpan({ cls: "wp-muted", text: count });
    return h;
  }

  // ---------- property chips ----------

  private chip(key: Panel, ic: string, label: string, opts: { empty?: boolean; cls?: string } = {}) {
    const b = this.chipsEl.createEl("button", { cls: `wp-prop-chip ${opts.empty ? "is-empty" : ""} ${opts.cls ?? ""} ${this.panel === key ? "is-open" : ""}` });
    icon(b, ic);
    b.createSpan({ text: label });
    b.onclick = () => {
      this.panel = this.panel === key ? null : key;
      this.renderChips();
    };
    return b;
  }

  private renderChips() {
    const t = this.draft;
    this.chipsEl.empty();
    const dueLabel = t.due ? relativeLabel(t.due) ?? `${DAY_SHORT[weekday(t.due) - 1]}, ${humanDay(t.due)}` : "Бэклог";
    this.chip("date", t.due ? "calendar" : ICON.backlog, dueLabel);
    this.chip("time", "clock", t.time || t.duration ? [t.time, t.duration ? fmtMinutes(t.duration) : ""].filter(Boolean).join(" · ") : "Время", { empty: !t.time && !t.duration });
    if (t.deadline) {
      const left = diffDays(t.deadline, today());
      this.chip("deadline", "flag", `до ${humanDay(t.deadline)}`, { cls: left < 0 ? "is-danger" : left <= 2 ? "is-warning" : "" });
    } else this.chip("deadline", "flag", "Дедлайн", { empty: true });
    const p = this.chip("priority", "signal", t.priority ? PRIORITY_LABEL[t.priority] : "Приоритет", { empty: !t.priority, cls: `prio-${t.priority}` });
    p.prepend(createSpan({ cls: "wp-prio-dot" }));
    this.chip("tags", "hash", t.tags.length ? t.tags.map((x) => "#" + x).join(" ") : "Теги", { empty: !t.tags.length });
    this.chip("repeat", "repeat", t.recurrence ? recurrenceLabel(t.recurrence) : "Повтор", { empty: !t.recurrence });
    const goals = this.store.goalsFor(startOfWeek(t.due ?? today()));
    if (goals.length || t.goal) {
      const g = t.goal ? this.store.findGoal(t.goal) : null;
      this.chip("goal", "target", g ? g.title : "Цель", { empty: !g });
    }
    this.renderPanel();
  }

  private renderPanel() {
    const t = this.draft;
    const el = this.panelEl;
    el.empty();
    el.toggleClass("is-open", !!this.panel);
    if (!this.panel) return;
    const row = el.createDiv("wp-panel-row");
    const quick = (label: string, fn: () => void, active = false) => {
      const b = row.createEl("button", { text: label, cls: `wp-chip-btn ${active ? "is-active" : ""}` });
      b.onclick = () => { fn(); this.renderChips(); };
      return b;
    };
    const dateInput = (value: string | null, onChange: (v: string | null) => void) => {
      const inp = row.createEl("input", { attr: { type: "date" } });
      inp.value = value ?? "";
      inp.addEventListener("change", () => { onChange(inp.value || null); this.renderChips(); });
    };
    const now = today();
    switch (this.panel) {
      case "date":
        quick("Сегодня", () => (t.due = now), t.due === now);
        quick("Завтра", () => (t.due = addDays(now, 1)), t.due === addDays(now, 1));
        quick("След. неделя", () => (t.due = addDays(startOfWeek(now), 7)));
        quick("Бэклог", () => (t.due = null), t.due === null);
        dateInput(t.due, (v) => (t.due = v));
        break;
      case "time": {
        const time = row.createEl("input", { attr: { type: "time" } });
        time.value = t.time ?? "";
        time.addEventListener("change", () => { t.time = time.value || null; this.renderChips(); });
        for (const m of [15, 30, 60, 90, 120]) quick(fmtMinutes(m), () => (t.duration = m), t.duration === m);
        const dur = row.createEl("input", { cls: "wp-dur", attr: { type: "text", placeholder: "другое" } });
        dur.addEventListener("change", () => { t.duration = parseDuration(dur.value); this.renderChips(); });
        if (t.time || t.duration) quick("Убрать", () => { t.time = null; t.duration = 0; });
        break;
      }
      case "deadline":
        quick("Сегодня", () => (t.deadline = now));
        quick("Пятница", () => (t.deadline = addDays(startOfWeek(now), weekday(now) > 5 ? 11 : 4)));
        quick("Через неделю", () => (t.deadline = addDays(now, 7)));
        dateInput(t.deadline, (v) => (t.deadline = v));
        if (t.deadline) quick("Убрать", () => (t.deadline = null));
        break;
      case "priority":
        for (const p of PRIORITIES) {
          const b = quick(PRIORITY_LABEL[p], () => (t.priority = p), t.priority === p);
          b.addClass("wp-prio-btn", `prio-${p}`);
          b.prepend(createSpan({ cls: "wp-prio-dot" }));
        }
        break;
      case "tags": {
        const inp = row.createEl("input", { attr: { type: "text", placeholder: "новый тег, Enter" } });
        inp.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.isComposing) return;
          e.preventDefault();
          const v = inp.value.replace(/^#/, "").trim();
          if (v && !t.tags.includes(v)) t.tags.push(v);
          this.renderChips();
          (this.panelEl.querySelector("input") as HTMLInputElement | null)?.focus();
        });
        for (const tag of t.tags) quick(`#${tag} ×`, () => (t.tags = t.tags.filter((x) => x !== tag)), true);
        for (const tag of this.store.allTags().filter((x) => !t.tags.includes(x)).slice(0, 10)) quick("#" + tag, () => t.tags.push(tag));
        if (!Platform.isMobile) setTimeout(() => inp.focus(), 0);
        break;
      }
      case "repeat": {
        const wd = t.due ? weekday(t.due) : 1;
        const opts: [string | null, string][] = [[null, "Не повторять"], ["every day", "Каждый день"], ["every weekday", "По будням"],
          [weekOnRule([wd]), `Каждую неделю (${DAY_SHORT[wd - 1]})`], ["every 2 weeks", "Раз в 2 недели"], ["every month", "Каждый месяц"]];
        for (const [v, l] of opts) quick(l, () => (t.recurrence = v), t.recurrence === v);
        const days = el.createDiv("wp-panel-row");
        days.createSpan({ cls: "wp-muted", text: "Дни недели:" });
        const current = (t.recurrence?.match(/every week on (.+)/)?.[1] ?? "").split(",").map((s) => EN_DAYS.indexOf(s.trim().toLowerCase()) + 1).filter((n) => n > 0);
        DAY_SHORT.forEach((d, i) => {
          const b = days.createEl("button", { text: d, cls: `wp-chip-btn ${current.includes(i + 1) ? "is-active" : ""}` });
          b.onclick = () => {
            const next = current.includes(i + 1) ? current.filter((x) => x !== i + 1) : [...current, i + 1];
            t.recurrence = next.length ? weekOnRule(next) : null;
            this.renderChips();
          };
        });
        break;
      }
      case "goal": {
        quick("Без цели", () => (t.goal = null), !t.goal);
        for (const g of this.store.goalsFor(startOfWeek(t.due ?? now))) quick(g.title, () => (t.goal = g.id), t.goal === g.id);
        break;
      }
    }
  }

  // ---------- body ----------

  private renderDescription(parent: HTMLElement) {
    const wrap = parent.createDiv("wp-section-block");
    const h = wrap.createDiv("wp-section-title");
    icon(h, "align-left");
    h.createSpan({ text: "Описание и ТЗ" });
    const ta = wrap.createEl("textarea", { cls: "wp-desc", attr: { rows: "4", placeholder: "Что нужно сделать, требования, детали. Markdown и [[ссылки]] работают." } });
    ta.value = this.body.description;
    const fit = () => { ta.style.height = "auto"; ta.style.height = `${Math.max(96, ta.scrollHeight)}px`; };
    ta.addEventListener("input", () => { this.body.description = ta.value; fit(); });
    setTimeout(fit, 0);
  }

  private renderSubtasks() {
    const t = this.draft;
    const el = this.subsEl;
    this.section(el, ICON.subtasks, "Подзадачи", t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : "");
    t.subtasks.forEach((s, i) => {
      const row = el.createDiv("wp-subtask");
      const cb = row.createEl("input", { attr: { type: "checkbox" }, cls: "task-list-item-checkbox" });
      cb.checked = s.done;
      cb.onchange = () => { s.done = cb.checked; this.renderSubtasks(); };
      const inp = row.createEl("input", { attr: { type: "text" } });
      inp.value = s.text;
      inp.oninput = () => (s.text = inp.value);
      const del = row.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Удалить подзадачу" } });
      setIcon(del, "x");
      del.onclick = () => { t.subtasks.splice(i, 1); this.renderSubtasks(); };
    });
    const add = el.createEl("input", { cls: "wp-add-sub", attr: { type: "text", placeholder: "Добавить подзадачу" } });
    add.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || !add.value.trim()) return;
      e.preventDefault();
      t.subtasks.push({ done: false, text: add.value.trim() });
      this.renderSubtasks();
      (this.subsEl.querySelector(".wp-add-sub") as HTMLInputElement)?.focus();
    });
  }

  private renderLinks() {
    const el = this.linksEl;
    const links = this.body.links;
    this.section(el, "link", "Ссылки", links.length ? String(links.length) : "");
    for (const [i, l] of links.entries()) {
      const row = el.createDiv("wp-link-row");
      icon(row, "external-link");
      const a = row.createEl("a", { text: l.title || l.url, attr: { href: l.url, target: "_blank", rel: "noopener" } });
      a.addClass("wp-link-title");
      if (l.title) row.createSpan({ cls: "wp-muted wp-link-host", text: hostOf(l.url) });
      const del = row.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Убрать ссылку" } });
      setIcon(del, "x");
      del.onclick = () => { links.splice(i, 1); this.renderLinks(); };
    }
    const add = el.createEl("input", { attr: { type: "url", placeholder: "Вставь ссылку и нажми Enter" } });
    add.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      let url = add.value.trim();
      if (!url) return;
      if (!/^[a-z]+:\/\//i.test(url) && !url.startsWith("obsidian:")) url = "https://" + url;
      const link = { title: "", url };
      links.push(link);
      this.renderLinks();
      (this.linksEl.querySelector("input") as HTMLInputElement)?.focus();
      try {
        const res = await requestUrl({ url, throw: false });
        const title = titleFromHtml(res.text ?? "");
        if (title) { link.title = title; this.renderLinks(); }
      } catch { /* offline or not a page: keep the bare URL */ }
    });
  }

  private renderFiles() {
    const el = this.filesEl;
    const files = this.body.files;
    this.section(el, "paperclip", "Файлы", files.length ? String(files.length) : "");
    const grid = el.createDiv("wp-files");
    for (const [i, path] of files.entries()) {
      const tile = grid.createDiv("wp-file");
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile && IMAGE_EXT.test(path)) {
        tile.addClass("is-image");
        tile.createEl("img", { attr: { src: this.app.vault.getResourcePath(f), alt: f.name } });
      } else {
        icon(tile, "file");
        tile.createSpan({ cls: "wp-file-name", text: path.split("/").pop()!.replace(/^[\w]{6}-/, "") });
      }
      tile.onclick = () => this.app.workspace.openLinkText(path, "", "tab");
      const del = tile.createEl("button", { cls: "wp-file-del", attr: { "aria-label": "Открепить" } });
      setIcon(del, "x");
      del.onclick = (e) => { e.stopPropagation(); files.splice(i, 1); this.renderFiles(); };
    }
    const picker = el.createEl("input", { attr: { type: "file", multiple: "" } });
    picker.style.display = "none";
    picker.onchange = async () => {
      for (const file of Array.from(picker.files ?? [])) {
        try {
          files.push(await this.store.attach(this.draft.id, file.name, await file.arrayBuffer()));
        } catch (e) {
          console.error(e);
          new Notice(`Не удалось прикрепить ${file.name}`);
        }
      }
      this.renderFiles();
    };
    const add = iconButton(el, "plus", "Прикрепить файл или фото", "wp-chip-btn");
    add.onclick = () => picker.click();
  }

  private renderComments() {
    const el = this.commentsEl;
    const list = this.body.comments;
    this.section(el, "message-circle", "Комментарии", list.length ? String(list.length) : "");
    for (const [i, cm] of list.entries()) {
      const row = el.createDiv("wp-comment");
      const head = row.createDiv("wp-comment-head");
      head.createSpan({ cls: "wp-muted", text: fmtStamp(cm.at) });
      const del = head.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Удалить комментарий" } });
      setIcon(del, "x");
      del.onclick = () => { list.splice(i, 1); this.renderComments(); };
      row.createDiv({ cls: "wp-comment-text", text: cm.text });
    }
    const add = el.createEl("textarea", { cls: "wp-comment-input", attr: { rows: "1", placeholder: "Написать комментарий… (Enter — добавить)" } });
    add.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || !add.value.trim()) return;
      e.preventDefault();
      list.push({ at: nowStamp(), text: add.value.trim() });
      this.renderComments();
      (this.commentsEl.querySelector("textarea") as HTMLTextAreaElement)?.focus();
    });
  }

  private renderStaleBanner(c: HTMLElement) {
    const t = this.draft;
    const b = c.createDiv("wp-stale-banner");
    iconText(b.createDiv("wp-stale-text"), ICON.stale, `Задача переносилась ${t.moved} раз. Похоже, она слишком большая или уже не нужна.`);
    const actions = b.createDiv("wp-stale-actions");
    const act = (label: string, fn: () => void | Promise<void>) => {
      const btn = actions.createEl("button", { text: label, cls: "wp-chip-btn" });
      btn.onclick = async () => { await fn(); };
    };
    act("Разбить на подзадачи", () => {
      t.moved = 0;
      b.remove();
      (this.contentEl.querySelector(".wp-add-sub") as HTMLInputElement)?.focus();
    });
    act("В бэклог", async () => { await this.store.update(t.id, { due: null, moved: 0 }); this.close(); });
    act("Сбросить счётчик", () => { t.moved = 0; b.remove(); });
    act("Удалить", async () => { await this.store.remove(t.id); this.close(); });
  }

  // ---------- saving ----------

  private async save(close = true) {
    const t = this.draft;
    if (this.isNew) {
      // Quick-add syntax works in the title of a new task.
      const q = parseQuick(t.title, t.due ?? undefined);
      const merged: Partial<Task> = { ...t, title: q.task.title || t.title };
      if (q.task.time && !t.time) merged.time = q.task.time;
      if (q.task.duration && !t.duration) merged.duration = q.task.duration;
      if (q.task.priority && !t.priority) merged.priority = q.task.priority;
      if (q.task.recurrence && !t.recurrence) merged.recurrence = q.task.recurrence;
      if (q.task.deadline && !t.deadline) merged.deadline = q.task.deadline;
      merged.tags = [...new Set([...t.tags, ...(q.task.tags ?? [])])];
      if (!merged.title?.trim()) return;
      await this.store.add(merged, q.due !== undefined ? q.due : t.due);
      t.title = merged.title;
      this.isNew = false;
    } else {
      if (!t.title.trim()) return;
      const { id, note, ...patch } = t; // the body save below owns `note`
      void note;
      await this.store.update(id, patch);
    }
    if (JSON.stringify(this.body) !== this.bodyLoaded || this.draft.extra.length) {
      await this.store.saveBody(t.id, t.title, this.body);
      this.bodyLoaded = JSON.stringify(this.body);
    }
    if (close) this.close();
  }

  private async openAsNote() {
    if (!this.draft.title.trim()) return;
    await this.save(false);
    let t = this.store.find(this.draft.id);
    if (t && !t.note) {
      await this.store.saveBody(t.id, t.title, this.body);
      t = this.store.find(t.id);
    }
    this.close();
    if (t?.note) await this.plugin.openFile(t.note);
  }
}

function hostOf(url: string) {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; }
}

function fmtStamp(at: string) {
  const [d, time] = at.split(" ");
  const rel = relativeLabel(d);
  return `${rel ?? humanDay(d)}, ${time}`;
}
