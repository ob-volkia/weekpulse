// Week Planner for Scriptable (iPhone): a "Today" home-screen widget and sync of timed tasks
// into Apple Reminders. Reads Planner/Export/planner.json that the Obsidian plugin keeps current.
//
// Setup (once): Scriptable → Settings → File Bookmarks → + → pick iCloud Drive/Obsidian/Планер,
// name it «Планер». Widget: add a Scriptable widget, Script = Week Planner.
// Reminders: Shortcuts automation → Scriptable «Run Script» Week Planner, parameter «reminders».

const BOOKMARK = "Планер";
const LIST = "Планер";
const TAG = "wp:"; // reminder notes carry the task id: "wp:k3j9x2"

// ---------- data ----------

const fm = FileManager.iCloud();

function vaultPath() {
  if (!fm.bookmarkExists(BOOKMARK)) throw new Error(`Нет закладки «${BOOKMARK}». Scriptable → Настройки → File Bookmarks.`);
  return fm.bookmarkedPath(BOOKMARK);
}

async function readJSON(rel, fallback) {
  const path = fm.joinPath(vaultPath(), rel);
  if (!fm.fileExists(path)) return fallback;
  if (!fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
  try {
    return JSON.parse(fm.readString(path));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(rel, value) {
  fm.writeString(fm.joinPath(vaultPath(), rel), JSON.stringify(value));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function at(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "09:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function dayFor(data, date) {
  return (data.days || []).find((d) => d.date === date) || { date, tasks: [], events: [] };
}

// ---------- reminders ----------

/** Pure planning step (tested): what to create, replace and remove, and which completions to report. */
function planReminders(data, existing, now) {
  const want = new Map();
  for (const day of data.days || []) {
    for (const t of day.tasks) {
      if (t.done || !t.time || !t.id || t.id.startsWith("ext:")) continue;
      const due = at(day.date, t.time);
      if (due < now) continue;
      want.set(t.id, { id: t.id, title: t.title, due });
    }
  }
  const create = [];
  const replace = [];
  const remove = [];
  const completed = [];
  const seen = new Set();
  for (const r of existing) {
    const id = (r.notes || "").startsWith(TAG) ? r.notes.slice(TAG.length).trim() : null;
    if (!id) continue;
    if (r.isCompleted) {
      completed.push({ op: "done", id });
      remove.push(r);
      continue;
    }
    const w = want.get(id);
    if (!w || seen.has(id)) { remove.push(r); continue; }
    seen.add(id);
    if (r.title !== w.title || !r.dueDate || Math.abs(r.dueDate.getTime() - w.due.getTime()) > 30000) replace.push({ old: r, task: w });
  }
  for (const w of want.values()) if (!seen.has(w.id)) create.push(w);
  return { create, replace, remove, completed };
}

async function reminderList() {
  try {
    return await Calendar.forRemindersByTitle(LIST);
  } catch (e) {
    return await Calendar.createForReminders(LIST);
  }
}

async function syncReminders() {
  const data = await readJSON("Planner/Export/planner.json", null);
  if (!data) throw new Error("Не найден Planner/Export/planner.json — открой Obsidian на любом устройстве");
  const cal = await reminderList();
  const existing = await Reminder.all([cal]);
  const plan = planReminders(data, existing, new Date());
  const lead = (data.reminderMinutes ?? 10) * 60000;
  const make = (w) => {
    const r = new Reminder();
    r.calendar = cal;
    r.title = w.title;
    r.notes = TAG + w.id;
    r.dueDate = w.due;
    r.dueDateIncludesTime = true;
    r.addAlarm(Alarm.absolute(new Date(w.due.getTime() - lead)));
    r.save();
  };
  for (const r of plan.remove) r.remove();
  for (const x of plan.replace) { x.old.remove(); make(x.task); }
  for (const w of plan.create) make(w);
  if (plan.completed.length) {
    const inbox = await readJSON("Planner/Export/inbox.json", []);
    writeJSON("Planner/Export/inbox.json", [...(Array.isArray(inbox) ? inbox : []), ...plan.completed]);
  }
  return plan;
}

// ---------- widget ----------

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  text: Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f7")),
  muted: Color.dynamic(new Color("#8e8e93"), new Color("#8e8e93")),
  accent: new Color("#7f6df2"),
  prio: { 3: new Color("#fb464c"), 2: new Color("#e9973f"), 1: new Color("#e0de71") },
  event: new Color("#027aff"),
};

function rowsFor(day) {
  const rows = [];
  for (const e of day.events || []) rows.push({ kind: "event", time: e.start, title: e.title });
  for (const t of day.tasks) rows.push({ kind: "task", time: t.time, title: t.title, done: t.done, priority: t.priority });
  const key = (r) => (r.kind === "task" && r.done ? "2" : r.time ? "0" + r.time : "1");
  return rows.sort((a, b) => key(a).localeCompare(key(b)));
}

function buildWidget(data, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(12, 14, 12, 14);
  w.url = "obsidian://planner";
  w.refreshAfterDate = new Date(Date.now() + 15 * 60000);
  const date = localDate();
  const day = dayFor(data, date);
  const tasks = day.tasks;
  const done = tasks.filter((t) => t.done).length;

  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText(family === "small" ? "Сегодня" : `Сегодня, ${new Date().getDate()} ${MONTHS[new Date().getMonth()]}`);
  title.font = Font.boldSystemFont(family === "small" ? 14 : 15);
  title.textColor = C.text;
  head.addSpacer();
  const count = head.addText(tasks.length ? `${done}/${tasks.length}` : "");
  count.font = Font.mediumSystemFont(12);
  count.textColor = C.muted;
  w.addSpacer(8);

  const limit = family === "large" ? 12 : family === "small" ? 4 : 5;
  const rows = rowsFor(day);
  if (!rows.length) {
    const empty = w.addText("Задач нет");
    empty.font = Font.systemFont(13);
    empty.textColor = C.muted;
  }
  for (const r of rows.slice(0, limit)) {
    const s = w.addStack();
    s.centerAlignContent();
    s.spacing = 6;
    const bar = s.addStack();
    bar.size = new Size(3, 14);
    bar.cornerRadius = 1.5;
    bar.backgroundColor = r.kind === "event" ? C.event : C.prio[r.priority] || new Color("#000000", 0);
    if (r.kind === "task") {
      const sym = SFSymbol.named(r.done ? "checkmark.circle.fill" : "circle");
      const img = s.addImage(sym.image);
      img.imageSize = new Size(12, 12);
      img.tintColor = r.done ? C.muted : C.text;
    } else {
      const img = s.addImage(SFSymbol.named("calendar").image);
      img.imageSize = new Size(12, 12);
      img.tintColor = C.event;
    }
    if (r.time && family !== "small") {
      const tm = s.addText(r.time);
      tm.font = Font.semiboldMonospacedSystemFont(12);
      tm.textColor = r.kind === "event" ? C.event : C.accent;
    }
    const tx = s.addText(r.title);
    tx.font = Font.systemFont(family === "small" ? 12 : 13);
    tx.textColor = r.done ? C.muted : C.text;
    tx.lineLimit = 1;
    w.addSpacer(4);
  }
  if (rows.length > limit) {
    const more = w.addText(`ещё ${rows.length - limit}`);
    more.font = Font.systemFont(11);
    more.textColor = C.muted;
  }
  w.addSpacer();
  return w;
}

function errorWidget(message) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  const t = w.addText(message);
  t.font = Font.systemFont(12);
  t.textColor = C.muted;
  return w;
}

// ---------- entry ----------

async function main() {
  const param = (args.shortcutParameter || args.queryParameters?.mode || "").toString().toLowerCase();
  if (config.runsInWidget) {
    try {
      Script.setWidget(buildWidget(await readJSON("Planner/Export/planner.json", { days: [] }), config.widgetFamily));
    } catch (e) {
      Script.setWidget(errorWidget(String(e.message || e)));
    }
    return;
  }
  if (param === "reminders") {
    const plan = await syncReminders();
    Script.setShortcutOutput(`Напоминания: +${plan.create.length}, обновлено ${plan.replace.length}, убрано ${plan.remove.length}`);
    return;
  }
  const a = new Alert();
  a.title = "Week Planner";
  a.addAction("Синхронизировать напоминания");
  a.addAction("Показать виджет");
  a.addCancelAction("Закрыть");
  const choice = await a.presentSheet();
  if (choice === 0) {
    const plan = await syncReminders();
    const done = new Alert();
    done.title = "Готово";
    done.message = `Создано ${plan.create.length}, обновлено ${plan.replace.length}, убрано ${plan.remove.length}, выполнено ${plan.completed.length}`;
    done.addAction("OK");
    await done.present();
  } else if (choice === 1) {
    await buildWidget(await readJSON("Planner/Export/planner.json", { days: [] }), "medium").presentMedium();
  }
}

// @run — tests cut the file here
await main();
Script.complete();
