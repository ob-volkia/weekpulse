// Multi-week trends for the stats screen. Pure functions over tasks (current + archive).

import { DateStr, addDays, startOfWeek, weekday } from "./dates";
import { Task, projectOf } from "./model";

export interface WeekTrend {
  start: DateStr;
  planned: number; // tasks planned for that week
  done: number; // of those, finished
  minutes: number; // time on finished tasks (tracked if any, else estimate)
  moved: number; // tasks that had been rescheduled
}

export interface Bucket {
  name: string;
  minutes: number;
  done: number;
  weekly: number[]; // minutes per week, oldest first
}

export interface Accuracy {
  count: number; // tasks with both an estimate and tracked time
  ratio: number; // median spent / estimate (1 = spot on, 1.3 = 30% longer)
  over: number; // share of tasks that took longer than planned, 0..1
}

export interface Trends {
  weeks: WeekTrend[];
  weekdays: { done: number; avg: number }[]; // Mon..Sun
  tags: Bucket[];
  projects: Bucket[];
  accuracy: Accuracy | null;
}

const minutesOf = (t: Task) => t.spent || t.duration;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeTrends(tasks: Task[], todayStr: DateStr, weeksBack: number): Trends {
  const thisWeek = startOfWeek(todayStr);
  const starts = Array.from({ length: weeksBack }, (_, i) => addDays(thisWeek, -7 * (weeksBack - 1 - i)));
  const first = starts[0];
  const last = addDays(thisWeek, 6);
  const weekIndex = (d: DateStr | null) => {
    if (!d || d < first || d > last) return -1;
    return Math.floor((Date.parse(d) - Date.parse(first)) / (7 * 86400000));
  };

  const weeks: WeekTrend[] = starts.map((start) => ({ start, planned: 0, done: 0, minutes: 0, moved: 0 }));
  const weekdayDone = Array(7).fill(0);
  const tagMap = new Map<string, Bucket>();
  const projMap = new Map<string, Bucket>();
  const ratios: number[] = [];

  const bump = (map: Map<string, Bucket>, name: string, wi: number, t: Task) => {
    const b = map.get(name) ?? { name, minutes: 0, done: 0, weekly: Array(weeksBack).fill(0) };
    const m = minutesOf(t);
    b.minutes += m;
    b.done++;
    b.weekly[wi] += m;
    map.set(name, b);
  };

  for (const t of tasks) {
    const pw = weekIndex(t.due);
    if (pw >= 0) {
      weeks[pw].planned++;
      if (t.done) weeks[pw].done++;
      if (t.moved) weeks[pw].moved++;
    }
    if (!t.done || !t.doneDate) continue;
    const dw = weekIndex(t.doneDate);
    if (dw < 0) continue;
    weeks[dw].minutes += minutesOf(t);
    weekdayDone[weekday(t.doneDate) - 1]++;
    for (const tag of t.tags.length ? t.tags : ["без тега"]) bump(tagMap, tag, dw, t);
    const p = projectOf(t);
    if (p) bump(projMap, p, dw, t);
    if (t.duration && t.spent) ratios.push(t.spent / t.duration);
  }

  // Average per weekday over the weeks that have already reached that weekday.
  const todayWd = weekday(todayStr);
  const weekdays = weekdayDone.map((done, i) => {
    const n = weeksBack - (i + 1 > todayWd ? 1 : 0);
    return { done, avg: n > 0 ? done / n : 0 };
  });

  const sortB = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.minutes - a.minutes || b.done - a.done);
  return {
    weeks,
    weekdays,
    tags: sortB(tagMap),
    projects: sortB(projMap),
    accuracy: ratios.length ? { count: ratios.length, ratio: median(ratios), over: ratios.filter((r) => r > 1.05).length / ratios.length } : null,
  };
}
