import { App, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath, requestUrl } from "obsidian";
import { DateStr, addDays, startOfWeek, today, weekday } from "./dates";
import { dailyTemplate, registerDailyBlocks } from "./daily";
import { FocusTimer, FocusView, VIEW_FOCUS, fmtClock } from "./focus";
import { HabitsView, VIEW_HABITS } from "./habitsView";
import { injectNavbarButton, removeNavbarButton } from "./navbar";
import { Task, displayTitle } from "./model";
import { TaskModal } from "./modal";
import { PromptModal, TaskPalette } from "./palette";
import { parseQuick } from "./quickadd";
import { PlanningModal } from "./planning";
import { AttachmentsModal, LogModal } from "./maintenance";
import { buildReview, reviewPath } from "./review";
import { DEFAULT_SETTINGS, PlannerSettings, Store } from "./store";
import { VIEW_WEEK, WeekView } from "./weekView";
import { ICON, icon } from "./ui";

export default class WeekPlannerPlugin extends Plugin {
  settings!: PlannerSettings;
  store!: Store;
  focus!: FocusTimer;
  private lastDay = today();
  private reminded = new Set<string>();
  private statusEl: HTMLElement | null = null;

  async onload() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.store = new Store(this.app, this.settings);
    this.store.device = this.deviceName();
    this.focus = new FocusTimer(this);

    this.registerView(VIEW_WEEK, (leaf) => new WeekView(leaf, this));
    this.registerView(VIEW_HABITS, (leaf) => new HabitsView(leaf, this));
    this.registerView(VIEW_FOCUS, (leaf) => new FocusView(leaf, this));
    registerDailyBlocks(this);

    this.addRibbonIcon("calendar-days", "Недельный планер", () => this.activateWeek());
    this.addRibbonIcon("timer", "Фокус", () => this.activateFocus());
    this.addRibbonIcon("flame", "Привычки и статистика", () => this.activateHabits());

    const cmd = (id: string, name: string, callback: () => unknown, hotkeys?: { modifiers: ("Mod" | "Shift" | "Alt")[]; key: string }[]) =>
      this.addCommand({ id, name, callback, hotkeys });
    cmd("open-week", "Открыть неделю", () => this.activateWeek());
    cmd("open-habits", "Открыть привычки и статистику", () => this.activateHabits());
    cmd("open-focus", "Открыть фокус (сегодня + помодоро)", () => this.activateFocus());
    cmd("add-task", "Новая задача", () => new TaskModal(this.app, this, null, today()).open(), [{ modifiers: ["Mod", "Shift"], key: "a" }]);
    cmd("find-task", "Найти задачу", () => this.openPalette(), [{ modifiers: ["Mod", "Shift"], key: "k" }]);
    cmd("plan-week", "Спланировать неделю", () => this.openPlanning(this.planningWeek()));
    cmd("review-week", "Итоги текущей недели", () => this.createReview(startOfWeek(today())));
    cmd("review-last-week", "Итоги прошлой недели", () => this.createReview(addDays(startOfWeek(today()), -7)));
    cmd("open-daily", "Заметка дня (сегодня)", () => this.openDaily(today()));
    cmd("pomodoro-toggle", "Помодоро: старт/пауза", () => this.focus.toggle());
    cmd("undo", "Отменить последнее действие", async () => {
      const label = await this.store.undo();
      new Notice(label ? `Отменено: ${label.toLowerCase()}` : "Нечего отменять");
    });
    cmd("backup-now", "Сделать резервную копию сейчас", async () => {
      await this.store.backup(true);
      new Notice("Резервная копия сохранена");
    });
    cmd("restore-backup", "Восстановить из резервной копии…", () => this.openRestore());
    cmd("merge-conflicts", "Слить копии iCloud (конфликты)", () => this.checkConflicts(true));
    cmd("change-log", "Журнал изменений", () => this.openLog());
    cmd("unused-attachments", "Найти неиспользуемые вложения", () => this.openUnusedAttachments());
    cmd("refresh-calendars", "Обновить календари", () => this.refreshCalendars(true));
    cmd("rollover", "Перенести невыполненные задачи на сегодня", async () => new Notice(`Перенесено задач: ${await this.store.rollover()}`));
    cmd("archive", "Архивировать старые выполненные задачи", async () => new Notice(`В архив: ${await this.store.archiveOld()}`));

