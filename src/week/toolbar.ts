// Desktop toolbar and its menus (goals, filters, templates, more, day actions).

import { Menu, Notice, setIcon } from "obsidian";
import { DAY_LONG, DateStr, MONTH_NOM, addDays, parse, today, weekDays, weekLabel, weekday } from "../dates";
import { GoalsModal } from "../goalsModal";
import { icon } from "../ui";
import type { WeekView } from "../weekView";
import { Mode, cap } from "./shared";
import { renderMobileToolbar } from "./mobile";
import { profileButton } from "../profiles";

export function filterMenu(v: WeekView, e: MouseEvent) {
  const m = new Menu();
  const f = v.filter;
  if (v.filterActive()) m.addItem((i) => i.setTitle("Сбросить фильтр").setIcon("x").onClick(() => v.setFilter({ tag: null, minPriority: null, goal: null })));
  for (const sf of v.settings.savedFilters)
    m.addItem((i) => i.setTitle(sf.name).setIcon("bookmark").setChecked(f.name === sf.name).onClick(() => { v.filter = { ...sf }; v.render(); }));
  if (v.settings.savedFilters.length) m.addSeparator();
  for (const t of v.store.allTags())
    m.addItem((i) => i.setTitle("#" + t).setChecked(f.tag === t).onClick(() => v.setFilter({ tag: f.tag === t ? null : t })));
  m.addSeparator();
  for (const [p, label] of [[2, "Только высокий и срочный"], [1, "Средний и выше"]] as [number, string][])
    m.addItem((i) => i.setTitle(label).setIcon("signal").setChecked(f.minPriority === p).onClick(() => v.setFilter({ minPriority: f.minPriority === p ? null : p })));
  const goals = v.store.goalsFor(v.weekStart);
  if (goals.length) {
    m.addSeparator();
    for (const g of goals) m.addItem((i) => i.setTitle(`Цель: ${g.title}`).setIcon("target").setChecked(f.goal === g.id).onClick(() => v.setFilter({ goal: f.goal === g.id ? null : g.id })));
  }
  if (v.filterActive() && !f.name) {
    m.addSeparator();
    m.addItem((i) => i.setTitle("Сохранить фильтр…").setIcon("bookmark-plus").onClick(() =>
      v.plugin.promptText("Название фильтра", v.filterLabel(), async (name) => {
        v.settings.savedFilters = [...v.settings.savedFilters.filter((x) => x.name !== name), { ...v.filter, name }];
        await v.plugin.saveSettings();
        v.filter = { ...v.filter, name };
        v.render();
      })));
  }
  if (f.name) m.addItem((i) => i.setTitle(`Удалить фильтр «${f.name}»`).setIcon("trash").onClick(async () => {
    v.settings.savedFilters = v.settings.savedFilters.filter((x) => x.name !== f.name);
    await v.plugin.saveSettings();
    v.setFilter({ tag: null, minPriority: null, goal: null });
  }));
  m.showAtMouseEvent(e);
}

export function filterButton(v: WeekView, parent: HTMLElement, compact: boolean) {
  const active = v.filterActive();
  if (compact && !active) return;
  const b = parent.createEl("button", { cls: `wp-chip-btn wp-filter-btn ${active ? "is-active" : ""}` });
  icon(b, "filter");
  b.createSpan({ text: active ? v.filterLabel() : "Фильтр" });
  b.onclick = (e) => filterMenu(v, e);
}

/** ‹ / › — also a drop target: drop a task here to move it a week, hover to flip the week. */
export function arrow(v: WeekView, parent: HTMLElement, dir: 1 | -1, label: string, droppable: boolean) {
  const b = iconBtn(v, parent, dir < 0 ? "chevron-left" : "chevron-right", label, () => v.shift(dir), "wp-arrow");
  if (droppable) {
    b.dataset.drop = dir < 0 ? "week-prev" : "week-next";
    b.dataset.flip = String(dir);
  }
  return b;
}

export function iconBtn(v: WeekView, parent: HTMLElement, icon: string, label: string, fn: (e: MouseEvent) => void, cls = "") {
  const b = parent.createEl("button", { cls: `wp-icon-btn clickable-icon ${cls}`, attr: { "aria-label": label } });
  setIcon(b, icon);
  b.onclick = fn;
  return b;
}

