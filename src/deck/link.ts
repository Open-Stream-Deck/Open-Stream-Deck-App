import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "preact/hooks";
import { actionLost, findAction, KEY_COUNT } from "../data";
import { getLang } from "../i18n";
import type { KeyConfig, Plugin, Profile } from "../types";
import { onVisualChange } from "../plugins/visuals";
import type { WidgetEnv } from "../widgets/draw";
import { capture, invalidate, releaseScreen, recordBytes, screenImage, setScreen, setStaged, startAnimator } from "./animator";
import { cancelChange, hasEffect, startChange } from "./effects";
import { styleKey } from "./style";
import { CACHE_PAGES, cacheCanvas, KEY_SIZE, keyRect, keyTile, PANEL_HEIGHT, PANEL_WIDTH, SCREEN, SIDE_SECTIONS, TRANSITION_NEXT } from "./layout";
import { patches } from "./patches";
import { Commands } from "./protocol";
import { canvas, hashText, preloadSlot, renderKey } from "./render";

export type DeckMode = "osd" | "stock" | "loader" | "none";
export type DeckStatus = {
  connected: boolean;
  firmware: string;
  session: number;
  name: string;
  serial: string;
  mode: DeckMode | "";
  caps: number;
  high_speed: boolean;
  display_ok: boolean;
};

const CAP_VSYNC = 4;
const CAP_TRANSITION = 16;
const WAVE = 1;
const WAVE_MS = 420;
const PRESS_ORIGIN_MS = 1500;
const CENTER_KEY = 7;
const OFFLINE: DeckStatus = { connected: false, firmware: "", session: 0, name: "", serial: "", mode: "", caps: 0, high_speed: true, display_ok: true };

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export function log(message: string) {
  if (!isTauri()) return;
  invoke("ui_log", { message }).catch(() => undefined);
}

if (isTauri()) {
  window.addEventListener("error", (e) => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => log(`rejection: ${String(e.reason)}`));
}

let sending: Promise<unknown> = Promise.resolve();

function send(cmd: Commands) {
  if (!cmd.length) return Promise.resolve();
  const bytes = cmd.bytes().slice();
  const sent = sending.then(() => invoke("deck_draw", bytes)).then(() => recordBytes(bytes.length));
  sending = sent.catch(() => undefined);
  return sent;
}

function keyHash(key: KeyConfig, plugins: Plugin[]) {
  const image = key.image ? hashText(key.image) : "";
  const backdrop = key.backdrop ? hashText(key.backdrop) : "";
  return JSON.stringify([key.title, key.titleStyle, key.action, key.settings, image, backdrop, key.badge, key.state, !!findAction(plugins, key.action), actionLost(plugins, key.action)]);
}

const FRAME_MS = 16;
const RETRY_MS = 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DeckSource = {
  profile: Profile;
  plugins: Plugin[];
  page: number;
  snapshot: WidgetSnapshot;
  present: (key: KeyConfig, page: number, index: number) => KeyConfig;
};

let blankCanvas: HTMLCanvasElement | null = null;
function blank() {
  if (!blankCanvas) {
    const { c, ctx } = canvas(KEY_SIZE, KEY_SIZE);
    ctx.fillRect(0, 0, KEY_SIZE, KEY_SIZE);
    blankCanvas = c;
  }
  return blankCanvas;
}

export type WidgetSnapshot = (page: number, index: number, key: KeyConfig) => WidgetEnv | null;

type Shown = { view: string; profile: string; page: number; canvas: number };

class DeckSync {
  connected = false;
  vsync = false;
  transition = false;
  private source: DeckSource | null = null;
  private dirty = false;
  private hiddenStale = true;
  private running = false;
  private uploaded = new Map<string, string>();
  private actions = new Map<string, string>();
  private images = new Map<string, HTMLCanvasElement>();
  private pixels = new Map<string, Uint8Array>();
  private hashes = new WeakMap<KeyConfig, string>();
  private hashScope = "";
  private hashPlugins: Plugin[] | null = null;
  private shown: Shown | null = null;
  private slots = new Map<string, number>();
  private profileId = "";
  private fontsReady = document.fonts?.ready ?? Promise.resolve();
  private brightnessTarget: number | null = null;
  private brightnessSending = false;

  reset() {
    this.uploaded.clear();
    this.actions.clear();
    this.images.clear();
    this.pixels.clear();
    this.slots.clear();
    this.shown = null;
    this.hiddenStale = true;
    invalidate();
    this.kick();
  }