    this.addSettingTab(new PlannerSettingTab(this.app, this));

    // obsidian://planner-add?text=завтра 10:00 созвон  — used by Siri / Shortcuts / Share sheet.
    this.registerObsidianProtocolHandler("planner-add", async (params) => {
      const text = (params.text ?? params.title ?? "").trim();
      if (!text) return;
      const q = parseQuick(text, today());
      if (!q.task.title) return;
      if (params.url) q.task.title += ` ${params.url}`;
      const due = q.due !== undefined ? q.due : params.backlog ? null : today();
      await this.store.add(q.task, due);
      new Notice(`Задача добавлена: ${q.task.title}${due ? "" : " (бэклог)"}`);
    });
    this.registerObsidianProtocolHandler("planner", () => this.activateWeek());

    this.registerEvent(this.store.on("undoable", (label) => this.offerUndo(String(label))));
    this.registerEvent(this.store.on("conflict", () => this.checkConflicts(false)));
    this.registerEvent(this.store.on("merged", (msg) => new Notice(String(msg), 6000)));

    if (!Platform.isMobile) {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass("wp-status", "mod-clickable");
      this.statusEl.onclick = () => this.activateFocus();
      this.registerEvent(this.focus.on("tick", () => this.updateStatus()));
      this.updateStatus();
    }

    this.app.workspace.onLayoutReady(async () => {
      await this.store.init();
      await this.dailyMaintenance();
      this.registerEvent(this.app.vault.on("modify", (f) => f instanceof TFile && this.store.onFileModified(f)));
      // iCloud may deliver the file after startup; pick it up when it appears.
      this.registerEvent(this.app.vault.on("create", (f) => f instanceof TFile && this.store.onFileModified(f)));
      this.registerEvent(this.app.metadataCache.on("changed", (f, data) => this.store.onNoteChanged(f.path, data)));
      this.registerEvent(this.app.vault.on("delete", (f) => this.store.onNoteDeleted(f.path)));
      this.registerEvent(this.app.vault.on("rename", (f, old) => {
        this.store.onNoteDeleted(old);
        if (f instanceof TFile && f.extension === "md") this.app.vault.cachedRead(f).then((d) => this.store.onNoteChanged(f.path, d));
      }));
      await this.store.scanExternal();
      this.checkConflicts(false);
      this.refreshCalendars(false);
      this.registerInterval(window.setInterval(() => this.refreshCalendars(false), 30 * 60_000));
      if (this.settings.openOnStartup && !this.app.workspace.getLeavesOfType(VIEW_WEEK).length) await this.activateWeek();
      this.maybePromptPlanning();
      this.setupNavbarButton();
    });

