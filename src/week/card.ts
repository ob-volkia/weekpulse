// Task cards and their context menu.

import { Menu, setIcon } from "obsidian";
import { DateStr, addDays, diffDays, fmtMinutes, humanDay, startOfWeek, today } from "../dates";
import { PRIORITY_LABEL, Priority, Task, displayTitle, projectOf, recurrenceLabel, taskNotes } from "../model";
import { TaskModal } from "../modal";
import { ICON, icon, iconText } from "../ui";
import type { WeekView } from "../weekView";
import { STALE_AT, tagColor } from "./shared";

export function renderCard(v: WeekView, parent: HTMLElement, t: Task, mini = false): HTMLElement {
  const card = parent.createDiv({ cls: `wp-card prio-${t.priority}`, attr: { "data-id": t.id } });
  if (mini) card.addClass("is-mini");
  if (t.done) card.addClass("is-done");
  if (t.source) card.addClass("is-external");
  const stale = !t.done && t.moved >= STALE_AT;
  if (t.moved >= 3 && !t.done) card.addClass("is-stale");
  if (v.plugin.focus.taskId === t.id) card.addClass("is-focus");
  if (v.selection.has(t.id)) card.addClass("is-selected");
  const overdue = !!t.source && !t.done && t.due! < today();
  const row = card.createDiv("wp-card-row");
  const cb = row.createEl("input", { attr: { type: "checkbox", "aria-label": "Выполнено" }, cls: "task-list-item-checkbox wp-check" });
  cb.checked = t.done;
  cb.addEventListener("click", (e) => {
    e.stopPropagation();
    v.store.toggle(t.id);
  });
  const body = row.createDiv("wp-card-body");
  const title = body.createDiv({ cls: "wp-card-title", text: displayTitle(t) });
  if (stale) {
    const warn = title.createSpan({ cls: "wp-stale-icon", attr: { "aria-label": `Переносилась ${t.moved} раз — пора решить, что с ней делать` } });
    setIcon(warn, "alert-triangle");
  }
  if (!mini) {
    const meta = body.createDiv("wp-card-meta");
    if (t.time) meta.createSpan({ cls: "wp-meta wp-time", text: t.time });
    if (t.duration) meta.createSpan({ cls: "wp-meta", text: fmtMinutes(t.duration) });
    if (t.spent) iconText(meta, ICON.spent, fmtMinutes(t.spent), "wp-meta wp-spent", "Потрачено в фокусе");
    if (t.recurrence) setIcon(meta.createSpan({ cls: "wp-meta wp-icon-meta", attr: { "aria-label": recurrenceLabel(t.recurrence) } }), "repeat");
    if (t.moved) iconText(meta, ICON.moved, String(t.moved), "wp-meta wp-moved", `Переносилась ${t.moved} раз(а)`);
    if (overdue) meta.createSpan({ cls: "wp-meta wp-overdue", text: `с ${humanDay(t.due!)}` });
    if (t.deadline && !t.done) {
      const left = diffDays(t.deadline, today());
      const cls = left < 0 ? "is-overdue" : left <= 2 ? "is-soon" : "";
      iconText(meta, "flag", left === 0 ? "сегодня" : left === 1 ? "до завтра" : `до ${humanDay(t.deadline)}`, `wp-meta wp-deadline ${cls}`,
        left < 0 ? `Дедлайн прошёл ${humanDay(t.deadline)}` : `Дедлайн: ${humanDay(t.deadline)}`);
    }
    const nm = v.store.metaFor(t);
    if (nm?.description || taskNotes(t)) icon(meta.createSpan({ cls: "wp-meta", attr: { "aria-label": "Есть описание" } }), "align-left");
    if (nm?.links) iconText(meta, "link", String(nm.links), "wp-meta", "Ссылки");
    if (nm?.files) iconText(meta, "paperclip", String(nm.files), "wp-meta", "Файлы");
    if (nm?.comments) iconText(meta, "message-circle", String(nm.comments), "wp-meta", "Комментарии");
    if (t.goal) {
      const g = v.store.findGoal(t.goal);
      if (g) iconText(meta, "target", g.title, "wp-meta wp-goal-badge", "Цель недели");
    }
    if (t.subtasks.length) {
      const done = t.subtasks.filter((s) => s.done).length;
      const s = meta.createSpan({ cls: "wp-meta wp-icon-meta" });
      setIcon(s, "list-checks");
      s.createSpan({ text: `${done}/${t.subtasks.length}` });
    }
    const project = projectOf(t);
    if (project) {
      const p = meta.createSpan({ cls: "wp-project", attr: { "aria-label": "Открыть проект" } });
      setIcon(p.createSpan(), "folder");
      p.createSpan({ text: project });
      p.addEventListener("click", (e) => {
        e.stopPropagation();
        v.app.workspace.openLinkText(project, t.source?.path ?? v.settings.tasksFile, "tab");
      });
    }
    if (t.source) {
      const src = meta.createSpan({ cls: "wp-meta wp-icon-meta wp-source", attr: { "aria-label": `Из заметки: ${t.source.path}` } });
      setIcon(src, "file-symlink");
      src.createSpan({ text: t.source.path.split("/").pop()!.replace(/\.md$/, "") });
    }
    for (const tag of t.tags) {
      const chip = meta.createSpan({ cls: `wp-tag tag-c${tagColor(tag)}`, text: "#" + tag });
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        v.setFilter({ tag: v.filter.tag === tag ? null : tag });
      });
    }
    if (!meta.childElementCount) meta.remove();
  }

  card.addEventListener("click", (e) => {
    if (v.selectMode || v.selection.size || e.shiftKey || e.metaKey || e.ctrlKey) {
      if (t.archivePath) return;
      if (v.selection.has(t.id)) v.selection.delete(t.id);
      else v.selection.add(t.id);
      v.render();
      return;
    }
    openTask(v, t);
  });
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    cardMenu(v, t).showAtMouseEvent(e);
  });
  return card;
}