  private slotFor(view: string, keep: Set<string>) {
    const known = this.slots.get(view);
    if (known !== undefined) {
      this.slots.delete(view);
      this.slots.set(view, known);
      return known;
    }
    let slot = this.slots.size;
    if (slot >= CACHE_PAGES) {
      const victim = [...this.slots.keys()].find((v) => !keep.has(v))!;
      slot = this.slots.get(victim)!;
      this.slots.delete(victim);
      for (const map of [this.uploaded, this.actions, this.images, this.pixels])
        for (const key of [...map.keys()]) if (key.startsWith(`${victim}:`)) map.delete(key);
    }
    this.slots.set(view, slot);
    return slot;
  }

  update(source: DeckSource) {
    this.source = source;
    this.hiddenStale = true;
    this.kick();
  }

  kick() {
    this.dirty = true;
    if (!this.running) void this.loop();
  }

  private async loop() {
    this.running = true;
    try {
      await this.fontsReady;
      while (this.dirty && this.connected && this.source) {
        this.dirty = false;
        const started = performance.now();
        try {
          await this.sync(this.source);
        } catch (e) {
          log(`deck sync failed: ${e}`);
          releaseScreen();
          this.uploaded.clear();
          this.pixels.clear();
          this.slots.clear();
          this.shown = null;
          this.hiddenStale = true;
          this.dirty = true;
          await sleep(RETRY_MS);
        }
        await sleep(FRAME_MS - (performance.now() - started));
      }
    } finally {
      this.running = false;
    }
  }

  private hash(key: KeyConfig, plugins: Plugin[]) {
    const scope = styleKey() + getLang();
    if (scope !== this.hashScope || plugins !== this.hashPlugins) {
      this.hashes = new WeakMap();
      this.hashScope = scope;
      this.hashPlugins = plugins;
    }
    let hash = this.hashes.get(key);
    if (hash === undefined) {
      hash = keyHash(key, plugins) + scope;
      this.hashes.set(key, hash);
    }
    return hash;
  }

  private async sync({ profile, plugins, page, snapshot, present }: DeckSource) {
    const pages = profile.pages;
    this.profileId = profile.id;
    const views = pages.map((_, i) => `${profile.id}:${i}`);
    const keep = new Set(views);
    const order = this.hiddenStale ? [page, ...pages.map((_, i) => i).filter((i) => i !== page)] : [page];
    for (const p of order) {
      if (p !== page && this.dirty) return;
      const view = views[p];
      const target = cacheCanvas(this.slotFor(view, keep));
      const cmd = new Commands();
      const changed: number[] = [];
      const redrawn: number[] = [];
      for (let k = 0; k < 15; k++) {
        const slot = `${view}:${k}`;
        const key = present(pages[p][k], p, k);
        const hash = this.hash(key, plugins);
        const action = JSON.stringify(key.action);
        const sameAction = this.actions.get(slot) === action;
        this.actions.set(slot, action);
        if (this.uploaded.get(slot) === hash) continue;
        const tile = keyTile(k);
        const { canvas, pixels } = await renderKey(key, plugins, snapshot(p, k, key));
        const previous = key.ext && sameAction ? this.pixels.get(slot) : undefined;
        cmd.canvas(target);
        for (const patch of patches(previous, pixels, KEY_SIZE, KEY_SIZE))
          cmd.blit(tile.x + patch.x, tile.y + patch.y, patch.w, patch.h, patch.pixels);
        this.uploaded.set(slot, hash);
        this.images.set(slot, canvas);
        this.pixels.set(slot, pixels);
        (key.ext && sameAction ? redrawn : changed).push(k);
      }
      let switched = false;
      let smooth = false;
      let quiet: number[] = [];
      if (p === page) {
        const shown = this.shown;
        const next = { view, profile: profile.id, page, canvas: target };
        const fade = (keys: number[]) => {
          for (const k of keys)
            if (!hasEffect(`key:${k}`)) startChange(`key:${k}`, screenImage(`key:${k}`) ?? blank());
        };
        if (shown?.view === view) {
          fade(changed);
          quiet = redrawn.filter((k) => !hasEffect(`key:${k}`));
          if (quiet.length) this.copyKeys(cmd, target, quiet);
        } else if (shown && this.transition) {
          for (let k = 0; k < 15; k++) cancelChange(`key:${k}`);
          this.copyKeys(cmd, target, [...Array(15).keys()], TRANSITION_NEXT);
          await Promise.all(SIDE_SECTIONS.map((_, j) => preloadSlot(present(pages[p][KEY_COUNT + j], p, KEY_COUNT + j))));
          SIDE_SECTIONS.forEach((_, j) => {
            cancelChange(`side:${j}`);
            const shot = capture(`side:${j}`);
            if (shot) cmd.canvas(TRANSITION_NEXT).blit(shot.rect.x, shot.rect.y, shot.rect.w, shot.rect.h, shot.pixels);
          });
          const origin = keyRect(performance.now() - lastPress.at < PRESS_ORIGIN_MS ? lastPress.index : CENTER_KEY);
          cmd.transition(TRANSITION_NEXT, WAVE, WAVE_MS, origin.x + KEY_SIZE / 2, origin.y + KEY_SIZE / 2);
          this.shown = next;
          switched = true;
          smooth = true;
        } else if (shown) {
          fade([...Array(15).keys()]);
          this.shown = next;
        } else {
          cmd.canvas(SCREEN).fill(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 0);
          this.copyKeys(cmd, target, [...Array(15).keys()]);
          this.shown = next;
          switched = true;
        }
      }
      await send(cmd);
      if (p === page) releaseScreen(view);
      for (const k of quiet) setScreen(`key:${k}`, this.images.get(`${view}:${k}`)!);
      if (switched) {
        for (let k = 0; k < 15; k++) {
          const img = this.images.get(`${view}:${k}`);
          if (img) setScreen(`key:${k}`, img);
        }
        if (!smooth) invalidate();
      }
    }
    this.hiddenStale = false;
  }

