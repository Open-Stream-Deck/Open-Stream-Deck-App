import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Deck } from "./components/Deck";
import { KeyEditor } from "./components/KeyEditor";
import { showToast } from "./components/ui/Toast";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { deck, isTauri, log, onDeckKey, runAction, useDeckStatus } from "./deck/link";
import { holdScreen, screenImage, setSurfaces, type Surface } from "./deck/animator";
import { pressEffect, startChange } from "./deck/effects";
import { mediaRepeat, releaseRepeats, repeatKey } from "./deck/repeat";
import { deckStyle, roundCorners, setDeckStyle } from "./deck/style";
import { KEY_SIZE, keyRect, SIDE_WIDTH, sideSectionRect } from "./deck/layout";
import { drawSlot, hashText } from "./deck/render";
import type { DropItem } from "./dnd";
import { drawWidget } from "./widgets/draw";
import { keyEnv, keyWidget, keyWidgetId, widgetKind } from "./widgets/surface";
import { isPet, isWeather } from "./widgets/catalog";
import { startStats } from "./widgets/stats";
import { pruneTimers, timerOptions, timerPress } from "./widgets/timer";
import { petPress, prunePets } from "./widgets/pets";
import { weather } from "./widgets/weather";
import { PageSwitcher } from "./components/PageSwitcher";
import { PluginSidebar } from "./components/PluginSidebar";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { Settings } from "./components/settings/Settings";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { ContextMenuHost, openContextMenu } from "./components/ui/ContextMenu";
import { ToastHost } from "./components/ui/Toast";
import { TooltipHost } from "./components/ui/Tooltip";
import { UpdateDialog } from "./components/UpdateDialog";
import {
  CloseSquare,
  Copy,
  Eraser,
  GalleryAdd,
  GalleryRemove,
  Gear,
  Paste,
  Scissor,
  TextStyle,
  Trash,
} from "./components/ui/icons";
import {
  createId,
  createInitialState,
  createKey,
  createPage,
  createProfile,
  findAction,
  setProfileOptions,
  isSideSlot,
  KEY_COUNT,
  MAX_PAGES,
  OS,
  PAGE_SLOTS,
  pluginsFromIds,
  REGISTRY,
} from "./data";
import { openPluginFolder, openPluginsFolder } from "./system";
import { contextId, pluginHost, useExternalPlugins } from "./plugins/host";
import { externalAction, fitsKey, fitsSide } from "./plugins/model";
import { flushState, saveState } from "./store";
import type { ActionRef, AppSettings, AppState, DeviceSettings, KeyConfig, Page, Plugin, Profile } from "./types";
import { normalizeLang, setLang, t } from "./i18n";
import "./styles/index.css";

function nextProfileName(profiles: Profile[]) {
  let n = profiles.length + 1;
  while (profiles.some((p) => p.name === t("profile.default", { n }))) n++;
  return t("profile.default", { n });
}

function surfaceId(index: number) {
  return isSideSlot(index) ? `side:${index - KEY_COUNT}` : `key:${index}`;
}

function slotProblem(plugins: Plugin[], index: number, action: ActionRef | null) {
  if (!action) return null;
  const ext = externalAction(plugins, action)?.actionExt;
  if (ext) {
    if (isSideSlot(index)) return fitsSide(ext) ? null : t("slot.sideOnly");
    return fitsKey(ext) ? null : t("slot.infoOnly");
  }
  const kind = widgetKind(action);
  return isSideSlot(index) && (!kind || kind === "timer") ? t("slot.sideOnly") : null;
}

const MEDIA_POLL_MS = 1000;
const MEDIA_SETTLE_MS = 1500;

type MediaState = { muted: boolean; playing: boolean };

const STATEFUL_MEDIA = new Set(["mute", "play-pause"]);

function isStateful(action: ActionRef | null) {
  return action?.pluginId === "media" && STATEFUL_MEDIA.has(action.actionId);
}

function mediaKeyState(action: ActionRef | null, media: MediaState) {
  if (action?.pluginId !== "media") return 0;
  if (action.actionId === "mute") return Number(media.muted);
  if (action.actionId === "play-pause") return Number(media.playing);
  return 0;
}