export function openTask(v: WeekView, t: Task) {
  if (t.source) v.plugin.openSource(t);
  else new TaskModal(v.app, v.plugin, t, t.due).open();
}

export function updateFocusBadge(v: WeekView) {
  const btn = v.contentEl.querySelector(".wp-toolbar .wp-icon-btn[aria-label^='Фокус']");
  btn?.toggleClass("is-running", v.plugin.focus.running);
}

export function cardMenu(v: WeekView, t: Task) {
  const m = new Menu();
  const now = today();
  const moveTo = (title: string, icon: string, due: DateStr | null) =>
    m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => v.store.move(t.id, due, null)));
  m.addItem((i) => i.setTitle(t.done ? "Вернуть в работу" : "Выполнено").setIcon("check").onClick(() => v.store.toggle(t.id)));
  if (!t.done && !t.source) m.addItem((i) => i.setTitle("Фокус на задаче").setIcon("timer").onClick(() => v.plugin.activateFocus(t.id)));
  m.addSeparator();
  moveTo("На сегодня", "sun", now);
  moveTo("На завтра", "sunrise", addDays(now, 1));
  moveTo("На следующую неделю", "calendar-plus", addDays(startOfWeek(now), 7));
  moveTo("В бэклог", "inbox", null);
  if (t.source) {
    m.addSeparator();
    m.addItem((i) => i.setTitle("Открыть заметку").setIcon("file-symlink").onClick(() => v.plugin.openSource(t)));
    return m;
  }
  m.addSeparator();
  const prios: Priority[] = [3, 2, 1, 0, -1];
  for (const p of prios)
    m.addItem((i) => i.setTitle(`Приоритет: ${PRIORITY_LABEL[p]}`).setChecked(t.priority === p).onClick(() => v.store.update(t.id, { priority: p })));
  m.addSeparator();
  if (t.moved) m.addItem((i) => i.setTitle("Сбросить счётчик переносов").setIcon("rotate-ccw").onClick(() => v.store.update(t.id, { moved: 0 })));
  m.addItem((i) => i.setTitle("Дублировать").setIcon("copy").onClick(() => {
    const { id, ...rest } = t;
    void id;
    v.store.add({ ...rest, done: false, doneDate: null, moved: 0, spent: 0 }, t.due);
  }));
  m.addItem((i) => i.setTitle("Открыть в файле").setIcon("file-text").onClick(() => v.openTasksFile(t)));
  m.addItem((i) => i.setTitle("Удалить").setIcon("trash").setWarning(true).onClick(() => v.store.remove(t.id)));
  return m;
}
