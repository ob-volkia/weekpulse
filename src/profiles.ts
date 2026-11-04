// Profile switcher (Работа / Личное / … / Всё). The choice is per device and kept in local storage.

import { Menu } from "obsidian";
import { ALL_PROFILES, Profile } from "./store";
import { icon } from "./ui";
import type WeekPlannerPlugin from "./main";

export const PROFILE_COLORS = ["blue", "green", "purple", "orange", "cyan", "pink", "yellow", "red"];
const KEY = "wp-profile";

export function profileDot(parent: HTMLElement, p: Profile | undefined) {
  return parent.createSpan({ cls: `wp-profile-dot pc-${p?.color ?? "none"}` });
}

export function loadActiveProfile(plugin: WeekPlannerPlugin) {
  const saved = plugin.app.loadLocalStorage(KEY) as string | null;
  const ok = saved === ALL_PROFILES || plugin.settings.profiles.some((p) => p.id === saved);
  plugin.store.profile = ok && saved ? saved : ALL_PROFILES;
}

export function setActiveProfile(plugin: WeekPlannerPlugin, id: string) {
  plugin.app.saveLocalStorage(KEY, id);
  plugin.store.setProfile(id);
}

export function profileMenu(plugin: WeekPlannerPlugin, e: MouseEvent) {
  const store = plugin.store;
  const m = new Menu();
  m.addItem((i) => i.setTitle("Всё").setIcon("layers").setChecked(store.profile === ALL_PROFILES).onClick(() => setActiveProfile(plugin, ALL_PROFILES)));
  for (const p of plugin.settings.profiles)
    m.addItem((i) => i.setTitle(p.name).setIcon("circle").setChecked(store.profile === p.id).onClick(() => setActiveProfile(plugin, p.id)));
  m.addSeparator();
  m.addItem((i) => i.setTitle("Настроить профили…").setIcon("settings").onClick(() => plugin.openSettings()));
  m.showAtMouseEvent(e);
}

/** Chip with the active profile's colour and name; opens the switcher. */
export function profileButton(plugin: WeekPlannerPlugin, parent: HTMLElement, compact = false) {
  const store = plugin.store;
  const p = store.profileInfo(store.profile);
  const b = parent.createEl("button", { cls: `wp-chip-btn wp-profile-btn ${p ? "is-set" : ""}`, attr: { "aria-label": "Профиль" } });
  if (p) profileDot(b, p);
  else icon(b, "layers");
  b.createSpan({ cls: "wp-profile-name", text: p ? p.name : "Всё" });
  if (!compact) icon(b, "chevron-down", "wp-chevron");
  b.onclick = (e) => profileMenu(plugin, e);
  return b;
}
