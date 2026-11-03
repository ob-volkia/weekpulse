import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { today } from "./dates";
import { HabitsView, VIEW_HABITS } from "./habitsView";
import { TaskModal } from "./modal";
import { DEFAULT_SETTINGS, PlannerSettings, Store } from "./store";
import { VIEW_WEEK, WeekView } from "./weekView";

export default class WeekPlannerPlugin extends Plugin {
  settings!: PlannerSettings;
  store!: Store;
  private lastDay = today();

  async onload() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.store = new Store(this.app, this.settings);

    this.registerView(VIEW_WEEK, (leaf) => new WeekView(leaf, this));
    this.registerView(VIEW_HABITS, (leaf) => new HabitsView(leaf, this));

    this.addRibbonIcon("calendar-days", "Недельный планер", () => this.activateWeek());
    this.addRibbonIcon("flame", "Привычки и статистика", () => this.activateHabits());

    this.addCommand({ id: "open-week", name: "Открыть неделю", callback: () => this.activateWeek() });
    this.addCommand({ id: "open-habits", name: "Открыть привычки и статистику", callback: () => this.activateHabits() });
    this.addCommand({
      id: "add-task", name: "Новая задача", hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
      callback: () => new TaskModal(this.app, this.store, null, today()).open(),
    });
    this.addCommand({
      id: "rollover", name: "Перенести невыполненные задачи на сегодня",
      callback: async () => new Notice(`Перенесено задач: ${await this.store.rollover()}`),
    });
    this.addCommand({
      id: "archive", name: "Архивировать старые выполненные задачи",
      callback: async () => new Notice(`В архив: ${await this.store.archiveOld()}`),
    });

    this.addSettingTab(new PlannerSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      await this.store.init();
      await this.dailyMaintenance();
      this.registerEvent(this.app.vault.on("modify", (f) => f instanceof TFile && this.store.onFileModified(f)));
      // iCloud may deliver the file after startup; pick it up when it appears.
      this.registerEvent(this.app.vault.on("create", (f) => f instanceof TFile && this.store.onFileModified(f)));
      if (this.settings.openOnStartup && !this.app.workspace.getLeavesOfType(VIEW_WEEK).length) this.activateWeek();
    });

    // Day rollover while the app stays open overnight.
    this.registerInterval(window.setInterval(() => {
      if (today() !== this.lastDay) {
        this.lastDay = today();
        this.dailyMaintenance();
        this.store.trigger("changed");
      }
    }, 60_000));
  }

  private async dailyMaintenance() {
    try {
      if (this.settings.autoRollover) {
        const n = await this.store.rollover();
        if (n) new Notice(`↪ Перенесено на сегодня: ${n}`);
      }
      await this.store.archiveOld();
    } catch (e) {
      console.error("Week Planner maintenance failed", e);
    }
  }

  private async activate(type: string) {
    const ws = this.app.workspace;
    let leaf: WorkspaceLeaf | null = ws.getLeavesOfType(type)[0] ?? null;
    if (!leaf) {
      leaf = ws.getLeaf("tab");
      await leaf.setViewState({ type, active: true });
    }
    ws.revealLeaf(leaf);
    return leaf;
  }

  activateWeek() {
    return this.activate(VIEW_WEEK);
  }

  activateHabits() {
    return this.activate(VIEW_HABITS);
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
    const text = (name: string, desc: string, key: "tasksFile" | "habitsFile" | "archiveFolder") =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(s[key]).onChange(async (v) => { s[key] = v.trim() || DEFAULT_SETTINGS[key]; await save(); }));

    text("Файл задач", "Все задачи хранятся в этом файле", "tasksFile");
    text("Файл привычек", "Список привычек и журнал отметок", "habitsFile");
    text("Папка архива", "Сюда уходят старые выполненные задачи", "archiveFolder");
    new Setting(containerEl).setName("Архивировать через, дней").setDesc("Выполненные задачи старше этого срока переезжают в архив")
      .addText((t) => t.setValue(String(s.archiveAfterDays)).onChange(async (v) => { s.archiveAfterDays = Math.max(1, parseInt(v) || 30); await save(); }));
    new Setting(containerEl).setName("Автоперенос невыполненного").setDesc("Невыполненные задачи прошлых дней сами переезжают на сегодня")
      .addToggle((t) => t.setValue(s.autoRollover).onChange(async (v) => { s.autoRollover = v; await save(); }));
    new Setting(containerEl).setName("Ёмкость дня, часов").setDesc("Для полоски загрузки в шапке дня")
      .addSlider((sl) => sl.setLimits(2, 14, 1).setValue(s.dayCapacityHours).setDynamicTooltip().onChange(async (v) => { s.dayCapacityHours = v; await save(); }));
    new Setting(containerEl).setName("Открывать при запуске")
      .addToggle((t) => t.setValue(s.openOnStartup).onChange(async (v) => { s.openOnStartup = v; await save(); }));
  }
}
