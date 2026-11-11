import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./components/ui/Toast";
import { isTauri, log } from "./deck/link";
import { t } from "./i18n";
import { pruneMedia } from "./media";
import { AUTO_COLOR, createInitialState, createKey, DEFAULT_TITLE_STYLE, KEY_COUNT, PAGE_SLOTS, REGISTRY } from "./data";
import type { AppState, KeyConfig, TitleStyle } from "./types";
import { isWidgetKind, WIDGET_PLUGIN_ID, WIDGETS } from "./widgets/catalog";

function migrateWidget(key: KeyConfig): KeyConfig {
  if (key.action?.pluginId !== WIDGET_PLUGIN_ID) return key;
  const kind = key.action.actionId;
  if (!isWidgetKind(kind)) return createKey();
  return key.title === WIDGETS[kind].name ? { ...key, title: "" } : key;
}

type LegacySide = { sections?: { widget?: string; settings?: KeyConfig["settings"] }[] };

function sideSlots(legacy: LegacySide | undefined): KeyConfig[] {
  return Array.from({ length: PAGE_SLOTS - KEY_COUNT }, (_, i) => {
    const s = legacy?.sections?.[i];
    if (!s?.widget || !isWidgetKind(s.widget)) return createKey();
    return { ...createKey(), action: { pluginId: WIDGET_PLUGIN_ID, actionId: s.widget }, settings: s.settings ?? {} };
  });
}

function migrateTitleStyle(style: Partial<TitleStyle> | undefined): TitleStyle {
  const merged = { ...DEFAULT_TITLE_STYLE, ...style };
  return merged.color.toLowerCase() === "#ffffff" ? { ...merged, color: AUTO_COLOR } : merged;
}

const LEGACY_KEY = "open-stream-deck:state:v1";
const SPLASH_KEY = "open-stream-deck:app:v1";
const SAVE_DELAY = 400;

async function readRaw() {
  if (isTauri()) {
    try {
      const text = await invoke<string | null>("state_load");
      if (text) return text;
    } catch (e) {
      log(`state load failed: ${e}`);
    }
  }
  return localStorage.getItem(LEGACY_KEY);
}

export async function loadState(): Promise<AppState> {
  const raw = await readRaw();
  if (raw && isJson(raw)) pruneMedia(raw).catch((e) => log(`media prune failed: ${e}`));
  return parseState(raw);
}

function isJson(raw: string) {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function parseState(raw: string | null): AppState {
  const fallback = createInitialState();
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as AppState & { side?: LegacySide };
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) return fallback;
    const profiles = parsed.profiles.map((profile) => ({
      ...profile,
      pages: profile.pages.map((stored) => {
        const page = stored.length >= PAGE_SLOTS ? stored : [...stored.slice(0, KEY_COUNT), ...sideSlots(parsed.side)];
        return page.map((key) =>
          migrateWidget({
            ...key,
            titleStyle: migrateTitleStyle(key.titleStyle),
            image: key.image ?? null,
            settings: key.settings ?? {},
          }),
        );
      }),
    }));
    const activeProfileId = profiles.some((p) => p.id === parsed.activeProfileId)
      ? parsed.activeProfileId
      : profiles[0].id;
    const installedPlugins = Array.isArray(parsed.installedPlugins)
      ? parsed.installedPlugins.filter((id) => REGISTRY.some((p) => p.id === id))
      : fallback.installedPlugins;
    return {
      installedPlugins,
      pluginGlobals: parsed.pluginGlobals ?? {},
      profiles,
      activeProfileId,
      device: { ...fallback.device, ...parsed.device },
      app: { ...fallback.app, ...parsed.app, theme: parsed.app?.theme === "light" ? "light" : "dark" },
    };
  } catch {
    return fallback;
  }
}

let pending: AppState | null = null;
let timer = 0;
let writing: Promise<void> = Promise.resolve();
let failed = false;
let saving = true;

export function stopSaving() {
  saving = false;
  clearTimeout(timer);
  pending = null;
}

export function resumeSaving() {
  saving = true;
}

async function write(state: AppState) {
  if (!saving) return;
  try {
    localStorage.setItem(SPLASH_KEY, JSON.stringify({ app: state.app }));
  } catch {
    log("splash settings were not saved");
  }
  if (!isTauri()) {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(state));
    return;
  }
  try {
    await invoke("state_save", { text: JSON.stringify(state) });
    failed = false;
  } catch (e) {
    log(`state save failed: ${e}`);
    if (!failed) showToast(t("toast.saveFailed", { error: String(e) }));
    failed = true;
  }
}

export function saveState(state: AppState) {
  pending = state;
  clearTimeout(timer);
  timer = window.setTimeout(() => void flushState(), SAVE_DELAY);
}

export function flushState() {
  clearTimeout(timer);
  const state = pending;
  pending = null;
  if (state) writing = writing.then(() => write(state));
  return writing;
}
