import { MemVault, TFile } from "obsidian";
import { Store, DEFAULT_SETTINGS, weekKey, parseGoals, serializeGoals } from "../src/store";
import { expandEvents } from "../src/ics";
import { parseQuick } from "../src/quickadd";
import { parseBody, serializeBody } from "../src/tasknotes";
import { mergeTasks } from "../src/merge";
import { ExternalIndex } from "../src/external";
import { computeTrends } from "../src/trends";
import { parseDoc as pd, docTasks as dt } from "../src/model";
import { parseHabits, serializeHabits } from "../src/store";
import { today, addDays, startOfWeek, weekday } from "../src/dates";

let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log("FAIL", name, "\n  got ", JSON.stringify(a), "\n  want", JSON.stringify(b)); }
  else console.log("ok  ", name);
};
const T = today();
const Y = addDays(T, -1);

async function fresh(tasks: string) {
  const vault = new MemVault();
  vault.files.set("Planner/Tasks.md", "# Задачи\n\n" + tasks);
  const store = new Store({ vault, metadataCache: { getFileCache: () => null } } as any, { ...DEFAULT_SETTINGS });
  await store.init();
  return { vault, store };
}
const line = (v: MemVault, id: string) => v.files.get("Planner/Tasks.md")!.split("\n").find((l) => l.includes(`🆔 ${id}`)) ?? "";