  private copyKeys(cmd: Commands, source: number, keys: number[], dst = SCREEN) {
    if (this.vsync && dst === SCREEN && keys.length) cmd.vsync();
    for (const k of [...keys].sort((a, b) => keyRect(a).y - keyRect(b).y || keyRect(a).x - keyRect(b).x)) {
      const t = keyTile(k);
      const r = keyRect(k);
      cmd.copy(source, t.x, t.y, dst, r.x, r.y, KEY_SIZE, KEY_SIZE);
    }
  }

  image(page: number, index: number) {
    return this.images.get(`${this.profileId}:${page}:${index}`);
  }

  brightness(percent: number) {
    this.brightnessTarget = percent;
    if (this.brightnessSending) return;
    this.brightnessSending = true;
    void (async () => {
      try {
        while (this.brightnessTarget !== null) {
          const value = this.brightnessTarget;
          this.brightnessTarget = null;
          if (this.connected) await send(new Commands().brightness(value)).catch((e) => log(`brightness failed: ${e}`));
        }
      } finally {
        this.brightnessSending = false;
      }
    })();
  }
}

export const deck = new DeckSync();
startAnimator(send, () => deck.connected);
onVisualChange(() => deck.kick());

type KeyListener = (index: number, pressed: boolean) => void;
const keyListeners = new Set<KeyListener>();
let lastPress = { index: CENTER_KEY, at: -Infinity };
const statusListeners = new Set<(s: DeckStatus) => void>();
let status = OFFLINE;

function setStatus(next: DeckStatus) {
  deck.vsync = (next.caps & CAP_VSYNC) !== 0;
  deck.transition = (next.caps & CAP_TRANSITION) !== 0;
  setStaged(deck.vsync);
  if (next.connected && next.session !== status.session) deck.reset();
  status = next;
  deck.connected = next.connected;
  statusListeners.forEach((l) => l(next));
}

if (isTauri()) {
  (async () => {
    await listen<DeckStatus>("deck-status", (e) => setStatus(e.payload));
    await listen<{ index: number; pressed: boolean }>("deck-key", (e) => {
      if (e.payload.pressed) lastPress = { index: e.payload.index, at: performance.now() };
      keyListeners.forEach((l) => l(e.payload.index, e.payload.pressed));
    });
    setStatus(await invoke<DeckStatus>("deck_status"));
  })();
}

export function useDeckStatus() {
  const [s, set] = useState(status);
  useEffect(() => {
    statusListeners.add(set);
    set(status);
    return () => void statusListeners.delete(set);
  }, []);
  return s;
}

export function onDeckKey(listener: KeyListener) {
  keyListeners.add(listener);
  return () => void keyListeners.delete(listener);
}

export async function runAction(pluginId: string, actionId: string, settings: Record<string, unknown>) {
  await invoke("run_action", { plugin: pluginId, action: actionId, settings });
}

import.meta.hot?.dispose(() => location.reload());