function slotSignature(key: KeyConfig) {
  return JSON.stringify([key.action, key.settings, key.title, key.titleStyle, key.image ? hashText(key.image) : "", key.badge]);
}

function withAction(plugins: Plugin[], key: KeyConfig, action: ActionRef | null): KeyConfig {
  const previousName = findAction(plugins, key.action)?.action.name;
  const ext = externalAction(plugins, action)?.actionExt;
  const sameAction = key.action?.pluginId === action?.pluginId && key.action?.actionId === action?.actionId;
  const style = ext?.title;
  return {
    ...key,
    action,
    title: key.title === previousName ? "" : key.title,
    settings: sameAction ? key.settings : {},
    ext: sameAction ? key.ext : ext ? { settings: structuredClone(ext.defaults), state: 0 } : undefined,
    titleStyle:
      !sameAction && style
        ? {
            ...key.titleStyle,
            position: style.align ?? key.titleStyle.position,
            size: style.size ?? key.titleStyle.size,
            color: style.color ?? key.titleStyle.color,
            bold: style.bold ?? key.titleStyle.bold,
          }
        : key.titleStyle,
  };
}

const MOD = OS === "macos" ? "Cmd" : "Ctrl";

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest("input, textarea, [contenteditable='true']");
}

function App({ initial }: { initial: AppState }) {
  const [state, setState] = useState<AppState>(() => {
    document.documentElement.dataset.theme = initial.app.theme;
    return initial;
  });
  const [activePage, setActivePage] = useState(0);
  const [selectedKey, setSelectedKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyClipboard, setKeyClipboard] = useState<KeyConfig | null>(null);
  const [pageClipboard, setPageClipboard] = useState<Page | null>(null);
  const [iconRequest, setIconRequest] = useState(0);
  const [styleRequest, setStyleRequest] = useState(0);
  const [clearPage, setClearPage] = useState<number | null>(null);
  const [clearPageOpen, setClearPageOpen] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<number | null>(null);
  const [deletePageOpen, setDeletePageOpen] = useState(false);
  const themeReady = useRef(false);
  const [pluginToDelete, setPluginToDelete] = useState<Plugin | null>(null);
  const [deletePluginOpen, setDeletePluginOpen] = useState(false);
  const [pressed, setPressed] = useState(0);
  const [sleeping, setSleeping] = useState(false);
  const lastActivity = useRef(Date.now());
  const deckStatus = useDeckStatus();
  setDeckStyle({
    keyRadius: state.device.keyRadius,
    sideRadius: state.device.sideRadius,
  });
  setLang(state.app.language);

  useEffect(() => saveState(state), [state]);

  useEffect(() => {
    if (!isTauri()) return;
    const off = listen("app-quit", () => void flushState().finally(() => invoke("app_exit")));
    return () => void off.then((f) => f());
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    invoke("app_behavior", { tray: state.app.minimizeToTray, autostart: state.app.autostart }).catch((e) =>
      log(`app behavior: ${e}`),
    );
  }, [state.app.minimizeToTray, state.app.autostart]);

  useEffect(() => {
    if (deckStatus.connected) return;
    releaseRepeats();
    setPressed(0);
  }, [deckStatus.connected]);

  useEffect(() => {
    if (!deckStatus.connected) return;
    if (!deckStatus.display_ok) showToast(t("toast.displayFailed"));
    else if (!deckStatus.high_speed) showToast(t("toast.fullSpeed"));
  }, [deckStatus.session]);

  const pluginEdit = useRef(false);
  useEffect(() => {
    if (pluginEdit.current) {
      pluginEdit.current = false;
      return;
    }
    lastActivity.current = Date.now();
    setSleeping(false);
  }, [state]);

  useEffect(() => {
    const minutes = state.device.sleepAfter;
    if (minutes <= 0 || sleeping) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > minutes * 60_000) setSleeping(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [sleeping, state.device.sleepAfter]);

  useEffect(() => {
    const root = document.documentElement;
    if (!themeReady.current) {
      themeReady.current = true;
      return;
    }
    root.classList.add("theme-transition");
    root.dataset.theme = state.app.theme;
    pluginHost.setTheme(state.app.theme === "light" ? "light" : "dark");
    const timer = window.setTimeout(() => root.classList.remove("theme-transition"), 500);
    return () => clearTimeout(timer);
  }, [state.app.theme]);

  const externalPlugins = useExternalPlugins();
  const plugins = useMemo(
    () => [...pluginsFromIds(state.installedPlugins), ...externalPlugins],
    [state.installedPlugins, externalPlugins],
  );
  const availablePlugins = REGISTRY.filter((p) => !plugins.includes(p));
  const profile = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
  const pageCount = profile.pages.length;
  const pageIndex = Math.min(activePage, pageCount - 1);
  const rawPage = profile.pages[pageIndex];
  const current = rawPage[selectedKey];
  setProfileOptions(state.profiles);
  const pageInfo = useMemo(
    () => ({ page: pageIndex, pages: pageCount, profile: profile.name }),
    [pageIndex, pageCount, profile.name],
  );

  useEffect(startStats, []);

  useEffect(() => {
    const timers = new Set<string>();
    const pets = new Set<string>();
    state.profiles.forEach((p) =>
      p.pages.forEach((pg, pi) =>
        pg.forEach((k, ki) => {
          const kind = keyWidget(k);
          if (kind === "timer") timers.add(keyWidgetId(p.id, pi, ki));
          else if (kind && isPet(kind)) pets.add(keyWidgetId(p.id, pi, ki));
        }),
      ),
    );
    pruneTimers(timers);
    prunePets(pets);
  }, [state.profiles]);

  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const editPlugin = (fn: (s: AppState) => AppState) => {
      pluginEdit.current = true;
      stateRef.current = fn(stateRef.current);
      setState(fn);
    };
    pluginHost.bind({
      key: ({ profileId, page, slot }) =>
        stateRef.current.profiles.find((p) => p.id === profileId)?.pages[page]?.[slot],
      updateKey: ({ profileId, page, slot }, fn) =>
        editPlugin((s) => ({
          ...s,
          profiles: s.profiles.map((p) =>
            p.id !== profileId
              ? p
              : { ...p, pages: p.pages.map((pg, pi) => (pi !== page ? pg : pg.map((k, ki) => (ki === slot ? fn(k) : k)))) },
          ),
        })),
      globals: (plugin) => stateRef.current.pluginGlobals[plugin] ?? {},
      setGlobals: (plugin, settings) =>
        editPlugin((s) => ({ ...s, pluginGlobals: { ...s.pluginGlobals, [plugin]: settings } })),
      navigate: (wanted, page) => {
        const { profiles, activeProfileId } = stateRef.current;
        const name = wanted?.toLowerCase();
        const target =
          wanted === null
            ? (profiles.find((p) => p.id === activeProfileId) ?? profiles[0])
            : profiles.find((p) => p.id === wanted || p.name.toLowerCase() === name);
        if (!target) return false;
        if (target.id !== activeProfileId) {
          setState((s) => ({ ...s, activeProfileId: target.id }));
          setSelectedKey(0);
        }
        setActivePage(Math.min(page ?? 0, target.pages.length - 1));
        return true;
      },
    });
    pluginHost.start().catch((e) => log(`plugins: ${e}`));
  }, []);

  useEffect(() => pluginHost.sync(profile, pageIndex), [profile, pageIndex, externalPlugins]);

  const [media, setMedia] = useState<MediaState>({ muted: false, playing: false });
  const stateful = useMemo(
    () => profile.pages.some((pg) => pg.some((k) => isStateful(k.action))),
    [profile],
  );
  const settleUntil = useRef(0);
  const refreshMedia = () =>
    invoke<MediaState>("media_state").then((next) => {
      if (Date.now() < settleUntil.current) return;
      setMedia((prev) => (prev.muted === next.muted && prev.playing === next.playing ? prev : next));
    });

  useEffect(() => {
    if (!stateful || !isTauri()) return;
    const poll = () => void refreshMedia().catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, MEDIA_POLL_MS);
    return () => clearInterval(timer);
  }, [stateful]);

  const presentKey = (key: KeyConfig, p: number, k: number) => {
    const shown = externalPlugins.length ? pluginHost.present(key, profile.id, p, k) : key;
    const state = mediaKeyState(shown.action, media);
    return state ? { ...shown, state } : shown;
  };

  const shownProfile = useMemo(
    () =>
      externalPlugins.length || (stateful && (media.muted || media.playing))
        ? { ...profile, pages: profile.pages.map((pg, pi) => pg.map((k, ki) => presentKey(k, pi, ki))) }
        : profile,
    [profile, externalPlugins, media, stateful],
  );
  const page = shownProfile.pages[pageIndex];

  useEffect(() => {
    if (!deckStatus.connected) return;
    const snapshot = (p: number, k: number, key: KeyConfig) =>
      keyEnv(key, keyWidgetId(profile.id, p, k), { ...pageInfo, page: p }, false);
    const timer = window.setTimeout(
      () => deck.update({ profile, plugins, page: pageIndex, snapshot, present: presentKey }),
      25,
    );
    return () => clearTimeout(timer);
  }, [profile, externalPlugins, plugins, pageIndex, pageInfo, deckStatus.connected, deckStatus.session, state.app.language, media]);

  useEffect(() => {
    if (isTauri()) invoke("set_language", { language: state.app.language }).catch(() => undefined);
    pluginHost.setLanguage(normalizeLang(state.app.language));
  }, [state.app.language]);

  const previousView = useRef({ view: "", profile: "", page });
  useEffect(() => {
    const view = `${profile.id}:${pageIndex}`;
    const before = previousView.current;
    const animate = (i: number) => {
      const shown = screenImage(surfaceId(i));
      if (shown) startChange(surfaceId(i), shown);
    };
    if (before.view === view) {
      page.forEach((key, i) => {
        const old = before.page[i];
        const redraw = !!key.ext && old?.action?.pluginId === key.action?.pluginId && old?.action?.actionId === key.action?.actionId;
        if (old && old !== key && !redraw && (isSideSlot(i) || keyWidget(old) || keyWidget(key))) animate(i);
      });
    } else if (before.view && deck.transition) {
      holdScreen(view);
    } else if (before.view) {
      for (let i = KEY_COUNT; i < PAGE_SLOTS; i++)
        if (before.page[i] && slotSignature(before.page[i]) !== slotSignature(page[i])) animate(i);
    }
    previousView.current = { view, profile: profile.id, page };

    const surfaces: Surface[] = [];
    page.forEach((key, i) => {
      const side = isSideSlot(i);
      const widgetId = keyWidgetId(profile.id, pageIndex, i);
      const widget = !!keyWidget(key);
      const down = !side && (pressed & (1 << i)) !== 0;
      const w = side ? SIDE_WIDTH : KEY_SIZE;
      surfaces.push({
        id: surfaceId(i),
        rect: side ? sideSectionRect(i - KEY_COUNT) : keyRect(i),
        w,
        h: KEY_SIZE,
        live: widget || side,
        draw: (ctx) => {
          if (side || widget) {
            const live = presentKey(rawPage[i], pageIndex, i);
            drawSlot(ctx, live, plugins, w, KEY_SIZE, widget ? keyEnv(live, widgetId, pageInfo, down) : null);
            roundCorners(ctx, w, KEY_SIZE, side ? deckStyle.sideRadius : deckStyle.keyRadius);
            return;
          }
          const image = deck.image(pageIndex, i);
          if (image) ctx.drawImage(image, 0, 0);
          else {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, KEY_SIZE, KEY_SIZE);
          }
        },
      });
    });
    setSurfaces(surfaces);
  }, [page, pageIndex, pageInfo, profile.id, plugins, pressed, state.device]);

  useEffect(() => {
    if (deckStatus.connected) deck.brightness(sleeping ? 0 : state.device.brightness);
  }, [state.device.brightness, sleeping, deckStatus.connected, deckStatus.session]);

  const keyHandler = useRef<(index: number, down: boolean) => void>(() => undefined);
  keyHandler.current = (index, down) => {
    lastActivity.current = Date.now();
    if (sleeping) {
      if (down) setSleeping(false);
      return;
    }
    setPressed((mask) => (down ? mask | (1 << index) : mask & ~(1 << index)));
    const key = rawPage[index];
    const widget = keyWidget(key);
    pressEffect(`key:${index}`, down);
    if (widget) {
      const id = keyWidgetId(profile.id, pageIndex, index);
      if (widget === "timer") timerPress(id, down, timerOptions(key.settings));
      if (isPet(widget)) petPress(id, down);
      if (isWeather(widget) && down) weather(key.settings, true);
      return;
    }
    if (pluginHost.press(index, down)) return;
    const found = findAction(plugins, key.action);
    const fail = (e: unknown) => showToast(`${key.title || found?.action.name}: ${e}`);
    const repeat = found?.plugin.id === "media" ? mediaRepeat(found.action.id, key.settings, fail) : null;
    repeatKey(index, down, repeat);
    if (!down || !found || repeat) return;
    const { plugin, action } = found;
    if (plugin.id === "navigation") {
      if (action.id === "next-page") setActivePage((pageIndex + 1) % pageCount);
      else if (action.id === "prev-page") setActivePage((pageIndex - 1 + pageCount) % pageCount);
      else if (action.id === "profile") {
        const chosen = String(key.settings.profile ?? "");
        const target =
          state.profiles.find((p) => p.id === chosen) ??
          state.profiles.find((p) => p.name.toLowerCase() === chosen.trim().toLowerCase()) ??
          state.profiles[0];
        selectProfile(target.id);
      }
      return;
    }
    if (isStateful(key.action)) {
      settleUntil.current = Date.now() + MEDIA_SETTLE_MS;
      setMedia((m) => (action.id === "mute" ? { ...m, muted: !m.muted } : { ...m, playing: !m.playing }));
    }
    runAction(plugin.id, action.id, key.settings).catch(fail);
  };

  useEffect(() => onDeckKey((index, down) => keyHandler.current(index, down)), []);

  function updateProfiles(fn: (profiles: Profile[]) => Profile[]) {
    setState((s) => ({ ...s, profiles: fn(s.profiles) }));
  }

  function updatePage(target: number, fn: (page: Page) => Page) {
    updateProfiles((profiles) =>
      profiles.map((p) =>
        p.id !== profile.id ? p : { ...p, pages: p.pages.map((pg, pi) => (pi === target ? fn(pg) : pg)) },
      ),
    );
  }

  function updateKey(index: number, fn: (key: KeyConfig) => KeyConfig) {
    updatePage(pageIndex, (pg) => pg.map((k, ki) => (ki === index ? fn(k) : k)));
  }

  function copyKey(index: number) {
    setKeyClipboard(structuredClone(rawPage[index]));
  }

  function cutKey(index: number) {
    copyKey(index);
    updateKey(index, createKey);
  }

  function pasteKey(index: number) {
    if (keyClipboard) updateKey(index, () => structuredClone(keyClipboard));
  }

  function dropOnKey(index: number, item: DropItem, copy: boolean) {
    if (item.type === "action") {
      const problem = slotProblem(plugins, index, item.ref);
      if (problem) {
        showToast(problem);
        return;
      }
      updateKey(index, (k) => withAction(plugins, k, item.ref));
    } else {
      const from = item.type === "key" ? item.index : KEY_COUNT + item.section;
      if (from === index) return;
      const problem =
        slotProblem(plugins, index, rawPage[from].action) ?? (copy ? null : slotProblem(plugins, from, rawPage[index].action));
      if (problem) {
        showToast(problem);
        return;
      }
      updatePage(pageIndex, (pg) =>
        pg.map((k, i) => (i === index ? structuredClone(pg[from]) : i === from && !copy ? pg[index] : k)),
      );
    }
    setSelectedKey(index);
  }

  function clearKey(index: number) {
    updateKey(index, createKey);
  }

  function isEmpty(key: KeyConfig) {
    return !key.action && !key.image && key.title === "";
  }

  function onlyAction(key: KeyConfig) {
    const autoTitle = key.title === "" || key.title === findAction(plugins, key.action)?.action.name;
    return !key.action || (!key.image && autoTitle);
  }

  function openKeyMenu(index: number, e: MouseEvent) {
    const key = rawPage[index];
    setSelectedKey(index);
    openContextMenu(e, [
      { label: t("menu.copy"), icon: Copy, shortcut: `${MOD}+C`, disabled: isEmpty(key), onSelect: () => copyKey(index) },
      { label: t("menu.cut"), icon: Scissor, shortcut: `${MOD}+X`, disabled: isEmpty(key), onSelect: () => cutKey(index) },
      { label: t("menu.paste"), icon: Paste, shortcut: `${MOD}+V`, disabled: !keyClipboard, onSelect: () => pasteKey(index) },
      "separator",
      {
        label: t("menu.changeIcon"),
        icon: GalleryAdd,
        disabled: !!keyWidget(key),
        onSelect: () => setIconRequest((n) => n + 1),
      },
      { label: t("menu.textSettings"), icon: TextStyle, onSelect: () => setStyleRequest((n) => n + 1) },
      {
        label: t("menu.removeImage"),
        icon: GalleryRemove,
        disabled: !key.image || !!keyWidget(key),
        onSelect: () => updateKey(index, (k) => ({ ...k, image: null })),
      },
      {
        label: t("menu.removeAction"),
        icon: CloseSquare,
        disabled: onlyAction(key),
        onSelect: () => updateKey(index, (k) => withAction(plugins, k, null)),
      },
      "separator",
      {
        label: t("menu.clearKey"),
        icon: Eraser,
        shortcut: "Del",
        danger: true,
        disabled: isEmpty(key),
        onSelect: () => clearKey(index),
      },
    ]);
  }

  function addPage() {
    if (pageCount >= MAX_PAGES) return;
    updateProfiles((profiles) =>
      profiles.map((p) => (p.id === profile.id ? { ...p, pages: [...p.pages, createPage()] } : p)),
    );
    setActivePage(pageCount);
  }

  function deletePage(index: number) {
    if (pageCount <= 1) return;
    updateProfiles((profiles) =>
      profiles.map((p) => (p.id === profile.id ? { ...p, pages: p.pages.filter((_, i) => i !== index) } : p)),
    );
    setActivePage((active) => (active > index ? active - 1 : Math.min(active, pageCount - 2)));
  }

  function openPageMenu(pageIndex: number, e: MouseEvent) {
    const target = profile.pages[pageIndex];
    const empty = target.every(isEmpty);
    openContextMenu(e, [
      {
        label: t("menu.copyPage"),
        icon: Copy,
        disabled: empty,
        onSelect: () => setPageClipboard(structuredClone(target)),
      },
      {
        label: t("menu.pastePage"),
        icon: Paste,
        disabled: !pageClipboard,
        onSelect: () => pageClipboard && updatePage(pageIndex, () => structuredClone(pageClipboard)),
      },
      "separator",
      {
        label: t("menu.clearPage"),
        icon: Eraser,
        danger: true,
        disabled: empty,
        onSelect: () => {
          setClearPage(pageIndex);
          setClearPageOpen(true);
        },
      },
      {
        label: t("menu.deletePage"),
        icon: Trash,
        danger: true,
        disabled: pageCount <= 1,
        onSelect: () => {
          setPageToDelete(pageIndex);
          setDeletePageOpen(true);
        },
      },
    ]);
  }

  function pluginUsage(pluginId: string) {
    return state.profiles.reduce(
      (sum, p) => sum + p.pages.flat().filter((k) => k.action?.pluginId === pluginId).length,
      0,
    );
  }

  function requestDeletePlugin(pluginId: string) {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin || plugin.builtin) return;
    setPluginToDelete(plugin);
    setDeletePluginOpen(true);
  }

  function deletePlugin(pluginId: string) {
    const external = plugins.find((p) => p.id === pluginId)?.ext;
    if (external) {
      pluginHost.uninstall(pluginId).catch((e) => showToast(t("toast.pluginDeleteFailed", { error: String(e) })));
    }
    setState((s) => ({
      ...s,
      installedPlugins: s.installedPlugins.filter((id) => id !== pluginId),
      profiles: s.profiles.map((p) => ({
        ...p,
        pages: p.pages.map((pg) =>
          pg.map((k) => (k.action?.pluginId === pluginId ? withAction(plugins, k, null) : k)),
        ),
      })),
    }));
  }

  function openFolderOf(pluginId: string) {
    return openPluginFolder(plugins.find((p) => p.id === pluginId)?.ext?.dir ?? pluginId);
  }

  function installPlugin(pluginId: string) {
    setState((s) =>
      s.installedPlugins.includes(pluginId) ? s : { ...s, installedPlugins: [...s.installedPlugins, pluginId] },
    );
  }

  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => undefined);
  shortcuts.current = (e) => {
    if (e.defaultPrevented || isEditable(e.target) || document.querySelector(".modal-layer")) return;
    const ctrl = OS === "macos" ? e.metaKey : e.ctrlKey;
    const code = e.code;
    if (ctrl && code === "KeyC" && !isEmpty(current)) copyKey(selectedKey);
    else if (ctrl && code === "KeyX" && !isEmpty(current)) cutKey(selectedKey);
    else if (ctrl && code === "KeyV" && keyClipboard) pasteKey(selectedKey);
    else if (!ctrl && (e.key === "Delete" || (OS === "macos" && e.key === "Backspace"))) clearKey(selectedKey);
    else return;
    e.preventDefault();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function selectProfile(id: string) {
    if (id === state.activeProfileId) return;
    setState((s) => ({ ...s, activeProfileId: id }));
    setActivePage(0);
    setSelectedKey(0);
  }

  function createNewProfile() {
    const created = createProfile(nextProfileName(state.profiles));
    setState((s) => ({ ...s, profiles: [...s.profiles, created], activeProfileId: created.id }));
    setActivePage(0);
    setSelectedKey(0);
    return created;
  }

  function duplicateProfile(id: string) {
    const source = state.profiles.find((p) => p.id === id);
    if (!source) return;
    const copy: Profile = { ...structuredClone(source), id: createId(), name: t("profile.copyName", { name: source.name }) };
    updateProfiles((profiles) => {
      const at = profiles.findIndex((p) => p.id === id);
      return [...profiles.slice(0, at + 1), copy, ...profiles.slice(at + 1)];
    });
  }

  function deleteProfile(id: string) {
    setState((s) => {
      if (s.profiles.length === 1) return s;
      const profiles = s.profiles.filter((p) => p.id !== id);
      if (s.activeProfileId !== id) return { ...s, profiles };
      return { ...s, profiles, activeProfileId: profiles[0].id };
    });
    if (id === state.activeProfileId) {
      setActivePage(0);
      setSelectedKey(0);
    }
  }

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <div class="app">
      <main class="workspace">
        <div class="workspace__inner">
          <header class="device">
            <div class="device__info">
              <h1 class={deckStatus.name ? "device__name" : "device__name device__name--offline"}>
                {deckStatus.name || t("common.notConnected")}
              </h1>
              <ProfileSwitcher
                profiles={state.profiles}
                activeId={profile.id}
                onSelect={selectProfile}
                onCreate={createNewProfile}
                onRename={(id, name) =>
                  updateProfiles((profiles) => profiles.map((p) => (p.id === id ? { ...p, name } : p)))
                }
                onDuplicate={duplicateProfile}
                onDelete={deleteProfile}
              />
            </div>
            <button
              type="button"
              class="icon-button icon-button--surface device__settings"
              aria-label={t("common.settings")}
              data-tip={t("common.settings")}
              onClick={() => setSettingsOpen(true)}
            >
              <Gear size={18} />
            </button>
          </header>
          <Deck
            page={rawPage}
            present={(key, i) => presentKey(key, pageIndex, i)}
            pageIndex={pageIndex}
            profileId={profile.id}
            brightness={state.device.brightness}
            selectedKey={selectedKey}
            onSelectKey={setSelectedKey}
            pressed={pressed}
            pageInfo={pageInfo}
            onDropKey={dropOnKey}
            onKeyContextMenu={openKeyMenu}
            connected={deckStatus.connected}
            plugins={plugins}
          />
          <PageSwitcher
            count={pageCount}
            active={pageIndex}
            canAdd={pageCount < MAX_PAGES}
            onChange={setActivePage}
            onAdd={addPage}
            onContextMenu={openPageMenu}
          />
          <KeyEditor
            plugins={plugins}
            side={isSideSlot(selectedKey)}
            widgetDraw={
              keyWidget(current)
                ? (ctx) => {
                    const env = keyEnv(current, keyWidgetId(profile.id, pageIndex, selectedKey), pageInfo, false);
                    if (env) drawWidget(ctx, isSideSlot(selectedKey) ? SIDE_WIDTH : KEY_SIZE, KEY_SIZE, env);
                  }
                : undefined
            }
            keyId={`${profile.id}:${pageIndex}:${selectedKey}`}
            iconRequest={iconRequest}
            styleRequest={styleRequest}
            config={current}
            shown={() => presentKey(current, pageIndex, selectedKey)}
            context={
              externalAction(plugins, current.action)
                ? contextId(profile.id, pageIndex, selectedKey, current.action!.actionId)
                : null
            }
            onTitleChange={(title) => updateKey(selectedKey, (k) => ({ ...k, title }))}
            onTitleStyleChange={(patch) =>
              updateKey(selectedKey, (k) => ({ ...k, titleStyle: { ...k.titleStyle, ...patch } }))
            }
            onImageChange={(image) => updateKey(selectedKey, (k) => ({ ...k, image }))}
            onSettingsChange={(patch) =>
              updateKey(selectedKey, (k) => ({ ...k, settings: { ...k.settings, ...patch } }))
            }
          />
        </div>
      </main>
      <PluginSidebar
        plugins={plugins}
        active={current.action}
        onPick={(action) => {
          const problem = slotProblem(plugins, selectedKey, action);
          if (problem) {
            showToast(problem);
            return;
          }
          updateKey(selectedKey, (k) => withAction(plugins, k, action));
        }}
        onOpenFolder={openFolderOf}
        onDeletePlugin={requestDeletePlugin}
      />
      <Settings
        open={settingsOpen}
        onClose={closeSettings}
        device={state.device}
        app={state.app}
        firmware={deckStatus.connected ? deckStatus.firmware : ""}
        connected={deckStatus.connected}
        deviceName={deckStatus.name}
        serial={deckStatus.serial}
        mode={deckStatus.mode || "none"}
        onDeviceChange={(patch: Partial<DeviceSettings>) =>
          setState((s) => ({ ...s, device: { ...s.device, ...patch } }))
        }
        onAppChange={(patch: Partial<AppSettings>) => setState((s) => ({ ...s, app: { ...s.app, ...patch } }))}
        getState={() => state}
        installedPlugins={plugins}
        availablePlugins={availablePlugins}
        onInstallPlugin={installPlugin}
        onDeletePlugin={requestDeletePlugin}
        onOpenPluginFolder={(id) => (id ? openFolderOf(id) : openPluginsFolder())}
        onResetProfiles={() => {
          const fresh = createProfile(t("profile.default", { n: 1 }));
          setState((s) => ({ ...s, profiles: [fresh], activeProfileId: fresh.id }));
          setActivePage(0);
          setSelectedKey(0);
        }}
        onResetAll={() => {
          setState(createInitialState());
          setActivePage(0);
          setSelectedKey(0);
          setSettingsOpen(false);
        }}
      />
      <ConfirmDialog
        open={clearPageOpen}
        title={t("dialog.clearPage.title", { n: (clearPage ?? 0) + 1 })}
        confirmLabel={t("common.clear")}
        icon={Eraser}
        onClose={() => setClearPageOpen(false)}
        onConfirm={() => {
          if (clearPage !== null) updatePage(clearPage, (pg) => pg.map(() => createKey()));
          setClearPageOpen(false);
        }}
      >
        {t("dialog.clearPage.text")}
      </ConfirmDialog>
      <ConfirmDialog
        open={deletePageOpen}
        title={t("dialog.deletePage.title", { n: (pageToDelete ?? 0) + 1 })}
        confirmLabel={t("common.delete")}
        onClose={() => setDeletePageOpen(false)}
        onConfirm={() => {
          if (pageToDelete !== null) deletePage(pageToDelete);
          setDeletePageOpen(false);
        }}
      >
        {t("dialog.deletePage.text")}
      </ConfirmDialog>
      <ConfirmDialog
        open={deletePluginOpen}
        title={t("dialog.deletePlugin.title")}
        confirmLabel={t("common.delete")}
        onClose={() => setDeletePluginOpen(false)}
        onConfirm={() => {
          if (pluginToDelete) deletePlugin(pluginToDelete.id);
          setDeletePluginOpen(false);
        }}
      >
        {pluginToDelete && pluginUsage(pluginToDelete.id) > 0
          ? t("dialog.deletePlugin.used", { name: pluginToDelete.name, usage: pluginUsage(pluginToDelete.id) })
          : t("dialog.deletePlugin.unused", { name: pluginToDelete?.name ?? "" })}
      </ConfirmDialog>
      <ContextMenuHost />
      <TooltipHost />
      <ToastHost />
      <UpdateDialog />
    </div>
  );
}

export default App;
