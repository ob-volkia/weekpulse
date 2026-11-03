import { App, Modal, Notice, TFile, setIcon } from "obsidian";
import { humanDay, relativeLabel } from "./dates";
import { LogEntry } from "./changelog";
import type WeekPlannerPlugin from "./main";

/** Change log from all devices; removed tasks can be put back. */
export class LogModal extends Modal {
  private onlyRemovals = false;
  private entries: LogEntry[] = [];

  constructor(app: App, private plugin: WeekPlannerPlugin) {
    super(app);
  }

  async onOpen() {
    this.modalEl.addClass("wp-modal", "wp-log-modal");
    this.titleEl.setText("Журнал изменений");
    this.entries = await this.plugin.store.readLog();
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  private render() {
    const c = this.contentEl;
    c.empty();
    const bar = c.createDiv("wp-log-bar");
    for (const [v, label] of [[false, "Все"], [true, "Удалённые"]] as [boolean, string][]) {
      const b = bar.createEl("button", { text: label, cls: `wp-chip-btn ${this.onlyRemovals === v ? "is-active" : ""}` });
      b.onclick = () => { this.onlyRemovals = v; this.render(); };
    }
    const list = this.entries.filter((e) => !this.onlyRemovals || e.lines.length);
    if (!list.length) {
      c.createDiv({ cls: "wp-muted", text: this.onlyRemovals ? "Удалённых задач в журнале нет" : "Журнал пока пуст" });
      return;
    }
    const wrap = c.createDiv("wp-log-list");
    let lastDay = "";
    for (const e of list.slice(0, 400)) {
      const day = e.at.slice(0, 10);
      if (day !== lastDay) {
        wrap.createDiv({ cls: "wp-log-day", text: relativeLabel(day) ?? humanDay(day) });
        lastDay = day;
      }
      const row = wrap.createDiv("wp-log-row");
      row.createSpan({ cls: "wp-log-time", text: e.at.slice(11) });
      const body = row.createDiv("wp-log-body");
      body.createSpan({ cls: "wp-log-action", text: e.action });
      body.createSpan({ cls: "wp-log-title", text: " " + e.title });
      row.createSpan({ cls: "wp-log-device", text: e.device });
      if (e.lines.length) {
        const b = row.createEl("button", { cls: "wp-chip-btn", text: "Вернуть" });
        b.onclick = async () => {
          const n = await this.plugin.store.restoreLines(e.lines);
          new Notice(n ? `Возвращено задач: ${n}` : "Эти задачи уже на месте");
          if (n) b.remove();
        };
      }
    }
  }
}

/** Attachments no note uses: review and move to the vault trash. */
export class AttachmentsModal extends Modal {
  constructor(app: App, private plugin: WeekPlannerPlugin, private files: TFile[]) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("wp-modal");
    this.titleEl.setText("Неиспользуемые вложения");
    const c = this.contentEl;
    if (!this.files.length) {
      c.createDiv({ cls: "wp-muted", text: "Все файлы во вложениях к чему-то прикреплены" });
      return;
    }
    const size = this.files.reduce((s, f) => s + (f.stat?.size ?? 0), 0);
    c.createDiv({ cls: "wp-muted", text: `${this.files.length} файл(ов), ${fmtSize(size)}. Ни одна задача и заметка на них не ссылается. Удаление — в корзину Obsidian, оттуда можно вернуть.` });
    const list = c.createDiv("wp-restore-list");
    for (const f of this.files) {
      const row = list.createDiv("wp-restore-row");
      const name = row.createSpan({ cls: "wp-link", text: f.name });
      name.onclick = () => this.app.workspace.openLinkText(f.path, "", "tab");
      row.createSpan({ cls: "wp-muted", text: fmtSize(f.stat?.size ?? 0) });
    }
    const footer = c.createDiv("wp-modal-footer");
    footer.createDiv({ cls: "wp-spacer" });
    footer.createEl("button", { text: "Отмена" }).onclick = () => this.close();
    const del = footer.createEl("button", { cls: "mod-warning" });
    setIcon(del.createSpan(), "trash-2");
    del.createSpan({ text: ` В корзину (${this.files.length})` });
    del.onclick = async () => {
      for (const f of this.files) await this.app.vault.trash(f, false);
      this.plugin.store.logAction("Удалены неиспользуемые вложения", `файлов: ${this.files.length}`);
      new Notice(`В корзину: ${this.files.length}`);
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1)} МБ`;
}
