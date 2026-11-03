// All dates are local calendar days encoded as "YYYY-MM-DD" strings.

export type DateStr = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function fmt(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parse(s: DateStr): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): DateStr {
  return fmt(new Date());
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export function addMonths(s: DateStr, n: number): DateStr {
  const d = parse(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return fmt(d);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(s: DateStr): number {
  const w = parse(s).getDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(s: DateStr): DateStr {
  return addDays(s, 1 - weekday(s));
}

export function weekDays(start: DateStr): DateStr[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000);
}

export function isoWeek(s: DateStr): number {
  const d = parse(s);
  d.setDate(d.getDate() + 4 - weekday(s));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const DAY_LONG = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTH_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export function dayNum(s: DateStr): number {
  return parse(s).getDate();
}

/** "3 ноября" */
export function humanDay(s: DateStr): string {
  const d = parse(s);
  return `${d.getDate()} ${MONTH_GEN[d.getMonth()]}`;
}

/** "3–9 ноября 2026" or "28 октября – 3 ноября 2026" */
export function weekLabel(start: DateStr): string {
  const a = parse(start);
  const b = parse(addDays(start, 6));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTH_GEN[b.getMonth()]} ${b.getFullYear()}`;
  return `${a.getDate()} ${MONTH_GEN[a.getMonth()]} – ${b.getDate()} ${MONTH_GEN[b.getMonth()]} ${b.getFullYear()}`;
}

export function relativeLabel(s: DateStr): string | null {
  const d = diffDays(s, today());
  if (d === 0) return "Сегодня";
  if (d === 1) return "Завтра";
  if (d === -1) return "Вчера";
  return null;
}

export function fmtMinutes(min: number): string {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}ч ${m}м`;
  return h ? `${h}ч` : `${m}м`;
}
