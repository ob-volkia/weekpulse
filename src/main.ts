import { App, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { DateStr, addDays, startOfWeek, today, weekday } from "./dates";
import { dailyTemplate, registerDailyBlocks } from "./daily";
import { FocusTimer, FocusView, VIEW_FOCUS, fmtClock } from "./focus";
import { HabitsView, VIEW_HABITS } from "./habitsView";
import { Task, displayTitle } from "./model";
import { TaskModal } from "./modal";
import { PromptModal, TaskPalette } from "./palette";
import { PlanningModal } from "./planning";
import { buildReview, reviewPath } from "./review";
import { DEFAULT_SETTINGS, PlannerSettings, Store } from "./store";
import { VIEW_WEEK, WeekView } from "./weekView";

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
    cmd("rollover", "Перенести невыполненные задачи на сегодня", async () => new Notice(`Перенесено задач: ${await this.store.rollover()}`));
    cmd("archive", "Архивировать старые выполненные задачи", async () => new Notice(`В архив: ${await this.store.archiveOld()}`));

    this.addSettingTab(new PlannerSettingTab(this.app, this));

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
      if (this.settings.openOnStartup && !this.app.workspace.getLeavesOfType(VIEW_WEEK).length) await this.activateWeek();
      this.maybePromptPlanning();
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
  }

  private async dailyMaintenance() {
    try {
      if (this.settings.autoRollover) {
        const n = await this.store.rollover();
        if (n) {
          const stale = this.store.tasks().filter((t) => !t.done && t.moved >= 5).length;
          new Notice(`↪ Перенесено на сегодня: ${n}${stale ? `\n⚠️ ${stale} задач переносятся 5+ раз — загляни в них` : ""}`, 8000);
        }
      }
      await this.store.archiveOld();
    } catch (e) {
      console.error("Week Planner maintenance failed", e);
    }
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
    this.statusEl.setText(`${f.phase === "work" ? "🍅" : "☕"} ${fmtClock(f.left)}${f.running ? "" : " ⏸"}${name ? " · " + (name.length > 28 ? name.slice(0, 27) + "…" : name) : ""}`);
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
    const num = (name: string, desc: string, key: "archiveAfterDays" | "reminderMinutes" | "pomodoroMinutes" | "breakMinutes" | "timelineStart" | "timelineEnd", min: number, max: number) =>
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
    toggle("Задачи из всех заметок", "Показывать в неделе задачи с датой 📅 из любых заметок хранилища", "scanVault");

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
  }
}
