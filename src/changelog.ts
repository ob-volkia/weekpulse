// Change log: one file per device in Planner/Log/, newest entries first, last 300 kept.
// Separate files per device so two devices never write the same log file.
//
//   - 2026-11-03 16:20 · Удалена · Купить молоко
//       - [ ] Купить молоко #дом 📅 2026-11-03 🆔 abc123     ← the removed lines, for restoring

export interface LogEntry {
  at: string; // "YYYY-MM-DD HH:MM"
  action: string;
  title: string;
  lines: string[]; // task lines removed by this action
  device: string;
}

export const LOG_LIMIT = 300;

const HEAD_RE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · ([^·]+?) · (.*)$/;

export function parseLog(text: string, device: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(HEAD_RE);
    if (m) {
      out.push({ at: m[1], action: m[2].trim(), title: m[3].trim(), lines: [], device });
      continue;
    }
    if (out.length && /^ {4}\S/.test(line)) out[out.length - 1].lines.push(line.slice(4));
  }
  return out;
}

export function serializeLog(device: string, entries: LogEntry[]): string {
  const out = [`# Журнал изменений · ${device}`, ""];
  for (const e of entries.slice(0, LOG_LIMIT)) {
    out.push(`- ${e.at} · ${e.action} · ${e.title.replace(/\n/g, " ")}`);
    for (const l of e.lines) out.push(`    ${l}`);
  }
  return out.join("\n") + "\n";
}
