// Three-way merge for the planner files.
//
// iCloud keeps one copy of a file: when two devices write it close together, the later write
// wins and the other device's edits vanish. Each device therefore remembers the last version it
// had in common with the others (`base`) and its own latest write (`ours`). When a different
// version arrives from iCloud (`theirs`), we replay our own changes (base → ours) on top of it,
// item by item, instead of accepting or overwriting the whole file.

import { Doc, Task, docTasks, parseDoc, serializeDoc } from "./model";
import type { Goal, HabitsData } from "./store";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Per-field: take our value where only we changed it, theirs otherwise. */
function mergeFields<T extends object>(base: T, ours: T, theirs: T): T {
  const out = { ...theirs };
  for (const k of Object.keys(ours) as (keyof T)[]) {
    if (!same(ours[k], base[k]) && same(theirs[k], base[k])) out[k] = ours[k];
  }
  return out;
}

export interface MergeStats {
  added: number; // our new items carried over
  removed: number; // our deletions carried over
  changed: number; // items where our edits were kept
}

function insertAt(doc: Doc, due: string | null): number {
  let last = -1;
  let lastTask = -1;
  doc.lines.forEach((l, i) => {
    if (l.kind !== "task") return;
    lastTask = i;
    if (l.task.due === due) last = i;
  });
  if (last >= 0) return last + 1;
  return lastTask >= 0 ? lastTask + 1 : doc.lines.length;
}

export function mergeTasks(baseText: string, oursText: string, theirsText: string): { text: string; stats: MergeStats } {
  const base = new Map(docTasks(parseDoc(baseText)).map((t) => [t.id, t]));
  const ours = docTasks(parseDoc(oursText));
  const oursIds = new Set(ours.map((t) => t.id));
  const doc = parseDoc(theirsText);
  const stats: MergeStats = { added: 0, removed: 0, changed: 0 };
  const theirsById = () => new Map(docTasks(doc).map((t) => [t.id, t]));
  let theirs = theirsById();

  for (const o of ours) {
    const b = base.get(o.id);
    const t = theirs.get(o.id);
    if (!b) {
      // New on this device.
      if (!t) {
        doc.lines.splice(insertAt(doc, o.due), 0, { kind: "task", task: o });
        stats.added++;
        theirs = theirsById();
      }
      continue;
    }
    if (!t) {
      // They deleted it; keep it only if we edited it meanwhile (an edit beats a delete).
      if (!same(o, b)) {
        doc.lines.splice(insertAt(doc, o.due), 0, { kind: "task", task: o });
        stats.changed++;
        theirs = theirsById();
      }
      continue;
    }
    if (same(o, b)) continue;
    const merged = mergeFields<Task>(b, o, t);
    // Both sides ticked or unticked differently: "done" wins, it's the more deliberate action.
    if (o.done !== t.done && o.done !== b.done && t.done !== b.done) {
      merged.done = true;
      merged.doneDate = o.doneDate ?? t.doneDate;
    }
    if (!same(merged, t)) {
      Object.assign(t, merged);
      stats.changed++;
    }
  }
  // Our deletions: gone from ours, still unchanged in theirs.
  for (const [id, b] of base) {
    if (oursIds.has(id)) continue;
    const t = theirs.get(id);
    if (t && same(t, b)) {
      doc.lines = doc.lines.filter((l) => !(l.kind === "task" && l.task.id === id));
      stats.removed++;
    }
  }
  return { text: serializeDoc(doc), stats };
}

export function mergeHabits(base: HabitsData, ours: HabitsData, theirs: HabitsData): HabitsData {
  const out: HabitsData = { habits: theirs.habits.map((h) => ({ ...h })), log: new Map([...theirs.log].map(([d, s]) => [d, new Set(s)])) };
  const baseById = new Map(base.habits.map((h) => [h.id, h]));
  const oursIds = new Set(ours.habits.map((h) => h.id));
  for (const o of ours.habits) {
    const b = baseById.get(o.id);
    const i = out.habits.findIndex((h) => h.id === o.id);
    if (!b) { if (i < 0) out.habits.push({ ...o }); continue; }
    if (i < 0) { if (!same(o, b)) out.habits.push({ ...o }); continue; }
    out.habits[i] = mergeFields(b, o, out.habits[i]);
  }
  for (const b of base.habits) {
    const i = out.habits.findIndex((h) => h.id === b.id);
    if (!oursIds.has(b.id) && i >= 0 && same(out.habits[i], b)) out.habits.splice(i, 1);
  }
  // Check-ins: every (day, habit) we ticked or unticked since base is replayed.
  const keys = (h: HabitsData) => new Set([...h.log].flatMap(([d, s]) => [...s].map((id) => `${d}|${id}`)));
  const kb = keys(base);
  const ko = keys(ours);
  const set = (k: string, on: boolean) => {
    const [d, id] = k.split("|");
    const s = out.log.get(d) ?? new Set<string>();
    if (on) s.add(id);
    else s.delete(id);
    if (s.size) out.log.set(d, s);
    else out.log.delete(d);
  };
  for (const k of ko) if (!kb.has(k)) set(k, true);
  for (const k of kb) if (!ko.has(k)) set(k, false);
  return out;
}

export function mergeGoals(base: Map<string, Goal[]>, ours: Map<string, Goal[]>, theirs: Map<string, Goal[]>): Map<string, Goal[]> {
  const out = new Map([...theirs].map(([k, v]) => [k, v.map((g) => ({ ...g }))]));
  const weeks = new Set([...base.keys(), ...ours.keys()]);
  for (const wk of weeks) {
    const b = new Map((base.get(wk) ?? []).map((g) => [g.id, g]));
    const o = ours.get(wk) ?? [];
    const list = out.get(wk) ?? [];
    for (const g of o) {
      const bg = b.get(g.id);
      const i = list.findIndex((x) => x.id === g.id);
      if (!bg) { if (i < 0) list.push({ ...g }); continue; }
      if (i < 0) { if (!same(g, bg)) list.push({ ...g }); continue; }
      list[i] = mergeFields(bg, g, list[i]);
    }
    const oIds = new Set(o.map((g) => g.id));
    for (const bg of b.values()) {
      const i = list.findIndex((x) => x.id === bg.id);
      if (!oIds.has(bg.id) && i >= 0 && same(list[i], bg)) list.splice(i, 1);
    }
    out.set(wk, list);
  }
  return out;
}
