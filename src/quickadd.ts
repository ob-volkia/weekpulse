// Natural-language quick add: "завтра 14:00 1ч #работа !! каждый пн Созвон"

import { DateStr, addDays, today, weekday } from "./dates";
import { Priority, Task, weekOnRule } from "./model";

const DAY_WORDS: [RegExp, number][] = [
  [/^(пн|понедельник|monday)$/, 1],
  [/^(вт|вторник|tuesday)$/, 2],
  [/^(ср|среда|среду|wednesday)$/, 3],
  [/^(чт|четверг|thursday)$/, 4],
  [/^(пт|пятница|пятницу|friday)$/, 5],
  [/^(сб|суббота|субботу|saturday)$/, 6],
  [/^(вс|воскресенье|sunday)$/, 7],
];

function dayOf(word: string): number {
  for (const [re, n] of DAY_WORDS) if (re.test(word)) return n;
  return 0;
}

function nextWeekday(from: DateStr, wd: number): DateStr {
  let d = from;
  for (let i = 0; i < 7; i++) {
    if (weekday(d) === wd) return d;
    d = addDays(d, 1);
  }
  return d;
}

export interface QuickResult {
  task: Partial<Task>;
  /** undefined = keep the context date; null = backlog */
  due: DateStr | null | undefined;
}