export function moreMenu(v: WeekView, e: MouseEvent) {
  const m = new Menu();
  const tags = v.store.allTags();
  if (tags.length) {
    m.addItem((i) => i.setTitle("Фильтр…").setIcon("filter").onClick(() => filterMenu(v, e)));
  }
  m.addItem((i) => i.setTitle(v.selectMode ? "Закончить выбор" : "Выбрать задачи").setIcon("check-square").onClick(() => {
    v.selectMode = !v.selectMode;
    if (!v.selectMode) v.selection.clear();
    v.render();
  }));
  if (v.store.canUndo()) m.addItem((i) => i.setTitle("Отменить последнее действие").setIcon("undo-2").onClick(() => v.undo()));
  m.addItem((i) => i.setTitle(v.settings.showDone ? "Скрыть выполненные" : "Показать выполненные").setIcon(v.settings.showDone ? "eye-off" : "eye").onClick(() => v.toggleDone()));
  m.addItem((i) => i.setTitle("Шаблоны…").setIcon("layout-template").onClick(() => templatesMenu(v, e)));
  if (!v.mobile && v.mode === "week")
    m.addItem((i) => i.setTitle(v.compact ? "Обычный вид карточек" : "Компактный вид карточек").setIcon(v.compact ? "unfold-vertical" : "fold-vertical").onClick(() => { v.compact = !v.compact; v.render(); }));
  m.addItem((i) => i.setTitle("Открыть файл задач").setIcon("file-text").onClick(() => v.openTasksFile()));
  m.addItem((i) => i.setTitle("Журнал изменений").setIcon("history").onClick(() => v.plugin.openLog()));
  if (v.mobile) m.addItem((i) => i.setTitle("Проекты").setIcon("folder-kanban").onClick(() => v.plugin.activateProjects()));
  m.addItem((i) => i.setTitle("Разобрать бэклог").setIcon("inbox").onClick(() => v.plugin.openTriage()));
  m.showAtMouseEvent(e);
}

export function renderToolbar(v: WeekView, root: HTMLElement, mode: Mode) {
  if (v.mobile) return renderMobileToolbar(v, root, mode);
  // Three zones: navigation on the left, view switch in the centre, actions on the right.
  const bar = root.createDiv("wp-toolbar wp-toolbar-3");

  const nav = bar.createDiv("wp-nav");
  const month = mode === "month";
  arrow(v, nav, -1, month ? "Прошлый месяц ([)" : "Прошлая неделя ([)", !month);
  nav.createEl("button", { text: "Сегодня", cls: "wp-today-btn" }).onclick = () => v.goToday();
  arrow(v, nav, 1, month ? "Следующий месяц (])" : "Следующая неделя (])", !month);
  const title = nav.createDiv("wp-week-title");
  if (month) {
    const a = parse(v.monthAnchor());
    title.setText(`${MONTH_NOM[a.getMonth()]} ${a.getFullYear()}`);
  } else title.setText(weekLabel(v.weekStart));

  const seg = bar.createDiv("wp-segmented wp-mode");
  const modes: [Mode, string, string][] = [["week", "Неделя", "w"], ["month", "Месяц", "m"], ["timeline", "Шкала", "l"]];
  for (const [m, label, key] of modes) {
    const b = seg.createEl("button", { text: label, cls: "wp-seg-btn", attr: { "aria-label": `${label} (${key})` } });
    if (mode === m) b.addClass("is-active");
    b.onclick = () => v.setMode(m);
  }

  const right = bar.createDiv("wp-toolbar-right");
  profileButton(v.plugin, right);
  if (mode !== "month") goalsButton(v, right, false);
  filterButton(v, right, false);
  iconBtn(v, right, "search", "Найти задачу (⌘K)", () => v.plugin.openPalette());
  iconBtn(v, right, "wand-2", "Спланировать неделю (p)", () => v.plugin.openPlanning(v.weekStart));
  iconBtn(v, right, "timer", "Фокус: сегодня и помодоро (f)", () => v.plugin.activateFocus(), v.plugin.focus.running ? "is-running" : "");
  iconBtn(v, right, "flame", "Привычки и статистика", () => v.plugin.activateHabits());
  iconBtn(v, right, "folder-kanban", "Проекты", () => v.plugin.activateProjects());
  iconBtn(v, right, "more-horizontal", "Ещё", (e) => moreMenu(v, e));
  const add = right.createEl("button", { cls: "mod-cta wp-add-btn", attr: { "aria-label": "Новая задача (n)" } });
  icon(add, "plus");
  add.createSpan({ text: "Задача" });
  add.onclick = () => v.newTask();
}

export function goalsButton(v: WeekView, parent: HTMLElement, compact: boolean) {
  const goals = v.store.goalsFor(v.weekStart);
  const active = v.filter.goal ? v.store.findGoal(v.filter.goal) : null;
  const b = parent.createEl("button", { cls: `wp-chip-btn wp-goals-btn ${active ? "is-active" : ""}`, attr: { "aria-label": "Цели недели" } });
  icon(b, "target");
  if (!compact || active) b.createSpan({ text: active ? active.title : goals.length ? `Цели · ${goals.filter((g) => g.done).length}/${goals.length}` : "Цели" });
  icon(b, "chevron-down", "wp-chevron");
  b.onclick = (e) => goalsMenu(v, e);
}

