// Read-only calendar events from ICS links (Apple/Google "secret address" feeds).
// Supports the common cases: timed and all-day events, UTC and TZID times (treated as the
// device's local time), RRULE with DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY,
// EXDATE, and RECURRENCE-ID overrides.

import { DateStr, addDays, addMonths, fmt, weekday } from "./dates";

export interface CalEvent {
  uid: string;
  title: string;
  date: DateStr; // local day it starts on
  start: string | null; // "HH:MM", null for all-day
  minutes: number; // duration; all-day = 0
  calendar: number; // index of the source feed
}

interface RawEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  rrule: Record<string, string> | null;
  exdates: Set<string>;
  recurrenceId: string | null;
  cancelled: boolean;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescape(v: string) {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

/** Parse "20261103T100000Z", "20261103T100000" (local) or "20261103" (all-day). */
export function parseIcsDate(value: string): { date: Date; allDay: boolean } {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return { date: new Date(NaN), allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: new Date(+y, +mo - 1, +d), allDay: true };
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))) : new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  return { date, allDay: false };
}

const key = (d: Date, allDay: boolean) => (allDay ? fmt(d) : `${fmt(d)}T${d.getHours()}:${d.getMinutes()}`);

export function parseIcs(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  let cur: Partial<RawEvent> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: new Set(), rrule: null, recurrenceId: null, cancelled: false, end: null, summary: "" };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.start && !isNaN(cur.start.getTime())) events.push(cur as RawEvent);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const [name, ...params] = line.slice(0, idx).split(";");
    const value = line.slice(idx + 1);
    switch (name) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.summary = unescape(value); break;
      case "STATUS": cur.cancelled = value === "CANCELLED"; break;
      case "DTSTART": {
        const p = parseIcsDate(value);
        cur.start = p.date;
        cur.allDay = p.allDay || params.includes("VALUE=DATE");
        break;
      }
      case "DTEND": cur.end = parseIcsDate(value).date; break;
      case "DURATION": {
        const m = value.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
        if (m && cur.start) cur.end = new Date(cur.start.getTime() + ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60000);
        break;
      }
      case "RRULE":
        cur.rrule = Object.fromEntries(value.split(";").map((kv) => kv.split("=") as [string, string]));
        break;
      case "EXDATE":
        for (const v of value.split(",")) {
          const p = parseIcsDate(v);
          cur.exdates!.add(key(p.date, p.allDay || params.includes("VALUE=DATE")));
        }
        break;
      case "RECURRENCE-ID": {
        const p = parseIcsDate(value);
        cur.recurrenceId = key(p.date, p.allDay || params.includes("VALUE=DATE"));
        break;
      }
    }
  }
  return events;
}

const BYDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/** Occurrence start times of an event between from..to (inclusive days). */
function occurrences(ev: RawEvent, from: DateStr, to: DateStr): Date[] {
  const start = ev.start;
  if (!ev.rrule) return [start];
  const r = ev.rrule;
  const interval = parseInt(r.INTERVAL ?? "1");
  const count = r.COUNT ? parseInt(r.COUNT) : Infinity;
  const until = r.UNTIL ? fmt(parseIcsDate(r.UNTIL).date) : "9999-12-31";
  const byday = r.BYDAY ? r.BYDAY.split(",").map((d) => BYDAY[d.slice(-2)]).filter(Boolean) : null;
  const out: Date[] = [];
  const at = (day: DateStr) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d, start.getHours(), start.getMinutes());
  };
  const startDay = fmt(start);
  let n = 0;
  const push = (day: DateStr) => {
    if (day < startDay || day > until || n >= count) return false;
    n++;
    if (day >= from && day <= to) out.push(at(day));
    return true;
  };
  const limit = to < until ? to : until;
  if (r.FREQ === "DAILY") {
    for (let d = startDay; d <= limit && n < count; d = addDays(d, interval)) push(d);
  } else if (r.FREQ === "WEEKLY") {
    const days = byday ?? [weekday(startDay)];
    for (let w = addDays(startDay, 1 - weekday(startDay)); w <= limit && n < count; w = addDays(w, 7 * interval))
      for (const wd of [...days].sort()) push(addDays(w, wd - 1));
  } else if (r.FREQ === "MONTHLY") {
    for (let d = startDay; d <= limit && n < count; d = addMonths(d, interval)) push(d);
  } else if (r.FREQ === "YEARLY") {
    for (let d = startDay; d <= limit && n < count; d = addMonths(d, 12 * interval)) push(d);
  } else return [start];
  return out;
}

/** Expand feeds into per-day events for the range. */
export function expandEvents(feeds: string[], from: DateStr, to: DateStr): CalEvent[] {
  const out: CalEvent[] = [];
  feeds.forEach((text, calendar) => {
    const raw = parseIcs(text);
    const overrides = new Set(raw.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${e.recurrenceId}`));
    for (const ev of raw) {
      if (ev.cancelled && !ev.recurrenceId) continue;
      const minutes = ev.allDay ? 0 : ev.end ? Math.max(0, Math.round((ev.end.getTime() - ev.start.getTime()) / 60000)) : 60;
      for (const occ of occurrences(ev, from, to)) {
        const k = key(occ, ev.allDay);
        if (!ev.recurrenceId && (ev.exdates.has(k) || overrides.has(`${ev.uid}|${k}`))) continue;
        if (ev.cancelled) continue;
        const day = fmt(occ);
        if (day < from || day > to) continue;
        out.push({
          uid: ev.uid, title: ev.summary || "(без названия)", date: day, calendar,
          start: ev.allDay ? null : `${String(occ.getHours()).padStart(2, "0")}:${String(occ.getMinutes()).padStart(2, "0")}`,
          minutes: ev.allDay ? 0 : minutes,
        });
      }
    }
  });
  return out.sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
}
