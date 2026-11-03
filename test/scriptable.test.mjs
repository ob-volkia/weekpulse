// Runs the Scriptable script's pure logic in Node with the Scriptable globals mocked out.
import { readFileSync } from "fs";

const src = readFileSync(new URL("../scriptable/Week Planner.js", import.meta.url), "utf8").split("// @run")[0];
const mocks = { FileManager: { iCloud: () => ({}) }, Color: Object.assign(function () {}, { dynamic: () => ({}) }) };
const lib = new Function(...Object.keys(mocks), `${src}; return { planReminders, rowsFor, at };`)(...Object.values(mocks));

let fail = 0;
const eq = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log("FAIL", name, "\n  got ", JSON.stringify(a), "\n  want", JSON.stringify(b)); } else console.log("ok  ", name);
};
const now = new Date(2026, 10, 3, 12, 0);
const data = { days: [
  { date: "2026-11-03", tasks: [
    { id: "a", title: "Утром", time: "09:00", done: false },
    { id: "b", title: "Созвон", time: "15:00", done: false },
    { id: "c", title: "Без времени", time: null, done: false },
    { id: "d", title: "Готово", time: "16:00", done: true },
    { id: "ext:1", title: "Из заметки", time: "17:00", done: false },
  ], events: [] },
  { date: "2026-11-04", tasks: [{ id: "e", title: "Завтра", time: "10:00", done: false }], events: [] },
] };
const R = (id, title, due, extra = {}) => ({ notes: "wp:" + id, title, dueDate: due, isCompleted: false, ...extra });

let p = lib.planReminders(data, [], now);
eq("creates only future, open, timed, own tasks", p.create.map((x) => x.id), ["b", "e"]);

p = lib.planReminders(data, [R("b", "Созвон", lib.at("2026-11-03", "15:00")), R("e", "Старое имя", lib.at("2026-11-04", "10:00"))], now);
eq("unchanged kept, renamed replaced", [p.create.length, p.replace.map((x) => x.task.id), p.remove.length], [0, ["e"], 0]);

p = lib.planReminders(data, [R("b", "Созвон", lib.at("2026-11-03", "14:00"))], now);
eq("time change → replace", p.replace.map((x) => x.task.id), ["b"]);

p = lib.planReminders(data, [R("d", "Готово", lib.at("2026-11-03", "16:00")), R("zz", "Удалена", lib.at("2026-11-05", "10:00")), { notes: "чужое", title: "x" }], now);
eq("done/deleted tasks' reminders removed, foreign untouched", p.remove.map((r) => r.notes), ["wp:d", "wp:zz"]);

p = lib.planReminders(data, [R("b", "Созвон", lib.at("2026-11-03", "15:00"), { isCompleted: true })], now);
eq("ticked reminder reported back and cleared", [p.completed, p.remove.length], [[{ op: "done", id: "b" }], 1]);

const rows = lib.rowsFor({ tasks: [{ title: "Позже", time: null }, { title: "Готово", time: "08:00", done: true }, { title: "Рано", time: "09:00" }], events: [{ title: "Встреча", start: "08:30" }] });
eq("widget order: timed, untimed, done", rows.map((r) => r.title), ["Встреча", "Рано", "Позже", "Готово"]);

process.exit(fail ? 1 : 0);