(async () => {
  // rollover
  {
    const { vault, store } = await fresh(`- [ ] A 📅 ${Y} 🆔 a\n- [ ] B 🔁 every day 📅 ${addDays(T, -3)} 🆔 b\n- [x] C 📅 ${Y} ✅ ${Y} 🆔 c\n`);
    const n = await store.rollover();
    eq("rollover count", n, 2);
    eq("rollover plain → today, moved+1", [store.find("a")!.due, store.find("a")!.moved], [T, 1]);
    eq("rollover recurring → today, no moved", [store.find("b")!.due, store.find("b")!.moved], [T, 0]);
    eq("done untouched", store.find("c")!.due, Y);
    void vault;
  }
  // toggle recurring creates next instance
  {
    const { store } = await fresh(`- [ ] R 🔁 every day 📅 ${T} 🆔 r\n`);
    await store.toggle("r");
    const all = store.tasks();
    eq("recurring: two tasks", all.length, 2);
    eq("recurring: next is tomorrow and open", [all[0].due, all[0].done, !!all[0].recurrence], [addDays(T, 1), false, true]);
    eq("recurring: finished stops recurring", [all[1].done, all[1].recurrence], [true, null]);
  }
  // move counts reschedules
  {
    const { store } = await fresh(`- [ ] M 📅 ${T} 🆔 m\n- [ ] F 📅 ${addDays(T, 2)} 🆔 f\n`);
    await store.move("m", addDays(T, 1), null);
    await store.move("f", addDays(T, 3), null);
    eq("move later from today counts", store.find("m")!.moved, 1);
    eq("move a future task doesn't count", store.find("f")!.moved, 0);
  }
  // bulk + undo
  {
    const { vault, store } = await fresh(`- [ ] A 📅 ${T} 🆔 a\n- [ ] B 📅 ${T} 🆔 b\n- [ ] C 📅 ${T} 🆔 c\n`);
    const before = vault.files.get("Planner/Tasks.md");
    await store.bulk(["a", "b"], "done");
    eq("bulk done", store.tasks().filter((t) => t.done).map((t) => t.id), ["a", "b"]);
    await store.bulk(["c"], "remove");
    eq("bulk remove", store.tasks().length, 2);
    eq("undo label", await store.undo(), "Удалено задач: 1");
    eq("undo restores c", !!store.find("c"), true);
    await store.undo();
    eq("second undo restores file", vault.files.get("Planner/Tasks.md"), before);
    eq("nothing more to undo", await store.undo(), null);
  }
  // backups
  {
    const { vault, store } = await fresh(`- [ ] A 📅 ${T} 🆔 a\n`);
    vault.files.set(`Planner/Backups/${addDays(T, -40)} Tasks.md`, "old");
    eq("backup made", await store.backup(), true);
    eq("backup once a day", await store.backup(), false);
    eq("backup file", vault.files.has(`Planner/Backups/${T} Tasks.md`), true);
    eq("old backup pruned", vault.files.has(`Planner/Backups/${addDays(T, -40)} Tasks.md`), false);
    await store.remove("a");
    await store.restore(T);
    eq("restore brings task back", !!store.find("a"), true);
  }
  // iCloud conflict copies
  {
    const { vault, store } = await fresh(`- [ ] A 📅 ${T} 🆔 a\n`);
    eq("conflict name detected", [store.isConflictCopy("Planner/Tasks 2.md"), store.isConflictCopy("Planner/Tasks.md"), store.isConflictCopy("Other/Tasks 2.md")], [true, false, false]);
    vault.files.set("Planner/Tasks 2.md", `- [x] A 📅 ${T} ✅ ${T} 🆔 a\n- [ ] New on phone 📅 ${T} 🆔 n\n`);
    eq("findConflicts", store.findConflicts().map((f) => f.path), ["Planner/Tasks 2.md"]);
    const summary = await store.mergeConflict(new TFile("Planner/Tasks 2.md"));
    eq("merge summary", summary, "добавлено 1, отмечено выполненными 1");
    eq("merge result", [store.find("a")!.done, !!store.find("n")], [true, true]);
    eq("copy moved to backups", [vault.files.has("Planner/Tasks 2.md"), [...vault.files.keys()].some((k) => k.startsWith("Planner/Backups/") && k.includes("конфликт"))], [false, true]);
  }
  // goals
  {
    const { store } = await fresh("");
    const ws = startOfWeek(T);
    const id = await store.addGoal(ws, "Запустить лендинг");
    eq("goal stored for week", store.goalsFor(ws).map((g) => g.title), ["Запустить лендинг"]);
    await store.updateGoal(id, { done: true });
    eq("goal roundtrip", serializeGoals(parseGoals(serializeGoals(store.goals))), serializeGoals(store.goals));
    eq("week key format", /^\d{4}-W\d{2}$/.test(weekKey(ws)), true);
  }
  // archive
  {
    const old = addDays(T, -40);
    const { vault, store } = await fresh(`- [x] Old 📅 ${old} ✅ ${old} 🆔 o\n- [ ] Keep 📅 ${T} 🆔 k\n`);
    eq("archived count", await store.archiveOld(), 1);
    eq("archive file has task", vault.files.get(`Planner/Archive/${old.slice(0, 7)}.md`)!.includes("🆔 o"), true);
    eq("archive readback", (await store.loadArchive()).map((t) => [t.id, !!t.archivePath]), [["o", true]]);
  }
  // ICS
  {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:1
SUMMARY:Стендап
DTSTART:${startOfWeek(T).replace(/-/g, "")}T100000
DTEND:${startOfWeek(T).replace(/-/g, "")}T101500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
EXDATE:${addDays(startOfWeek(T), 2).replace(/-/g, "")}T100000
END:VEVENT
BEGIN:VEVENT
UID:2
SUMMARY:Отпуск
DTSTART;VALUE=DATE:${addDays(startOfWeek(T), 5).replace(/-/g, "")}
DTEND;VALUE=DATE:${addDays(startOfWeek(T), 6).replace(/-/g, "")}
END:VEVENT
END:VCALENDAR`;
    const ev = expandEvents([ics], startOfWeek(T), addDays(startOfWeek(T), 6));
    eq("weekly rrule with exdate", ev.filter((e) => e.uid === "1").map((e) => [weekday(e.date), e.start, e.minutes]), [[1, "10:00", 15], [5, "10:00", 15]]);
    eq("all-day event", ev.filter((e) => e.uid === "2").map((e) => [weekday(e.date), e.start]), [[6, null]]);
    const utc = expandEvents([`BEGIN:VEVENT\nUID:3\nSUMMARY:U\nDTSTART:20261110T120000Z\nDTEND:20261110T130000Z\nEND:VEVENT`], "2026-11-01", "2026-11-30");
    const local = new Date(Date.UTC(2026, 10, 10, 12, 0));
    eq("UTC converted to local", utc[0].start, `${String(local.getHours()).padStart(2, "0")}:00`);
  }
  // quick add deadlines
  {
    const q1 = parseQuick("Отчёт до пт !!");
    eq("до пт → deadline friday, no due", [q1.task.title, weekday(q1.task.deadline!), q1.due], ["Отчёт", 5, undefined]);
    const q2 = parseQuick("Пойти к врачу");
    eq("«к врачу» stays in title", [q2.task.title, q2.task.deadline ?? null], ["Пойти к врачу", null]);
    const q3 = parseQuick("Сдать налоги до 15.12 завтра");
    eq("deadline + planned day", [q3.task.title, q3.task.deadline?.slice(5), q3.due], ["Сдать налоги", "12-15", addDays(T, 1)]);
  }
  // task body notes
  {
    const body = { description: "Сделать лендинг.\n\n- [ ] пункт ТЗ", links: [{ title: "Figma", url: "https://figma.com/x" }], files: ["Planner/Attachments/t1-brief.pdf"],
      comments: [{ at: "2026-11-03 14:20", text: "согласовал\nвторая строка" }] };
    const text = serializeBody("t1", "Лендинг", body);
    eq("body roundtrip", parseBody(text), body);
    eq("bare link parsed", parseBody("## Ссылки\n- https://a.b/c\n").links, [{ title: "", url: "https://a.b/c" }]);
    const { vault, store } = await fresh(`- [ ] Лендинг 📅 ${T} 🆔 t1\n    старая заметка\n`);
    eq("legacy indented notes read as description", (await store.readBody(store.find("t1")!)).description, "старая заметка");
    const p = await store.attach("t1", "brief.PDF", new ArrayBuffer(4));
    eq("attachment path", p, "Planner/Attachments/t1-brief.pdf");
    eq("second attachment gets suffix", await store.attach("t1", "brief.pdf", new ArrayBuffer(4)), "Planner/Attachments/t1-brief-2.pdf");
    await store.saveBody("t1", "Лендинг", body);
    const t = store.find("t1")!;
    eq("note linked, extra cleared", [t.note, t.extra.length], ["Planner/Tasks/Лендинг.md", 0]);
    eq("note written", parseBody(vault.files.get("Planner/Tasks/Лендинг.md")!).comments.length, 1);
    eq("task line keeps note field", line(vault, "t1").includes("[note:: Planner/Tasks/Лендинг.md]"), true);
    eq("meta for card badges", store.metaFor(t), { links: 1, files: 1, comments: 1, description: true });
    await store.add({ title: "Лендинг" }, T);
    const other = store.tasks().find((x) => x.id !== "t1")!;
    await store.saveBody(other.id, "Лендинг", { description: "x", links: [], files: [], comments: [] });
    eq("same title gets id suffix", store.find(other.id)!.note, `Planner/Tasks/Лендинг ${other.id}.md`);
    const { store: s2 } = await fresh(`- [ ] Пусто 📅 ${T} 🆔 e\n`);
    await s2.saveBody("e", "Пусто", { description: "  ", links: [], files: [], comments: [] });
    eq("empty body creates no note", s2.find("e")!.note, null);
  }
  // three-way merge
  {
    const H = "# Задачи\n\n";
    const base = H + `- [ ] A 📅 ${T} 🆔 a\n- [ ] B 📅 ${T} 🆔 b\n- [ ] C 📅 ${T} 🆔 c\n`;
    const ours = H + `- [x] A 📅 ${T} ✅ ${T} 🆔 a\n- [ ] B 📅 ${T} 🆔 b\n- [ ] Mine 📅 ${T} 🆔 m\n`; // done A, deleted C, added Mine
    const theirs = H + `- [ ] A 📅 ${T} 🆔 a\n- [ ] B renamed 📅 ${T} 🆔 b\n- [ ] C 📅 ${T} 🆔 c\n- [ ] Theirs 📅 ${T} 🆔 t\n`;
    const { text, stats } = mergeTasks(base, ours, theirs);
    const ids = (x: string) => x.split("\n").filter((l) => l.includes("🆔")).map((l) => l.match(/🆔 (\w+)/)![1]).sort();
    eq("merge keeps both sides' tasks, drops our deletion", ids(text), ["a", "b", "m", "t"]);
    eq("merge keeps our done + their rename", [text.includes("- [x] A"), text.includes("B renamed")], [true, true]);
    eq("merge stats", stats, { added: 1, removed: 1, changed: 1 });
    const edited = H + `- [ ] C changed 📅 ${T} 🆔 c\n`;
    eq("edit beats remote delete", mergeTasks(H + `- [ ] C 📅 ${T} 🆔 c\n`, edited, H).text.includes("C changed"), true);
  }
  // the lost-habit-ticks scenario: phone ticks, Mac writes from a stale copy
  {
    const vault = new MemVault();
    const stale = "# Привычки\n\n## Список\n\n- Не курил 🆔 h1\n\n## Журнал\n\n";
    vault.files.set("Planner/Habits.md", stale);
    vault.files.set("Planner/Tasks.md", "# Задачи\n");
    const phone = new Store({ vault, metadataCache: { getFileCache: () => null } } as any, { ...DEFAULT_SETTINGS });
    await phone.init();
    await phone.toggleHabit("h1", Y);
    await phone.toggleHabit("h1", T);
    // Mac (stale copy) adds a habit; iCloud keeps the Mac's file and delivers it to the phone
    const macHabits = parseHabits(stale);
    macHabits.habits.push({ id: "h2", name: "Вода", days: [] });
    vault.files.set("Planner/Habits.md", serializeHabits(macHabits));
    await phone.onFileModified(new TFile("Planner/Habits.md"));
    const h = parseHabits(vault.files.get("Planner/Habits.md")!);
    eq("phone ticks survive the stale overwrite", [h.log.get(Y)?.has("h1"), h.log.get(T)?.has("h1")], [true, true]);
    eq("and the Mac's new habit is kept", h.habits.map((x) => x.id), ["h1", "h2"]);
  }
  // store-level task merge + accept when we have no local changes
  {
    const { vault, store } = await fresh(`- [ ] A 📅 ${T} 🆔 a\n`);
    vault.files.set("Planner/Tasks.md", "# Задачи\n\n" + `- [ ] A edited 📅 ${T} 🆔 a\n`);
    await store.onFileModified(new TFile("Planner/Tasks.md"));
    eq("no local edits: accept theirs", store.find("a")!.title, "A edited");
    await store.add({ title: "Local" }, T);
    vault.files.set("Planner/Tasks.md", "# Задачи\n\n" + `- [x] A edited 📅 ${T} ✅ ${T} 🆔 a\n`);
    await store.onFileModified(new TFile("Planner/Tasks.md"));
    eq("local add survives remote write", [store.tasks().some((t) => t.title === "Local"), store.find("a")!.done], [true, true]);
    eq("merged result written back", vault.files.get("Planner/Tasks.md")!.includes("Local"), true);
  }
  // change log + restore
  {
    const { vault, store } = await fresh(`- [ ] Молоко #дом 📅 ${T} 🆔 milk\n`);
    store.device = "Mac test";
    await store.toggle("milk");
    await store.remove("milk");
    const log = await store.readLog();
    eq("log entries newest first", log.map((e) => e.action), ["Удалена", "Выполнена"]);
    eq("log lives in a per-device file", vault.files.has("Planner/Log/Mac test.md"), true);
    eq("removed task restorable", await store.restoreLines(log[0].lines), 1);
    eq("restored task is back", store.find("milk")?.title, "Молоко");
    eq("restoring twice adds nothing", await store.restoreLines(log[0].lines), 0);
  }
  // unused attachments
  {
    const { vault, store } = await fresh(`- [ ] X 📅 ${T} 🆔 x\n`);
    const used = await store.attach("x", "used.png", new ArrayBuffer(1));
    await store.attach("x", "orphan.png", new ArrayBuffer(1));
    await store.saveBody("x", "X", { description: "", links: [], files: [used], comments: [] });
    eq("only orphan reported", (await store.findUnusedAttachments()).map((f) => f.path), ["Planner/Attachments/x-orphan.png"]);
    void vault;
  }
  // trends
  {
    const W0 = startOfWeek(T), W1 = addDays(W0, -7);
    const tasks = dt(pd([
      `- [x] A #работа [dur:: 1h] [spent:: 1h30m] 📅 ${W1} ✅ ${W1} 🆔 a`,
      `- [x] B #работа [[Сайт]] [dur:: 30m] 📅 ${addDays(W1, 1)} ✅ ${addDays(W1, 1)} 🆔 b`,
      `- [ ] C #дом [moved:: 2] 📅 ${addDays(W1, 2)} 🆔 c`,
      `- [x] D [dur:: 2h] [spent:: 1h] 📅 ${W0} ✅ ${W0} 🆔 d`,
      `- [ ] Old 📅 ${addDays(W0, -70)} 🆔 o`,
    ].join("\n")));
    const tr = computeTrends(tasks, T, 2);
    eq("weeks: planned/done/moved", tr.weeks.map((w) => [w.planned, w.done, w.moved]), [[3, 2, 1], [1, 1, 0]]);
    eq("weeks: minutes use tracked time first", tr.weeks.map((w) => w.minutes), [120, 60]);
    eq("tags by time", tr.tags.map((b) => [b.name, b.minutes, b.weekly]), [["работа", 120, [120, 0]], ["без тега", 60, [0, 60]]]);
    eq("projects", tr.projects.map((b) => [b.name, b.done]), [["Сайт", 1]]);
    eq("estimate accuracy: median of 1.5 and 0.5", [tr.accuracy?.count, tr.accuracy?.ratio, tr.accuracy?.over], [2, 1, 0.5]);
    eq("weekday totals", tr.weekdays.map((d) => d.done), [2, 1, 0, 0, 0, 0, 0]);
  }
  // profiles
  {
    const { vault, store } = await fresh(`- [ ] Отчёт [profile:: work] 📅 ${T} 🆔 w\n- [ ] Молоко 📅 ${T} 🆔 p\n- [ ] Чужой [profile:: gone] 📅 ${T} 🆔 g\n`);
    eq("profile parsed, roundtrip keeps it", [store.find("w")!.profile, line(vault, "w").includes("[profile:: work]")], ["work", true]);
    eq("no profile → default; unknown profile → default", [store.profileOf(store.find("p")!), store.profileOf(store.find("g")!)], ["personal", "personal"]);
    eq("«Всё» shows everything", store.shown().map((t) => t.id), ["w", "p", "g"]);
    store.setProfile("work");
    eq("work shows only work", store.shown().map((t) => t.id), ["w"]);
    const added = await store.add({ title: "Созвон" }, T);
    eq("new task gets the active profile", added.profile, "work");
    store.setProfile("all");
    const added2 = await store.add({ title: "Купить" }, T);
    eq("under «Всё» new task gets the default profile", added2.profile, "personal");
    store.setProfile("personal");
    eq("personal shows default and orphaned tasks", store.shown().map((t) => t.id).sort(), ["g", "p", added2.id].sort());
    await store.bulk(["p", "g"], { profile: "work" });
    store.setProfile("work");
    eq("bulk move to a profile", store.shown().map((t) => t.id).filter((id) => id === "p" || id === "g").sort(), ["g", "p"]);
  }
  {
    const ix = new ExternalIndex({} as any, () => false);
    ix.scanText("Guide.md", "- [ ] Real 📅 2026-11-06\n```\n- [ ] Example 📅 2026-11-06\n```\n~~~~md\n- [ ] Tilde 📅 2026-11-06\n```\n~~~~\n- [ ] After 📅 2026-11-07");
    eq("notes: tasks inside code blocks are ignored", ix.all().map((t) => t.title), ["Real", "After"]);
  }
  process.exit(fail ? 1 : 0);
})();
