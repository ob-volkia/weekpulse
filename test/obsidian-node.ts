// Node stand-in for the parts of the Obsidian API the store uses.
export class Events {
  private h = new Map<string, Function[]>();
  on(n: string, f: Function) { this.h.set(n, [...(this.h.get(n) ?? []), f]); return { n, f }; }
  offref(r: { n: string; f: Function }) { this.h.set(r.n, (this.h.get(r.n) ?? []).filter((x) => x !== r.f)); }
  trigger(n: string, ...a: unknown[]) { (this.h.get(n) ?? []).forEach((f) => f(...a)); }
}
export class TFile {
  constructor(public path: string) {}
  get name() { return this.path.split("/").pop()!; }
  get basename() { return this.name.replace(/\.md$/, ""); }
  get extension() { return this.path.split(".").pop(); }
}
export class TFolder { children: (TFile | TFolder)[] = []; constructor(public path: string) {} }
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
export const Platform = { isPhone: false, isMobile: false };
export const setIcon = () => {};
export class Notice { constructor(_: unknown) {} }

export class MemVault {
  files = new Map<string, string>();
  getAbstractFileByPath(p: string) {
    if (this.files.has(p)) return new TFile(p);
    const kids = [...this.files.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/"));
    if (kids.length || [...this.files.keys()].some((k) => k.startsWith(p + "/"))) { const f = new TFolder(p); f.children = kids.map((k) => new TFile(k)); return f; }
    return null;
  }
  getMarkdownFiles() { return [...this.files.keys()].filter((k) => k.endsWith(".md")).map((k) => new TFile(k)); }
  async read(f: TFile) { return this.files.get(f.path) ?? ""; }
  async cachedRead(f: TFile) { return this.read(f); }
  async create(p: string, d: string) { this.files.set(p, d); return new TFile(p); }
  async createFolder() {}
  bin = new Map<string, ArrayBuffer>();
  async createBinary(p: string, d: ArrayBuffer) { this.bin.set(p, d); this.files.set(p, "<binary>"); return new TFile(p); }
  async delete(f: TFile) { this.files.delete(f.path); }
  async rename(f: TFile, to: string) { this.files.set(to, this.files.get(f.path)!); this.files.delete(f.path); }
  async process(f: TFile, fn: (d: string) => string) { const out = fn(this.files.get(f.path) ?? ""); this.files.set(f.path, out); return out; }
}
