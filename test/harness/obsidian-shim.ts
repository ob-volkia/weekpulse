// Minimal browser stand-in for the Obsidian API, enough to render the views.
type Attrs = { cls?: string | string[]; text?: string; attr?: Record<string, string>; value?: string; type?: string };
const P = HTMLElement.prototype as any;
function applyOpts(el: HTMLElement, o?: Attrs | string) {
  if (!o) return el;
  if (typeof o === "string") { el.className = o; return el; }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
  if (o.text != null) el.textContent = o.text;
  if (o.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
  if (o.value != null) (el as any).value = o.value;
  return el;
}
P.createEl = function (tag: string, o?: Attrs | string) { const el = applyOpts(document.createElement(tag), o); this.appendChild(el); return el; };
P.createDiv = function (o?: Attrs | string) { return this.createEl("div", o); };
P.createSpan = function (o?: Attrs | string) { return this.createEl("span", o); };
P.empty = function () { this.innerHTML = ""; };
P.addClass = function (...c: string[]) { this.classList.add(...c.flatMap((x) => x.split(" ").filter(Boolean))); };
P.removeClass = function (...c: string[]) { this.classList.remove(...c); };
P.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v); };
P.hasClass = function (c: string) { return this.classList.contains(c); };
P.setText = function (t: string) { this.textContent = t; };
(window as any).createDiv = (o?: Attrs | string) => applyOpts(document.createElement("div"), o);

export class Events {
  private h = new Map<string, Function[]>();
  on(n: string, f: Function) { this.h.set(n, [...(this.h.get(n) ?? []), f]); return { n, f }; }
  trigger(n: string, ...a: unknown[]) { (this.h.get(n) ?? []).forEach((f) => f(...a)); }
}
export class TFile { constructor(public path: string) {} get extension() { return this.path.split(".").pop(); } }
export class TFolder { children: TFile[] = []; constructor(public path: string) {} }
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
export const Platform = { get isPhone() { return (window as any).__phone === true; }, isMobile: false };

const ICONS: Record<string, string> = { "chevron-left": "‹", "chevron-right": "›", plus: "+", eye: "◉", "eye-off": "◎", flame: "🔥", "file-text": "▤", "calendar-days": "▦", repeat: "↻", "list-checks": "☑", check: "✓", "fold-vertical": "≡", "unfold-vertical": "☰" };
export function setIcon(el: HTMLElement, name: string) { el.textContent = ICONS[name] ?? "•"; }

export class Notice { constructor(msg: string) { const n = document.createElement("div"); n.className = "notice"; n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 2500); } }

export class Menu {
  items: any[] = [];
  addItem(fn: (i: any) => void) { const it: any = { title: "", cb: () => {} }; const api = { setTitle: (t: string) => { it.title = t; return api; }, setIcon: () => api, setChecked: (c: boolean) => { it.checked = c; return api; }, setWarning: () => api, onClick: (f: any) => { it.cb = f; return api; } }; fn(api); this.items.push(it); return this; }
  addSeparator() { this.items.push(null); return this; }
  showAtMouseEvent(e: MouseEvent) {
    document.querySelector(".menu")?.remove();
    const m = document.body.createDiv({ cls: "menu" });
    m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:10000`;
    for (const it of this.items) {
      if (!it) { m.createDiv({ cls: "menu-separator" }); continue; }
      const r = m.createDiv({ cls: "menu-item", text: (it.checked ? "✓ " : "") + it.title });
      r.onclick = () => { m.remove(); it.cb(); };
    }
    setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }), 0);
  }
}

export class Modal {
  modalEl: HTMLElement; titleEl: HTMLElement; contentEl: HTMLElement; private bg: HTMLElement;
  constructor(public app: any) {
    this.bg = createDiv({ cls: "modal-container" }) as HTMLElement;
    this.modalEl = this.bg.createDiv({ cls: "modal" });
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() { document.body.appendChild(this.bg); (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); this.bg.remove(); }
}

export class ItemView {
  contentEl: HTMLElement; app: any;
  constructor(public leaf: any) { this.contentEl = leaf.container; this.app = leaf.app; }
  registerEvent() {}
  registerDomEvent(el: HTMLElement, ev: string, fn: any) { el.addEventListener(ev, fn); }
}
export class Plugin {} export class PluginSettingTab {} export class Setting {}
export type App = any; export type WorkspaceLeaf = any;

// ---------- in-memory vault ----------
export class MemVault extends Events {
  files = new Map<string, string>();
  getAbstractFileByPath(p: string) {
    if (this.files.has(p)) return new TFile(p);
    const kids = [...this.files.keys()].filter((k) => k.startsWith(p + "/"));
    if (kids.length) { const f = new TFolder(p); f.children = kids.map((k) => new TFile(k)); return f; }
    return null;
  }
  async read(f: TFile) { return this.files.get(f.path) ?? ""; }
  async cachedRead(f: TFile) { return this.read(f); }
  async create(p: string, d: string) { this.files.set(p, d); return new TFile(p); }
  async createFolder() {}
  async process(f: TFile, fn: (d: string) => string) { const out = fn(this.files.get(f.path) ?? ""); this.files.set(f.path, out); (window as any).__onWrite?.(f.path, out); return out; }
}