export function parseQuick(input: string, base: DateStr = today()): QuickResult {
  const task: Partial<Task> = { tags: [] };
  let due: DateStr | null | undefined;
  let s = " " + input.trim() + " ";
  const eat = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = s.match(re);
    if (m) {
      fn(m);
      s = s.replace(m[0], " ");
    }
  };
  const lower = () => s.toLowerCase();

  // recurrence (before weekdays, so "каждый пн" isn't read as a date)
  const recRules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/\s(каждый день|ежедневно|every day|daily)(?=\s)/i, () => "every day"],
    [/\s(по будням|в будни|каждый будний день|every weekday)(?=\s)/i, () => "every weekday"],
    [/\s(?:каждые|every) (\d+) (?:дн[яей]*|days?)(?=\s)/i, (m) => `every ${m[1]} days`],
    [/\s(?:каждую неделю|еженедельно|every week|weekly)(?=\s)/i, () => "every week"],
    [/\s(?:каждый месяц|ежемесячно|every month|monthly)(?=\s)/i, () => "every month"],
    [/\s(?:каждый год|ежегодно|every year|yearly)(?=\s)/i, () => "every year"],
    [/\s(?:кажд(?:ый|ую|ое)|every) ((?:[а-яa-z]+)(?:\s*(?:,|и)\s*[а-яa-z]+)*)(?=\s)/i, (m) => {
      const days = m[1].split(/\s*(?:,|\sи\s)\s*/).map((w) => dayOf(w.toLowerCase())).filter(Boolean);
      return days.length ? weekOnRule(days) : "";
    }],
  ];
  for (const [re, fn] of recRules) {
    const m = s.match(re);
    if (m) {
      const rule = fn(m);
      if (rule) {
        task.recurrence = rule;
        s = s.replace(m[0], " ");
        if (rule.startsWith("every week on")) {
          const first = dayOf(m[1].split(/\s*(?:,|\sи\s)\s*/)[0].toLowerCase());
          due = nextWeekday(base, first);
        }
        break;
      }
    }
  }

  // time: 14:00, в 9:30, @14
  const setTime = (m: RegExpMatchArray) => {
    if (parseInt(m[1]) < 24 && parseInt(m[2]) < 60) task.time = `${m[1].padStart(2, "0")}:${m[2]}`;
  };
  eat(/\s(?:в\s|@)?(\d{1,2}):(\d{2})(?=\s)/, setTime);
  if (!task.time) eat(/\s(?:в|@)\s?(\d{1,2})\.(\d{2})(?=\s)/, setTime);
  if (!task.time) eat(/\s@(\d{1,2})(?=\s)/, (m) => (task.time = `${m[1].padStart(2, "0")}:00`));

  // duration: 1ч, 30м, 1ч30м, 1.5ч, 90мин, 1h, 45m
  eat(/\s(\d+(?:[.,]\d+)?)\s?(?:ч|час|часа|часов|h)(?:\s?(\d+)\s?(?:м|мин|m))?(?=\s)/i, (m) => {
    task.duration = Math.round(parseFloat(m[1].replace(",", ".")) * 60) + (m[2] ? parseInt(m[2]) : 0);
  });
  if (!task.duration) eat(/\s(\d+)\s?(?:м|мин|минут|m|min)(?=\s)/i, (m) => (task.duration = parseInt(m[1])));

  // priority: !!! / !! / ! / !-
  eat(/\s(!{1,3}|!-)(?=\s)/, (m) => {
    task.priority = (m[1] === "!-" ? -1 : m[1].length) as Priority;
  });

  // tags
  for (const m of [...s.matchAll(/\s#([\p{L}\p{N}_\/-]+)/gu)]) task.tags!.push(m[1]);
  s = s.replace(/\s#[\p{L}\p{N}_\/-]+/gu, " ");

  // deadline: "до пт", "до 15.12", "до завтра"
  {
    const m = s.match(/\s(?:до|к|by)\s+(сегодня|завтра|послезавтра|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|[а-яa-z]+)(?=\s)/i);
    if (m) {
    const w = m[1].toLowerCase();
    let d: DateStr | null = null;
    if (w === "сегодня") d = today();
    else if (w === "завтра") d = addDays(today(), 1);
    else if (w === "послезавтра") d = addDays(today(), 2);
    else if (/^\d/.test(w)) {
      const [dd, mm, yy] = w.split(".");
      let y = yy ? parseInt(yy) : parseInt(today().slice(0, 4));
      if (y < 100) y += 2000;
      d = `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      if (!yy && d < today()) d = `${y + 1}${d.slice(4)}`;
    } else {
      const wd = dayOf(w);
      if (wd) d = nextWeekday(addDays(today(), weekday(today()) === wd ? 7 : 0), wd);
    }
    if (d) {
      task.deadline = d;
      s = s.replace(m[0], " ");
    }
    }
  }

  // dates
  if (due === undefined) {
    const l = lower();
    const rel: [RegExp, () => DateStr | null][] = [
      [/\s(сегодня|today)(?=\s)/, () => today()],
      [/\s(послезавтра)(?=\s)/, () => addDays(today(), 2)],
      [/\s(завтра|tomorrow)(?=\s)/, () => addDays(today(), 1)],
      [/\s(бэклог|когда-нибудь|backlog|someday)(?=\s)/, () => null],
    ];
    for (const [re, fn] of rel) {
      const m = l.match(re);
      if (m) {
        due = fn();
        s = s.slice(0, m.index!) + " " + s.slice(m.index! + m[0].length);
        break;
      }
    }
  }
  if (due === undefined) {
    const m = lower().match(/\sчерез (\d+) (?:дн[яей]*|день)(?=\s)/);
    if (m) {
      due = addDays(today(), parseInt(m[1]));
      s = s.slice(0, m.index!) + " " + s.slice(m.index! + m[0].length);
    }
  }
  if (due === undefined) {
    const m = s.match(/\s(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s)/);
    if (m) {
      const t = today();
      let y = m[3] ? parseInt(m[3]) : parseInt(t.slice(0, 4));
      if (y < 100) y += 2000;
      let d = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      if (!m[3] && d < t) d = `${y + 1}${d.slice(4)}`;
      due = d;
      s = s.replace(m[0], " ");
    }
  }
  if (due === undefined) {
    const m = lower().match(/\s(?:(?:в|во|on)\s)?([а-яa-z]+)(?=\s)/g);
    for (const tok of m ?? []) {
      const word = tok.trim().split(/\s+/).pop()!;
      const wd = dayOf(word);
      if (wd) {
        const from = addDays(today(), weekday(today()) === wd ? 7 : 0);
        due = nextWeekday(from, wd);
        const idx = lower().indexOf(tok);
        s = s.slice(0, idx) + " " + s.slice(idx + tok.length);
        break;
      }
    }
  }

  task.title = s.replace(/\s+/g, " ").trim();
  return { task, due };
}
