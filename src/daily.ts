// Daily notes and live code blocks:
//   ```planner-day        (optional date on the first line; defaults to the note's date or today)
//   ```planner-habits

import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import { DAY_LONG, DateStr, fmtMinutes, humanDay, today, weekday } from "./dates";
import { Task, compareInDay, displayTitle } from "./model";
import { parseQuick } from "./quickadd";
import type WeekPlannerPlugin from "./main";
import { ICON, icon } from "./ui";

export function dailyTemplate(day: DateStr) {
  const name = DAY_LONG[weekday(day) - 1];
  return `---
date: ${day}
---
# ${name.charAt(0).toUpperCase() + name.slice(1)}, ${humanDay(day)}

## Задачи
\`\`\`planner-day
${day}
\`\`\`

## Привычки
\`\`\`planner-habits
${day}
\`\`\`

## Заметки

`;
}

function blockDate(source: string, ctx: MarkdownPostProcessorContext): DateStr {
  const m = source.match(/\d{4}-\d{2}-\d{2}/) ?? ctx.sourcePath.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : today();
}

class LiveBlock extends MarkdownRenderChild {
  constructor(el: HTMLElement, private plugin: WeekPlannerPlugin, private draw: (el: HTMLElement) => void) {
    super(el);
  }
  onload() {
    this.draw(this.containerEl);
    this.registerEvent(this.plugin.store.on("changed", () => this.draw(this.containerEl)));
  }
}

export function registerDailyBlocks(plugin: WeekPlannerPlugin) {
  plugin.registerMarkdownCodeBlockProcessor("planner-day", (source, el, ctx) => {
    const day = blockDate(source, ctx);
    ctx.addChild(new LiveBlock(el, plugin, (root) => drawDay(plugin, root, day)));
  });
  plugin.registerMarkdownCodeBlockProcessor("planner-habits", (source, el, ctx) => {
    const day = blockDate(source, ctx);
    ctx.addChild(new LiveBlock(el, plugin, (root) => drawHabits(plugin, root, day)));
  });
}

function drawDay(plugin: WeekPlannerPlugin, root: HTMLElement, day: DateStr) {
  const store = plugin.store;
  root.empty();
  root.addClass("wp-block");
  const all = store.shown();
  const order = new Map(all.map((t, i) => [t.id, i]));
  const tasks: Task[] = all.filter((t) => store.effectiveDue(t) === day).sort((a, b) => compareInDay(a, b, order.get(a.id)!, order.get(b.id)!));
  const done = tasks.filter((t) => t.done).length;
  const head = root.createDiv("wp-block-head");
  head.createSpan({ text: `${done}/${tasks.length} выполнено` });
  const minutes = tasks.filter((t) => !t.done).reduce((s, t) => s + t.duration, 0);
  if (minutes) head.createSpan({ cls: "wp-muted", text: ` · осталось ${fmtMinutes(minutes)}` });
  const open = head.createEl("a", { text: "Открыть неделю", cls: "wp-block-link" });
  open.onclick = (e) => { e.preventDefault(); plugin.activateWeek(day); };
  if (!tasks.length) root.createDiv({ cls: "wp-muted", text: "Задач на этот день нет" });
  const ul = root.createEl("ul", { cls: "contains-task-list wp-block-list" });
  for (const t of tasks) {
    const li = ul.createEl("li", { cls: `task-list-item prio-${t.priority}` });
    if (t.done) li.addClass("is-checked");
    const cb = li.createEl("input", { attr: { type: "checkbox" }, cls: "task-list-item-checkbox" });
    cb.checked = t.done;
    cb.onclick = () => store.toggle(t.id);
    li.createSpan({ text: " " });
    if (t.time) li.createSpan({ cls: "wp-time", text: t.time + " " });
    li.createSpan({ cls: "wp-block-title", text: displayTitle(t) });
    if (t.duration) li.createSpan({ cls: "wp-muted", text: ` · ${fmtMinutes(t.duration)}` });
    for (const tag of t.tags) li.createSpan({ cls: "wp-muted", text: ` #${tag}` });
  }
  const input = root.createEl("input", { cls: "wp-block-add", attr: { type: "text", placeholder: "+ задача на этот день (14:00 1ч #тег !!)" } });
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || e.isComposing || !input.value.trim()) return;
    e.preventDefault();
    const q = parseQuick(input.value, day);
    if (!q.task.title) return;
    input.value = "";
    await store.add(q.task, q.due !== undefined ? q.due : day);
  });
}

function drawHabits(plugin: WeekPlannerPlugin, root: HTMLElement, day: DateStr) {
  const store = plugin.store;
  root.empty();
  root.addClass("wp-block");
  const habits = store.habits.habits.filter((h) => store.isHabitDue(h, day));
  if (!habits.length) {
    root.createDiv({ cls: "wp-muted", text: "Привычек на этот день нет" });
    return;
  }
  const row = root.createDiv("wp-block-habits");
  for (const h of habits) {
    const done = store.habits.log.get(day)?.has(h.id) ?? false;
    const b = row.createEl("button", { cls: `wp-chip-btn ${done ? "is-active" : ""}`, text: h.name });
    if (done) b.prepend(icon(b, ICON.done));
    b.disabled = day > today();
    b.onclick = () => store.toggleHabit(h.id, day);
  }
}
