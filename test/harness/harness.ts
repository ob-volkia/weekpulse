import { MemVault } from "obsidian";
import { Store, DEFAULT_SETTINGS } from "../../src/store";
import { WeekView } from "../../src/weekView";
import { HabitsView } from "../../src/habitsView";
import { today, addDays, startOfWeek } from "../../src/dates";

const T = today(); const W = startOfWeek(T); const d = (n: number) => addDays(W, n);
const vault = new MemVault();
vault.files.set("Planner/Tasks.md", `# Задачи

- [x] Разобрать почту #работа [dur:: 30m] 📅 ${d(0)} ✅ ${d(0)} 🆔 a1
- [ ] Созвон с командой #работа [time:: 11:00] [dur:: 1h] ⏫ 🔁 every weekday 📅 ${T} 🆔 a2
- [ ] Написать отчёт за октябрь #работа [dur:: 2h] [moved:: 3] 🔺 📅 ${T} 🆔 a3
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

const app = { vault, workspace: {} };
const settings = { ...DEFAULT_SETTINGS };
const store = new Store(app as any, settings);
(window as any).store = store; (window as any).vault = vault;
const plugin: any = { store, settings, saveSettings() {}, activateHabits: () => show("habits"), activateWeek: () => show("week") };

const container = document.getElementById("app")!;
let view: any;
async function show(kind: string) {
  container.innerHTML = "";
  container.className = "";
  view = kind === "week" ? new WeekView({ container, app } as any, plugin) : new HabitsView({ container, app } as any, plugin);
  // registerEvent is a no-op in the shim; subscribe directly.
  (view as any).registerEvent = () => {};
  store.on("changed", () => view.render());
  await view.onOpen();
}
(async () => {
  await store.init();
  await store.rollover();
  await show(location.hash === "#habits" ? "habits" : "week");
})();
