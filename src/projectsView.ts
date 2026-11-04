import { ItemView, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import { DAY_SHORT, fmtMinutes, humanDay, relativeLabel, today, weekday } from "./dates";
import { Task, displayTitle, projectOf } from "./model";
import { TaskModal } from "./modal";
import { icon } from "./ui";
import type WeekPlannerPlugin from "./main";
import { profileButton } from "./profiles";

export const VIEW_PROJECTS = "week-planner-projects";

interface Project {
  name: string;
  open: Task[];
  done: number;
  total: number;
  spent: number;
  left: number; // planned minutes of open tasks
  overdue: number;
}

/** Projects are [[links]] in task titles: one card per project with progress and open tasks. */
export class ProjectsView extends ItemView {
  private archive: Task[] = [];
  private showFinished = false;

  constructor(leaf: WorkspaceLeaf, private plugin: WeekPlannerPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_PROJECTS; }
  getDisplayText() { return "Проекты"; }
  getIcon() { return "folder-kanban"; }

  async onOpen() {
    this.contentEl.addClass("wp-root", "wp-projects-root");
    this.registerEvent(this.plugin.store.on("changed", () => this.render()));
    this.archive = await this.plugin.store.loadArchive();
    this.render();
  }

  private projects(): Project[] {
    const now = today();
    const map = new Map<string, Project>();
    for (const t of [...this.plugin.store.shown(), ...this.archive.filter((t) => this.plugin.store.inProfile(t))]) {
      const name = projectOf(t);
      if (!name) continue;
      const p = map.get(name) ?? { name, open: [], done: 0, total: 0, spent: 0, left: 0, overdue: 0 };
      p.total++;
      p.spent += t.spent;
      if (t.done) p.done++;
      else {
        p.open.push(t);
        p.left += t.duration;
        if ((t.deadline && t.deadline < now) || (t.due && t.due < now)) p.overdue++;
      }
      map.set(name, p);
    }
    const key = (t: Task) => t.due ?? "9999";
    for (const p of map.values()) p.open.sort((a, b) => key(a).localeCompare(key(b)) || b.priority - a.priority);
    // Active projects first (by nearest open task), finished ones last.
    return [...map.values()].sort((a, b) => {
      if (!a.open.length !== !b.open.length) return a.open.length ? -1 : 1;
      return key(a.open[0] ?? ({} as Task)).localeCompare(key(b.open[0] ?? ({} as Task))) || a.name.localeCompare(b.name);
    });
  }

  render() {
    const root = this.contentEl;
    const top = root.scrollTop;
    root.empty();
    const bar = root.createDiv("wp-toolbar");
    bar.createDiv({ cls: "wp-week-title", text: "Проекты" });
    const right = bar.createDiv("wp-toolbar-right");
    profileButton(this.plugin, right, Platform.isPhone);
    const fin = right.createEl("button", { cls: `wp-chip-btn ${this.showFinished ? "is-active" : ""}`, text: "Завершённые" });
    fin.onclick = () => { this.showFinished = !this.showFinished; this.render(); };
    const back = right.createEl("button", { cls: "wp-icon-btn clickable-icon", attr: { "aria-label": "Неделя" } });
    setIcon(back, "calendar-days");
    back.onclick = () => this.plugin.activateWeek();

    const all = this.projects();
    const list = all.filter((p) => this.showFinished || p.open.length);
    const page = root.createDiv("wp-projects");
    if (!all.length) {
      page.createDiv({ cls: "wp-empty", text: "Проектов пока нет. Добавь в название задачи ссылку [[Название проекта]] — задача попадёт в этот проект." });
      return;
    }
    if (!list.length) page.createDiv({ cls: "wp-empty", text: "Все проекты завершены" });
    for (const p of list) this.renderProject(page, p);
    root.scrollTop = top;
  }

  private renderProject(page: HTMLElement, p: Project) {
    const card = page.createDiv(`wp-project-card ${p.open.length ? "" : "is-finished"}`);
    const head = card.createDiv("wp-project-head");
    const name = head.createDiv({ cls: "wp-project-name", attr: { "aria-label": "Открыть заметку проекта" } });
    icon(name, "folder");
    name.createSpan({ text: p.name });
    name.onclick = () => this.app.workspace.openLinkText(p.name, "", "tab");
    head.createSpan({ cls: "wp-muted", text: `${p.done}/${p.total}` });

    const bar = card.createDiv("wp-bar");
    bar.createDiv({ cls: "wp-bar-fill", attr: { style: `width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%` } });

    const meta: string[] = [];
    if (p.left) meta.push(`осталось ${fmtMinutes(p.left)}`);
    if (p.spent) meta.push(`в фокусе ${fmtMinutes(p.spent)}`);
    if (p.overdue) meta.push(`просрочено ${p.overdue}`);
    if (meta.length) card.createDiv({ cls: `wp-project-meta ${p.overdue ? "has-overdue" : ""}`, text: meta.join(" · ") });

    const tasks = card.createDiv("wp-project-tasks");
    for (const t of p.open.slice(0, 6)) {
      const row = tasks.createDiv({ cls: `wp-project-task prio-${t.priority}` });
      const cb = row.createEl("input", { attr: { type: "checkbox" }, cls: "task-list-item-checkbox" });
      cb.onclick = (e) => { e.stopPropagation(); this.plugin.store.toggle(t.id); };
      row.createSpan({ cls: "wp-project-task-title", text: displayTitle(t).replace(`[[${p.name}]]`, "").replace(p.name, "").trim() || displayTitle(t) });
      row.createSpan({ cls: `wp-muted wp-project-when ${t.due && t.due < today() ? "is-overdue" : ""}`, text: when(t) });
      row.onclick = () => {
        if (t.source) this.plugin.openSource(t);
        else new TaskModal(this.app, this.plugin, t, t.due).open();
      };
    }
    if (p.open.length > 6) tasks.createDiv({ cls: "wp-muted", text: `и ещё ${p.open.length - 6}` });

    const add = card.createEl("button", { cls: "wp-chip-btn wp-project-add" });
    icon(add, "plus");
    add.createSpan({ text: "Задача в проект" });
    add.onclick = () => new TaskModal(this.app, this.plugin, null, today(), { title: `[[${p.name}]] ` }).open();
  }
}

function when(t: Task): string {
  if (!t.due) return "бэклог";
  return relativeLabel(t.due) ?? `${DAY_SHORT[weekday(t.due) - 1]} ${humanDay(t.due)}`;
}
