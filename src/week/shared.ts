// Constants and small helpers shared by the week view modules.



export const BACKLOG = "backlog";
export const MOBILE_BREAKPOINT = 720;
export const HOUR_PX = 56;
export const MIN_BLOCK_PX = 46; // a block always fits the title and one line of details
export const STALE_AT = 5;

export type Mode = "days3" | "week" | "month" | "timeline";
export const DAYS3 = 3;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function tagColor(tag: string): number {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}

export const toMin = (hhmm: string) => parseInt(hhmm.slice(0, 2)) * 60 + parseInt(hhmm.slice(3, 5));
export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
