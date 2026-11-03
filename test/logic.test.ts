import { parseDoc, serializeDoc, docTasks, nextOccurrence, recurrenceLabel } from "../src/model";
import { parseQuick } from "../src/quickadd";
import { today, addDays, weekday } from "../src/dates";
let fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log("FAIL", name, "\n  got ", JSON.stringify(a), "\n  want", JSON.stringify(b)); }
  else console.log("ok  ", name);
};
const src = `# Задачи

- [ ] Созвон с командой #работа [time:: 14:00] [dur:: 1h30m] [moved:: 2] ⏫ 🔁 every weekday ➕ 2026-11-01 📅 2026-11-04 🆔 abc123
    - [x] подготовить повестку
    - [ ] разослать
    заметка
- [x] Купить молоко #дом 📅 2026-11-03 ✅ 2026-11-03 🆔 def456
- [ ] Ручная задача без id
текст`;
const doc = parseDoc(src);
const t = docTasks(doc);
eq("count", t.length, 3);
eq("t0", [t[0].title, t[0].tags, t[0].time, t[0].duration, t[0].moved, t[0].priority, t[0].recurrence, t[0].due, t[0].id, t[0].subtasks.length, t[0].extra], ["Созвон с командой", ["работа"], "14:00", 90, 2, 2, "every weekday", "2026-11-04", "abc123", 2, ["    заметка"]]);
eq("t1 done", [t[1].done, t[1].doneDate, t[1].tags], [true, "2026-11-03", ["дом"]]);
eq("roundtrip", serializeDoc(parseDoc(serializeDoc(doc))), serializeDoc(doc));
eq("raw kept", serializeDoc(doc).split("\n").slice(-1)[0], "текст");
eq("weekday next (Fri->Mon)", nextOccurrence("every weekday", "2026-11-06"), "2026-11-09");
eq("week on", nextOccurrence("every week on Monday, Thursday", "2026-11-03"), "2026-11-05");
eq("month clamp", nextOccurrence("every month", "2026-01-31"), "2026-02-28");
eq("label", recurrenceLabel("every week on Monday, Thursday"), "Пн, Чт");
const T = today();
const q1 = parseQuick("завтра 14:00 1ч #работа !! Созвон с Петей");
eq("q1", [q1.task.title, q1.due, q1.task.time, q1.task.duration, q1.task.tags, q1.task.priority], ["Созвон с Петей", addDays(T,1), "14:00", 60, ["работа"], 2]);
const q2 = parseQuick("Пробежка каждый пн и чт 30м");
eq("q2", [q2.task.title, q2.task.recurrence, q2.task.duration, weekday(q2.due!)], ["Пробежка", "every week on Monday, Thursday", 30, 1]);
const q3 = parseQuick("Отчёт в пятницу 1.5ч !!!");
eq("q3", [q3.task.title, weekday(q3.due!), q3.task.duration, q3.task.priority], ["Отчёт", 5, 90, 3]);
const q4 = parseQuick("Почитать книгу бэклог");
eq("q4", [q4.task.title, q4.due], ["Почитать книгу", null]);
const q5 = parseQuick("Позвонить маме");
eq("q5", [q5.task.title, q5.due], ["Позвонить маме", undefined]);
const q6 = parseQuick("Зарядка по будням 7:30 15м");
eq("q6", [q6.task.title, q6.task.recurrence, q6.task.time, q6.task.duration], ["Зарядка", "every weekday", "07:30", 15]);
const q7 = parseQuick("Врач 15.12 @9");
eq("q7", [q7.task.title, q7.due?.slice(5), q7.task.time], ["Врач", "12-15", "09:00"]);
const q8 = parseQuick("Встреча 1ч30м через 3 дня");
eq("q8", [q8.task.title, q8.task.duration, q8.due], ["Встреча", 90, addDays(T,3)]);
process.exit(fail ? 1 : 0);
