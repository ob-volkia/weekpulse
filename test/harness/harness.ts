import { MemVault } from "obsidian";
import { Store, DEFAULT_SETTINGS } from "../../src/store";
import { WeekView } from "../../src/weekView";
import { HabitsView } from "../../src/habitsView";
import { today, addDays, startOfWeek } from "../../src/dates";
import { FocusTimer, FocusView } from "../../src/focus";
import { PlanningModal } from "../../src/planning";
import { TaskPalette, PromptModal } from "../../src/palette";
import { buildReview } from "../../src/review";

const T = today(); const W = startOfWeek(T); const d = (n: number) => addDays(W, n);
const vault = new MemVault();
vault.files.set("Planner/Tasks.md", `# Задачи

- [x] Разобрать почту #работа [dur:: 30m] 📅 ${d(0)} ✅ ${d(0)} 🆔 a1
- [ ] Созвон с командой #работа [time:: 11:00] [dur:: 1h] ⏫ 🔁 every weekday 📅 ${T} 🆔 a2
- [ ] Написать отчёт за октябрь #работа [dur:: 2h] [moved:: 6] [spent:: 50m] 🔺 📅 ${T} 🆔 a3
    - [x] собрать цифры
    - [ ] графики
    - [ ] отправить
- [ ] Купить продукты #дом 📅 ${T} 🆔 a4
- [ ] Спортзал #здоровье [time:: 19:00] [dur:: 1h30m] 🔁 every week on Tuesday, Thursday 📅 ${addDays(T,1)} 🆔 a5
- [ ] Записаться к стоматологу #здоровье 🔼 📅 ${addDays(T,2)} 🆔 a6
- [ ] Ревью PR коллег #работа [dur:: 45m] 📅 ${addDays(T,1)} 🆔 a7
- [ ] Прочитать «Deep Work» #учёба 🔽 🆔 a8
- [ ] Идеи для отпуска #дом 🆔 a9
- [x] Оплатить интернет #дом 📅 ${d(1)} ✅ ${d(1)} 🆔 b1
`);
const log: string[] = [];
for (let i = 1; i < 20; i++) if (i % 4) log.push(`- ${addDays(T,-i)}: water${i % 3 ? ", run" : ""}`);
vault.files.set("Planner/Habits.md", `# Привычки\n\n## Список\n\n- 💧 Вода 🆔 water\n- 🏃 Пробежка [days:: 1,3,5] 🆔 run\n- 📖 Чтение 20 минут 🆔 read\n\n## Журнал\n\n${log.join("\n")}\n`);

vault.files.set("Проекты/Сайт.md", `# Сайт\n\n- [ ] Сверстать лендинг [[Сайт]] 📅 ${addDays(T,-2)}\n- [ ] Подключить аналитику 📅 ${addDays(T,2)} ^blk1\n`);
vault.files.set("Planner/Templates.md", `# Шаблоны\n\n## Рабочий понедельник\n- [ ] Планёрка #работа [time:: 10:00] [dur:: 30m] [day:: 1]\n- [ ] Спорт [day:: 3]\n`);
const app = { vault, workspace: { openLinkText() {}, getLeaf() { return { openFile() {}, setEphemeralState() {} }; } }, metadataCache: { getFileCache: () => null } };
const settings = { ...DEFAULT_SETTINGS };
const store = new Store(app as any, settings);
(window as any).store = store; (window as any).vault = vault;
const plugin: any = { store, settings, saveSettings() {}, activateHabits: () => show("habits"), activateWeek: () => show("week"),
  activateFocus: (id?: string) => { if (id) plugin.focus.start(id); show("focus"); },
  openPalette: () => new TaskPalette(app as any, plugin).open(),
  openPlanning: (w: string) => new PlanningModal(app as any, plugin, w).open(),
  promptText: (t: string, i: string, cb: any) => new PromptModal(app as any, t, i, cb).open(),
  openDaily: (d: string) => console.log("daily", d), openSource: (t: any) => console.log("source", t.source), openFile: (p: string) => console.log("open", p),
  createReview: async (w: string) => { (window as any).review = buildReview(store, [], w); console.log((window as any).review); },
  notify: (a: string, b: string) => console.log("notify", a, b) };
plugin.focus = new FocusTimer(plugin);

const container = document.getElementById("app")!;
let view: any;
async function show(kind: string) {
  container.innerHTML = "";
  container.className = "";
  const V: any = kind === "week" ? WeekView : kind === "focus" ? FocusView : HabitsView;
  view = new V({ container, app } as any, plugin);
  // registerEvent is a no-op in the shim; subscribe directly.
  (view as any).registerEvent = () => {};
  store.on("changed", () => view.render());
  await view.onOpen();
}
(async () => {
  await store.init();
  await store.rollover();
  await store.scanExternal();
  await show((location.hash.slice(1) || "week"));
})();