export function goalsMenu(v: WeekView, e: MouseEvent) {
  const goals = v.store.goalsFor(v.weekStart);
  const tasks = v.store.tasks();
  const m = new Menu();
  if (!goals.length) m.addItem((i) => i.setTitle("Целей на эту неделю нет").setDisabled(true));
  for (const g of goals) {
    const linked = tasks.filter((t) => t.goal === g.id);
    const count = linked.length ? `  ${linked.filter((t) => t.done).length}/${linked.length}` : "";
    m.addItem((i) => i.setTitle(g.title + count).setIcon(g.done ? "check-circle-2" : "circle").setChecked(v.filter.goal === g.id)
      .onClick(() => v.setFilter({ goal: v.filter.goal === g.id ? null : g.id })));
  }
  if (v.filter.goal) m.addItem((i) => i.setTitle("Показать все задачи").setIcon("x").onClick(() => v.setFilter({ goal: null })));
  m.addSeparator();
  if (goals.length < 5) m.addItem((i) => i.setTitle("Добавить цель…").setIcon("plus").onClick(() =>
    v.plugin.promptText("Цель недели", "", (title) => v.store.addGoal(v.weekStart, title))));
  if (goals.length) m.addItem((i) => i.setTitle("Управлять целями…").setIcon("settings-2").onClick(() => new GoalsModal(v.app, v.plugin, v.weekStart).open()));
  m.showAtMouseEvent(e);
}

export async function templatesMenu(v: WeekView, e: MouseEvent) {
  const templates = await v.store.loadTemplates();
  const m = new Menu();
  if (!templates.length) m.addItem((i) => i.setTitle("Шаблонов пока нет").setDisabled(true));
  for (const tpl of templates)
    m.addItem((i) => i.setTitle(`Применить к неделе: ${tpl.name}`).setIcon("layout-template").onClick(async () => {
      await v.store.applyTemplate(tpl, v.weekStart, null);
      new Notice(`Шаблон «${tpl.name}»: добавлено задач ${tpl.tasks.length}`);
    }));
  m.addSeparator();
  m.addItem((i) => i.setTitle("Сохранить эту неделю как шаблон").setIcon("save").onClick(() => {
    const days = weekDays(v.weekStart);
    const tasks = v.store.tasks().filter((t) => t.due && t.due >= days[0] && t.due <= days[6]);
    v.plugin.promptText("Название шаблона недели", "Моя неделя", async (name) => {
      await v.store.saveTemplate(name, tasks, true);
      new Notice(`Шаблон «${name}» сохранён`);
    });
  }));
  m.addItem((i) => i.setTitle("Редактировать шаблоны").setIcon("pencil").onClick(() => v.plugin.openFile(v.settings.templatesFile)));
  m.showAtMouseEvent(e);
}

export async function dayMenu(v: WeekView, e: MouseEvent, day: DateStr) {
  const templates = await v.store.loadTemplates();
  const m = new Menu();
  m.addItem((i) => i.setTitle("Заметка дня").setIcon("calendar-check").onClick(() => v.plugin.openDaily(day)));
  m.addItem((i) => i.setTitle("Фокус на этом дне").setIcon("timer").onClick(() => v.plugin.activateFocus()));
  m.addSeparator();
  for (const tpl of templates)
    m.addItem((i) => i.setTitle(`Шаблон: ${tpl.name}`).setIcon("layout-template").onClick(() => v.store.applyTemplate(tpl, v.weekStart, day)));
  m.addItem((i) => i.setTitle("Сохранить день как шаблон").setIcon("save").onClick(() => {
    const tasks = v.store.tasks().filter((t) => t.due === day);
    v.plugin.promptText("Название шаблона дня", cap(DAY_LONG[weekday(day) - 1]), async (name) => {
      await v.store.saveTemplate(name, tasks, false);
      new Notice(`Шаблон «${name}» сохранён`);
    });
  }));
  m.addSeparator();
  const open = v.store.tasks().filter((t) => t.due === day && !t.done);
  if (open.length)
    m.addItem((i) => i.setTitle(`Перенести невыполненные (${open.length}) на следующий день`).setIcon("arrow-right").onClick(async () => {
      for (const t of open) await v.store.move(t.id, addDays(day, 1), null);
    }));
  m.showAtMouseEvent(e);
}
