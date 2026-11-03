// Weekly review note: Planner/Reviews/2026-W45.md

import { DateStr, addDays, fmtMinutes, humanDay, isoWeek, today, weekDays, weekLabel } from "./dates";
import { Task, displayTitle, projectOf } from "./model";
import type { Store } from "./store";

export function reviewPath(folder: string, weekStart: DateStr) {
  const year = addDays(weekStart, 3).slice(0, 4);
  return `${folder}/${year}-W${String(isoWeek(weekStart)).padStart(2, "0")}.md`;
}

export function buildReview(store: Store, archive: Task[], weekStart: DateStr): string {
  const days = weekDays(weekStart);
  const inWeek = (d: DateStr | null) => !!d && d >= days[0] && d <= days[6];
  const all = [...store.all(), ...archive];
  const planned = all.filter((t) => inWeek(t.due) || inWeek(t.doneDate));
  const done = planned.filter((t) => t.done && inWeek(t.doneDate));
  const open = store.tasks().filter((t) => !t.done && t.due && t.due <= days[6] && t.moved > 0);
  const pct = planned.length ? Math.round((done.length / planned.length) * 100) : 0;
  const spent = done.reduce((s, t) => s + t.spent, 0) + planned.filter((t) => !t.done).reduce((s, t) => s + t.spent, 0);
  const estimated = done.reduce((s, t) => s + t.duration, 0);

  const groupBy = (list: Task[], key: (t: Task) => string) => {
    const m = new Map<string, Task[]>();
    for (const t of list) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  const out: string[] = [];
  out.push("---", `week: ${addDays(weekStart, 3).slice(0, 4)}-W${String(isoWeek(weekStart)).padStart(2, "0")}`, `start: ${days[0]}`, `end: ${days[6]}`, `completion: ${pct}`, "tags: [review]", "---", "");
  out.push(`# Итоги недели W${isoWeek(weekStart)} · ${weekLabel(weekStart)}`, "");
  out.push("## Цифры", "");
  out.push(`| Показатель | Значение |`, `|---|---|`);
  out.push(`| Выполнено | **${done.length} из ${planned.length}** (${pct}%) |`);
  out.push(`| Время в фокусе | ${fmtMinutes(spent) || "—"} |`);
  out.push(`| Оценка выполненного | ${fmtMinutes(estimated) || "—"} |`);
  out.push(`| Переносилось | ${planned.filter((t) => t.moved > 0).length} задач |`, "");

  out.push("## По дням", "");
  for (const d of days) {
    const list = planned.filter((t) => t.due === d || t.doneDate === d);
    const dn = list.filter((t) => t.done && t.doneDate === d).length;
    out.push(`- ${humanDay(d)}: ${dn}/${list.length}`);
  }
  out.push("");

  out.push("## Сделано", "");
  if (!done.length) out.push("_Ничего не отмечено выполненным._");
  for (const [tag, list] of groupBy(done, (t) => t.tags[0] ?? "без тега")) {
    const time = list.reduce((s, t) => s + (t.spent || t.duration), 0);
    out.push(`### ${tag === "без тега" ? tag : "#" + tag} · ${list.length}${time ? ` · ${fmtMinutes(time)}` : ""}`);
    for (const t of list) out.push(`- ${displayTitle(t)}${t.spent ? ` (⏱ ${fmtMinutes(t.spent)})` : ""}`);
    out.push("");
  }

  const projects = groupBy(planned.filter((t) => projectOf(t)), (t) => projectOf(t)!);
  if (projects.length) {
    out.push("## Проекты", "");
    for (const [p, list] of projects) out.push(`- [[${p}]]: ${list.filter((t) => t.done).length}/${list.length}`);
    out.push("");
  }

  out.push("## Переносилось", "");
  if (!open.length) out.push("_Хвостов нет_");
  for (const t of open.sort((a, b) => b.moved - a.moved)) out.push(`- ${displayTitle(t)} — переносилась ${t.moved} раз(а)`);
  out.push("");

  const habits = store.habits.habits;
  if (habits.length) {
    out.push("## Привычки", "");
    for (const h of habits) {
      const due = days.filter((d) => d <= today() && store.isHabitDue(h, d));
      const dn = due.filter((d) => store.habits.log.get(d)?.has(h.id)).length;
      out.push(`- ${h.name}: ${dn}/${due.length} · серия ${store.streak(h).current}`);
    }
    out.push("");
  }

  out.push("## Рефлексия", "", "**Что получилось?**", "- ", "", "**Что мешало?**", "- ", "", "**Главный фокус на следующую неделю**", "- ", "");
  return out.join("\n");
}
