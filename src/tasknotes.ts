// The "body" of a task lives in its own note, Planner/Tasks/<title>.md:
//
//   ---
//   task: k3j9x2
//   ---
//   # Title
//   ## Описание
//   free markdown
//   ## Ссылки
//   - [Figma](https://figma.com/...)
//   ## Файлы
//   - ![[Planner/Attachments/k3j9x2-brief.pdf]]
//   ## Комментарии
//   - 2026-11-03 14:20 — согласовал с Петей
//
// The task line points at it with [note:: Planner/Tasks/<title>.md]. Keeping the body out of
// Tasks.md keeps that shared file small (fewer iCloud conflicts) and gives the body a real editor.

export interface TaskLink {
  title: string;
  url: string;
}

export interface TaskComment {
  at: string; // "YYYY-MM-DD HH:MM"
  text: string;
}

export interface TaskBody {
  description: string;
  links: TaskLink[];
  files: string[]; // vault paths
  comments: TaskComment[];
}

export interface NoteMeta {
  links: number;
  files: number;
  comments: number;
  description: boolean;
}

const H = { desc: "Описание", links: "Ссылки", files: "Файлы", comments: "Комментарии" };

export function emptyBody(): TaskBody {
  return { description: "", links: [], files: [], comments: [] };
}

export function isEmptyBody(b: TaskBody) {
  return !b.description.trim() && !b.links.length && !b.files.length && !b.comments.length;
}

export function parseBody(text: string): TaskBody {
  const body = emptyBody();
  const stripped = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const sections = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const line of stripped.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h && Object.values(H).includes(h[1])) {
      cur = [];
      sections.set(h[1], cur);
      continue;
    }
    if (cur) cur.push(line);
  }
  body.description = (sections.get(H.desc) ?? []).join("\n").trim();
  for (const l of sections.get(H.links) ?? []) {
    const md = l.match(/^\s*[-*]\s+\[([^\]]*)\]\((\S+?)\)\s*$/);
    const bare = l.match(/^\s*[-*]\s+(https?:\/\/\S+)\s*$/);
    if (md) body.links.push({ title: md[1], url: md[2] });
    else if (bare) body.links.push({ title: "", url: bare[1] });
  }
  for (const l of sections.get(H.files) ?? []) {
    const m = l.match(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
    if (m) body.files.push(m[1]);
  }
  for (const l of sections.get(H.comments) ?? []) {
    const m = l.match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+—\s+(.*)$/);
    if (m) body.comments.push({ at: m[1], text: m[2] });
    else if (l.match(/^\s+\S/) && body.comments.length) body.comments[body.comments.length - 1].text += "\n" + l.trim();
  }
  return body;
}

export function serializeBody(taskId: string, title: string, b: TaskBody): string {
  const out = ["---", `task: ${taskId}`, "---", `# ${title}`, "", `## ${H.desc}`, "", b.description.trim(), ""];
  out.push(`## ${H.links}`, "");
  for (const l of b.links) out.push(`- [${(l.title || l.url).replace(/[[\]]/g, "")}](${l.url})`);
  out.push("", `## ${H.files}`, "");
  for (const f of b.files) out.push(`- ![[${f}]]`);
  out.push("", `## ${H.comments}`, "");
  for (const c of b.comments) {
    const [first, ...rest] = c.text.split("\n");
    out.push(`- ${c.at} — ${first}`, ...rest.map((r) => `    ${r}`));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export function metaOf(b: TaskBody): NoteMeta {
  return { links: b.links.length, files: b.files.length, comments: b.comments.length, description: !!b.description.trim() };
}

/** File-name-safe version of a title. */
export function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Задача";
}

export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Pull a page title for a pasted link (best effort). */
export function titleFromHtml(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const t = og?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
  return t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim().slice(0, 120);
}