    this.registerInterval(window.setInterval(() => {
      if (today() !== this.lastDay) {
        this.lastDay = today();
        this.reminded.clear();
        this.dailyMaintenance();
        this.store.trigger("changed");
      }
      this.checkReminders();
    }, 30_000));
  }

  onunload() {
    this.focus?.destroy();
    removeNavbarButton();
  }

  // ---------- phone bottom bar ----------

  private navbarWatching = false;

  setupNavbarButton() {
    if (!Platform.isPhone) return;
    if (!this.settings.navbarButton) {
      removeNavbarButton();
      this.store.trigger("changed");
      return;
    }
    const inject = () => {
      if (!this.settings.navbarButton) return;
      const had = !!document.querySelector(".wp-navbar-add");
      const ok = injectNavbarButton(() => new TaskModal(this.app, this, null, today()).open());
      // Views decide whether to show their own floating "+"; let them re-check.
      if (ok && !had) this.store.trigger("changed");
    };
    inject();
    if (this.navbarWatching) return;
    this.navbarWatching = true;
    // Obsidian may rebuild the bar (rotation, layout changes); put the button back.
    this.registerEvent(this.app.workspace.on("layout-change", inject));
    this.registerInterval(window.setInterval(inject, 3000));
  }

  private async dailyMaintenance() {
    try {
      if (this.settings.autoRollover) {
        const n = await this.store.rollover();
        if (n) {
          const stale = this.store.tasks().filter((t) => !t.done && t.moved >= 5).length;
          new Notice(`Перенесено на сегодня: ${n}${stale ? `\n${stale} задач переносятся 5+ раз — загляни в них` : ""}`, 8000);
        }
      }
      await this.store.archiveOld();
      await this.store.backup();
    } catch (e) {
      console.error("Week Planner maintenance failed", e);
    }
  }

  /** "Mac", "iPhone"… plus a short id kept per device, so each device has its own log file. */
  private deviceName(): string {
    const kind = Platform.isPhone ? "iPhone" : Platform.isTablet ? "iPad" : Platform.isMacOS ? "Mac" : "ПК";
    let id = this.app.loadLocalStorage("wp-device-id") as string | null;
    if (!id) {
      id = Math.random().toString(36).slice(2, 6);
      this.app.saveLocalStorage("wp-device-id", id);
    }
    return `${kind} ${id}`;
  }

  openLog() {
    new LogModal(this.app, this).open();
  }

  async openUnusedAttachments() {
    new AttachmentsModal(this.app, this, await this.store.findUnusedAttachments()).open();
  }

  // ---------- undo toast ----------

  private offerUndo(label: string) {
    // Always for destructive/bulk actions; on the phone also for single moves and checks,
    // where a stray swipe is easy.
    const always = /удален|Удалено|задач:|Слияние/.test(label);
    if (!always && !Platform.isPhone) return;
    const frag = document.createDocumentFragment();
    frag.createSpan({ text: label + "  " });
    const btn = frag.createEl("button", { text: "Отменить", cls: "wp-notice-btn" });
    const notice = new Notice(frag, 5000);
    btn.onclick = async () => {
      notice.hide();
      await this.store.undo();
    };
  }

  // ---------- iCloud conflicts ----------

  private async checkConflicts(manual: boolean) {
    const copies = this.store.findConflicts();
    if (!copies.length) {
      if (manual) new Notice("Конфликтных копий нет");
      return;
    }
    const frag = document.createDocumentFragment();
    frag.createDiv({ text: `iCloud создал копию: ${copies.map((f) => f.name).join(", ")}. Часть изменений с другого устройства может быть только в ней.` });
    const btn = frag.createEl("button", { text: "Слить в основной файл", cls: "mod-cta wp-notice-btn" });
    const notice = new Notice(frag, 0);
    btn.onclick = async () => {
      notice.hide();
      for (const f of copies) new Notice(`${f.name}: ${await this.store.mergeConflict(f)}`, 6000);
    };
  }

  // ---------- backups ----------

  private async openRestore() {
    const list = await this.store.listBackups();
    if (!list.length) return new Notice("Резервных копий пока нет");
    new RestoreModal(this.app, list, async (stamp) => {
      await this.store.restore(stamp);
      new Notice(`Восстановлено из копии ${stamp}. Текущее состояние тоже сохранено в копиях.`);
    }).open();
  }

  // ---------- calendars ----------

  async refreshCalendars(manual: boolean) {
    const urls = this.settings.calendars.map((u) => u.trim().replace(/^webcal:/i, "https:")).filter(Boolean);
    if (!urls.length) {
      this.store.setFeeds([]);
      if (manual) new Notice("Календари не подключены — добавь ссылку в настройках");
      return;
    }
    const feeds: string[] = [];
    let failed = 0;
    for (const url of urls) {
      try {
        feeds.push((await requestUrl({ url, throw: true })).text);
      } catch (e) {
        console.error("Week Planner: calendar fetch failed", url, e);
        feeds.push("");
        failed++;
      }
    }
    this.store.setFeeds(feeds);
    if (manual || failed) new Notice(failed ? `Не удалось загрузить календарей: ${failed}` : "Календари обновлены");
  }

  async openArchived(t: Task) {
    if (!t.archivePath) return;
    const text = await this.app.vault.cachedRead(this.app.vault.getAbstractFileByPath(t.archivePath) as TFile);
    const line = text.split("\n").findIndex((l) => l.includes(`🆔 ${t.id}`));
    await this.openFile(t.archivePath, line >= 0 ? line : undefined);
  }

  // ---------- reminders ----------

  notify(title: string, body: string) {
    if (!this.settings.notifications) return;
    const N = (window as unknown as { Notification?: typeof Notification }).Notification;
    if (!Platform.isMobile && N && N.permission === "granted") {
      new N(title, { body, silent: false });
    } else {
      if (!Platform.isMobile && N && N.permission === "default") N.requestPermission();
      new Notice(`${title}\n${body}`, 10_000);
    }
  }

  private checkReminders() {
    if (!this.settings.notifications) return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const t of this.store.all()) {
      if (t.done || !t.time || this.store.effectiveDue(t) !== today()) continue;
      const start = parseInt(t.time.slice(0, 2)) * 60 + parseInt(t.time.slice(3, 5));
      const key = `${t.id}|${t.due}|${t.time}`;
      if (this.reminded.has(key)) continue;
      const left = start - nowMin;
      if (left <= this.settings.reminderMinutes && left >= -1) {
        this.reminded.add(key);
        this.notify(left > 0 ? `Через ${left} мин: ${displayTitle(t)}` : `Сейчас: ${displayTitle(t)}`, [t.time, ...t.tags.map((x) => "#" + x)].join(" · "));
      }
    }
  }

  private updateStatus() {
    if (!this.statusEl) return;
    const f = this.focus;
    if (!f.running && f.left === f.total) {
      this.statusEl.setText("");
      this.statusEl.hide();
      return;
    }
    this.statusEl.show();
    const task = f.taskId ? this.store.find(f.taskId) : null;
    const name = task ? displayTitle(task) : "";
    this.statusEl.empty();
    icon(this.statusEl, f.phase === "work" ? ICON.pomodoro : "coffee");
    this.statusEl.createSpan({ text: ` ${fmtClock(f.left)}${f.running ? "" : " · пауза"}${name ? " · " + (name.length > 28 ? name.slice(0, 27) + "…" : name) : ""}` });
  }

  // ---------- planning prompt ----------

  private planningWeek(): DateStr {
    // On Sunday we plan the coming week.
    return weekday(today()) === 7 ? addDays(startOfWeek(today()), 7) : startOfWeek(today());
  }

  private maybePromptPlanning() {
    if (!this.settings.planningPrompt) return;
    const wd = weekday(today());
    const week = this.planningWeek();
    if ((wd !== 1 && wd !== 7) || this.settings.lastPlannedWeek === week) return;
    const frag = document.createDocumentFragment();
    frag.createDiv({ text: wd === 7 ? "Воскресенье — самое время спланировать неделю." : "Новая неделя! Спланируем?" });
    const btn = frag.createEl("button", { text: "Спланировать", cls: "mod-cta wp-notice-btn" });
    btn.onclick = () => this.openPlanning(week);
    new Notice(frag, 15_000);
  }

  // ---------- navigation ----------

  private async activate(type: string): Promise<WorkspaceLeaf> {
    const ws = this.app.workspace;
    let leaf: WorkspaceLeaf | null = ws.getLeavesOfType(type)[0] ?? null;
    if (!leaf) {
      leaf = ws.getLeaf("tab");
      await leaf.setViewState({ type, active: true });
    }
    ws.revealLeaf(leaf);
    return leaf;
  }

  async activateWeek(day?: DateStr) {
    const leaf = await this.activate(VIEW_WEEK);
    if (day && leaf.view instanceof WeekView) leaf.view.showWeekOf(day);
  }

  activateHabits() {
    return this.activate(VIEW_HABITS);
  }

  async activateFocus(taskId?: string) {
    if (taskId) this.focus.start(taskId);
    await this.activate(VIEW_FOCUS);
  }

  openPalette() {
    new TaskPalette(this.app, this).open();
  }

  openPlanning(weekStart: DateStr) {
    new PlanningModal(this.app, this, weekStart).open();
  }

  promptText(title: string, initial: string, cb: (v: string) => void) {
    new PromptModal(this.app, title, initial, cb).open();
  }

  async openFile(path: string, line?: number) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    if (line != null) leaf.setEphemeralState({ line });
  }

  openSource(t: Task) {
    if (t.source) this.openFile(t.source.path, t.source.line);
  }

  private async ensureFile(path: string, content: () => string): Promise<string> {
    path = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(path)) {
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
      await this.app.vault.create(path, content());
    }
    return path;
  }

  async openDaily(day: DateStr) {
    const path = await this.ensureFile(`${this.settings.dailyFolder}/${day}.md`, () => dailyTemplate(day));
    await this.openFile(path);
  }

  async createReview(weekStart: DateStr) {
    const path = reviewPath(this.settings.reviewsFolder, weekStart);
    if (this.app.vault.getAbstractFileByPath(normalizePath(path))) {
      new Notice("Итоги этой недели уже есть — открываю");
    } else {
      const archive = await this.store.loadArchive();
      await this.ensureFile(path, () => buildReview(this.store, archive, weekStart));
    }
    await this.openFile(path);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class PlannerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WeekPlannerPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.store.trigger("changed");
    };
    type TextKey = "tasksFile" | "habitsFile" | "archiveFolder" | "templatesFile" | "reviewsFolder" | "dailyFolder";
    const text = (name: string, desc: string, key: TextKey) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(s[key]).onChange(async (v) => { s[key] = v.trim() || DEFAULT_SETTINGS[key]; await save(); }));
    const num = (name: string, desc: string, key: "archiveAfterDays" | "reminderMinutes" | "pomodoroMinutes" | "breakMinutes" | "timelineStart" | "timelineEnd" | "backupDays", min: number, max: number) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(String(s[key])).onChange(async (v) => {
          const n = parseInt(v);
          if (!isNaN(n)) { s[key] = Math.max(min, Math.min(max, n)); await save(); }
        }));
    const toggle = (name: string, desc: string, key: "autoRollover" | "openOnStartup" | "scanVault" | "notifications" | "planningPrompt") =>
      new Setting(containerEl).setName(name).setDesc(desc).addToggle((t) => t.setValue(s[key]).onChange(async (v) => {
        s[key] = v;
        await save();
        if (key === "scanVault") v ? this.plugin.store.scanExternal() : (this.plugin.store.external.clear(), this.plugin.store.trigger("changed"));
      }));

    new Setting(containerEl).setName("Файлы").setHeading();
    text("Файл задач", "Все задачи хранятся в этом файле", "tasksFile");
    text("Файл привычек", "Список привычек и журнал отметок", "habitsFile");
    text("Файл шаблонов", "Шаблоны дня и недели", "templatesFile");
    text("Папка архива", "Сюда уходят старые выполненные задачи", "archiveFolder");
    text("Папка итогов недели", "Заметки «Итоги недели»", "reviewsFolder");
    text("Папка заметок дня", "Куда создавать заметки дня", "dailyFolder");
    toggle("Задачи из всех заметок", "Показывать в неделе задачи с датой (📅 ГГГГ-ММ-ДД, формат плагина Tasks) из любых заметок хранилища", "scanVault");

    new Setting(containerEl).setName("Планирование").setHeading();
    toggle("Автоперенос невыполненного", "Невыполненные задачи прошлых дней сами переезжают на сегодня", "autoRollover");
    num("Архивировать через, дней", "Выполненные задачи старше этого срока переезжают в архив", "archiveAfterDays", 1, 365);
    new Setting(containerEl).setName("Ёмкость дня, часов").setDesc("Для полоски загрузки и подсветки перегруза")
      .addSlider((sl) => sl.setLimits(2, 14, 1).setValue(s.dayCapacityHours).setDynamicTooltip().onChange(async (v) => { s.dayCapacityHours = v; await save(); }));
    toggle("Напоминать спланировать неделю", "По воскресеньям и понедельникам", "planningPrompt");
    num("Шкала: начало дня, ч", "", "timelineStart", 0, 12);
    num("Шкала: конец дня, ч", "", "timelineEnd", 13, 24);

    new Setting(containerEl).setName("Фокус и напоминания").setHeading();
    toggle("Напоминания", "Уведомление перед задачами со временем и по окончании помодоро", "notifications");
    num("Напоминать за, минут", "", "reminderMinutes", 0, 120);
    num("Помодоро, минут", "", "pomodoroMinutes", 5, 120);
    num("Перерыв, минут", "", "breakMinutes", 1, 60);
    toggle("Открывать неделю при запуске", "", "openOnStartup");

    new Setting(containerEl).setName("Календари").setHeading();
    new Setting(containerEl).setName("Ссылки на календари (ICS)")
      .setDesc("По одной ссылке в строке. События показываются на шкале и в загрузке дня, только для чтения. Как получить ссылку — в заметке «Как пользоваться».")
      .addTextArea((t) => {
        t.setPlaceholder("https://calendar.google.com/calendar/ical/…/basic.ics").setValue(s.calendars.join("\n"));
        t.inputEl.rows = 3;
        t.inputEl.addEventListener("blur", async () => {
          s.calendars = t.getValue().split("\n").map((x) => x.trim()).filter(Boolean);
          await save();
          this.plugin.refreshCalendars(true);
        });
      });

    new Setting(containerEl).setName("Резервные копии").setHeading();
    num("Хранить копии, дней", "Копия задач, привычек и целей делается раз в день в папку Planner/Backups", "backupDays", 3, 365);

    new Setting(containerEl).setName("Обслуживание").setHeading();
    new Setting(containerEl).setName("Журнал изменений").setDesc("Что, когда и с какого устройства менялось; удалённые задачи можно вернуть")
      .addButton((b) => b.setButtonText("Открыть").onClick(() => this.plugin.openLog()));
    new Setting(containerEl).setName("Неиспользуемые вложения").setDesc("Файлы во вложениях, к которым не прикреплена ни одна задача")
      .addButton((b) => b.setButtonText("Найти").onClick(() => this.plugin.openUnusedAttachments()));

    new Setting(containerEl).setName("iPhone").setHeading();
    new Setting(containerEl).setName("Кнопка «+» в нижней панели")
      .setDesc("Добавляет в нижнюю панель Obsidian кнопку новой задачи. Неофициальный способ: после обновления Obsidian кнопка может пропасть — тогда просто выключи.")
      .addToggle((t) => t.setValue(s.navbarButton).onChange(async (v) => {
        s.navbarButton = v;
        await save();
        this.plugin.setupNavbarButton();
      }));
  }
}

class RestoreModal extends Modal {
  constructor(app: App, private stamps: string[], private onPick: (stamp: string) => void) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("wp-modal");
    this.titleEl.setText("Восстановить из резервной копии");
    this.contentEl.createDiv({ cls: "wp-muted", text: "Задачи, привычки и цели вернутся к выбранной копии. Текущее состояние перед этим тоже сохранится в копиях." });
    const list = this.contentEl.createDiv("wp-restore-list");
    for (const st of this.stamps) {
      const row = list.createDiv("wp-restore-row");
      row.createSpan({ text: st.replace(/ (\d{2})-(\d{2})$/, " $1:$2") });
      const b = row.createEl("button", { text: "Восстановить" });
      b.onclick = () => {
        this.close();
        this.onPick(st);
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
