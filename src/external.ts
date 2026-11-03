// Tasks that live in ordinary notes: any "- [ ] … 📅 YYYY-MM-DD" line outside the planner files.
// We show them in the week and edit them in place, touching only the status and date tokens
// so the note keeps its own formatting.

import { App, Notice, TFile } from "obsidian";
import { DateStr, today } from "./dates";
import { Task, nextOccurrence, parseTaskBody } from "./model";

const LINE_RE = /^(\s*[-*+] )\[([ xX\-])\] (.*)$/;

function hash(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export function externalId(path: string, line: number) {
  return `ext:${hash(path)}:${line}`;
}

export function isExternalId(id: string) {
  return id.startsWith("ext:");
}

export class ExternalIndex {
  private byPath = new Map<string, Task[]>();

  constructor(private app: App, private isExcluded: (path: string) => boolean) {}

  all(): Task[] {
    return [...this.byPath.values()].flat();
  }

  clear() {
    this.byPath.clear();
  }

  async scanAll() {
    this.byPath.clear();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.isExcluded(f.path)) continue;
      const cache = this.app.metadataCache.getFileCache(f);
      if (cache && !cache.listItems?.some((li) => li.task !== undefined)) continue;
      this.scanText(f.path, await this.app.vault.cachedRead(f));
    }
  }

  /** Returns true when the set of tasks for this file changed. */
  scanText(path: string, text: string): boolean {
    if (this.isExcluded(path)) return false;
    const before = JSON.stringify(this.byPath.get(path) ?? []);
    const tasks: Task[] = [];
    text.split(/\r?\n/).forEach((raw, i) => {
      if (!raw.includes("📅")) return;
      const m = raw.match(LINE_RE);
      if (!m) return;
      const t = parseTaskBody(m[2], m[3]);
      if (!t.due) return;
      t.id = externalId(path, i);
      t.source = { path, line: i, raw };
      tasks.push(t);
    });
    if (tasks.length) this.byPath.set(path, tasks);
    else this.byPath.delete(path);
    return before !== JSON.stringify(tasks);
  }

  remove(path: string) {
    return this.byPath.delete(path);
  }

  find(id: string): Task | undefined {
    return this.all().find((t) => t.id === id);
  }

  private async edit(t: Task, fn: (line: string) => string[]) {
    const src = t.source!;
    const file = this.app.vault.getAbstractFileByPath(src.path);
    if (!(file instanceof TFile)) return;
    let ok = true;
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      let i = lines[src.line] === src.raw ? src.line : lines.indexOf(src.raw);
      if (i < 0) {
        ok = false;
        return data;
      }
      lines.splice(i, 1, ...fn(lines[i]));
      return lines.join("\n");
    });
    if (!ok) new Notice("Строка задачи в заметке изменилась — обнови вид и попробуй ещё раз");
  }

  async setDue(t: Task, due: DateStr | null) {
    await this.edit(t, (line) => [setToken(line, "📅", due)]);
  }

  async toggle(t: Task) {
    await this.edit(t, (line) => {
      const m = line.match(LINE_RE)!;
      if (t.done) return [setToken(`${m[1]}[ ] ${m[3]}`, "✅", null)];
      const done = setToken(`${m[1]}[x] ${m[3]}`, "✅", today());
      if (t.recurrence && t.due) {
        const next = nextOccurrence(t.recurrence, t.due);
        if (next) return [setToken(`${m[1]}[ ] ${m[3]}`, "📅", next), done];
      }
      return [done];
    });
  }
}

/** Replace, add or remove an "<emoji> YYYY-MM-DD" token, keeping a trailing ^block-id last. */
function setToken(line: string, emoji: string, date: DateStr | null): string {
  const re = new RegExp(`\\s*${emoji}\\s*\\d{4}-\\d{2}-\\d{2}`, "u");
  if (re.test(line)) return date ? line.replace(re, ` ${emoji} ${date}`) : line.replace(re, "");
  if (!date) return line;
  const block = line.match(/\s\^[\w-]+\s*$/);
  if (block) return line.slice(0, block.index) + ` ${emoji} ${date}` + line.slice(block.index);
  return `${line.trimEnd()} ${emoji} ${date}`;
}
