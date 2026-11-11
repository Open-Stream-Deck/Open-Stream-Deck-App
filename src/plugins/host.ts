import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "preact/hooks";
import { COLUMNS, KEY_COUNT, markPluginsLoaded, OS } from "../data";
import { isTauri, log } from "../deck/link";
import { getLang } from "../i18n";
import type { ExternalAction, Json, JsonObject, KeyConfig, Plugin, PluginTitleStyle, Profile } from "../types";
import { DevState } from "./devState";
import { Gestures } from "./gestures";
import { externalAction, type PluginInfo, pluginFile, toPlugin } from "./model";
import { Realm, type RealmState } from "./runtime";
import { flash, forget, invalidateVisuals, present, setImage, setTitle } from "./visuals";

type Location = { profileId: string; page: number; slot: number };

type Instance = Location & {
  context: string;
  plugin: string;
  action: string;
  controller: "key" | "side";
  position: { column: number; row: number };
};

export type HostBinding = {
  key(loc: Location): KeyConfig | undefined;
  updateKey(loc: Location, fn: (key: KeyConfig) => KeyConfig): void;
  globals(plugin: string): JsonObject;
  setGlobals(plugin: string, settings: JsonObject): void;
  navigate(profile: string | null, page: number | null): boolean;
};

export type ProcessStatus = { id: string; state: RealmState; message?: string };

export type SettingsPageMessage =
  | { type: "hello"; plugin: string; label: string }
  | { type: "bye"; plugin: string; label: string }
  | { type: "saveGlobals"; plugin: string; settings: JsonObject }
  | { type: "send"; plugin: string; payload: Json }
  | { type: "openUrl"; plugin: string; url: string };

const DEVICE_ID = "OSD153R00001";
const ACTIVITY_MS = 3000;
const MAX_TITLE = 512;
const MAX_IMAGE = 1024 * 1024;
const IMAGE_DATA = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]*$/;
const IMAGE_URL = /^https?:\/\/[^\s]{1,2040}$/;
const IMAGE_CACHE = 32;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function contextId(profileId: string, page: number, slot: number, action: string) {
  const text = `${profileId}|${page}|${slot}|${action}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, 31) ^ h2)).toUpperCase();
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safePath(path: string) {
  return !!path && path.length <= 240 && !path.startsWith("/") && !/[\\:]/.test(path) && path.split("/").every((p) => p && p !== "." && p !== "..");
}

function titleStyle(value: unknown): PluginTitleStyle | undefined {
  if (!isObject(value)) return undefined;
  const style: PluginTitleStyle = {};
  if (value.align === "top" || value.align === "middle" || value.align === "bottom") style.align = value.align;
  if (typeof value.size === "number" && value.size >= 6 && value.size <= 32) style.size = Math.round(value.size);
  if (typeof value.color === "string" && COLOR.test(value.color)) style.color = value.color;
  if (typeof value.bold === "boolean") style.bold = value.bold;
  return style;
}

type InspectorLink = { plugin: string; port: MessagePort };

class PluginHostClient {
  private devState = new DevState();
  private binding: HostBinding | null = null;
  private infos: PluginInfo[] = [];
  private plugins: Plugin[] = [];
  private realms = new Map<string, Realm>();
  private sessions = new Map<string, number>();
  private instances = new Map<string, Instance>();
  private status = new Map<string, ProcessStatus>();
  private listeners = new Set<() => void>();
  private inspectors = new Map<string, InspectorLink>();
  private settingsWindows = new Map<string, string>();
  private activity = new Map<string, number>();
  private gestures = new Gestures((context, type, extra) => {
    const inst = this.instances.get(context);
    if (inst) this.toPlugin(inst.plugin, { ...this.keyEvent(inst, type), ...extra });
  });
  private device = { connected: false, name: "AJAZZ AKP153R", firmware: "" };
  private navigation: Record<string, unknown> | null = null;
  private images = new Map<string, string>();
  private loading = new Map<string, string>();
  private started = false;
  private appVersion = "0.0.0";

  bind(binding: HostBinding) {
    this.binding = binding;
  }

  get list() {
    return this.plugins;
  }

  details(id: string) {
    return this.infos.find((p) => p.id === id);
  }

  processStatus(id: string) {
    return this.status.get(id);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  async start() {
    if (this.started || !isTauri()) return;
    this.started = true;
    this.appVersion = await getVersion().catch(() => this.appVersion);
    const status = await invoke<{ connected: boolean; name: string; firmware: string }>("deck_status");
    this.device = { connected: status.connected, name: status.name || this.device.name, firmware: status.firmware };
    await listen<{ connected: boolean; name: string; firmware: string }>("deck-status", (e) => {
      const next = { connected: e.payload.connected, name: e.payload.name || this.device.name, firmware: e.payload.firmware };
      if (next.connected === this.device.connected && next.name === this.device.name) return;
      this.device = next;
      if (!next.connected) this.gestures.cancelAll();
      for (const id of this.realms.keys()) this.toPlugin(id, { type: "device", device: this.deviceInfo() });
    });
    await listen<{ id: string | null }>("plugins-changed", (e) => void this.refresh(e.payload.id ?? undefined));
    await listen<{ id: string; session: number; message: JsonObject }>("plugin-broker", (e) => {
      const { id, session, message } = e.payload;
      if (this.sessions.get(id) === session) this.realms.get(id)?.send(message);
    });
    await listen<SettingsPageMessage>("opensd-settings-up", (e) => this.settingsPageMessage(e.payload));
    await listen("system-wake", () => {
      for (const id of this.realms.keys()) this.toPlugin(id, { type: "systemWake" });
    });
    await this.refresh();
  }

  async refresh(changed?: string) {
    if (!isTauri()) return;
    const infos = await invoke<PluginInfo[]>("plugins_list");
    const dev = await invoke<{ projects: string[] }>("plugin_dev_status");
    this.devState.setActive(dev.projects);
    this.infos = infos;
    this.plugins = infos.map(toPlugin);
    for (const [id, realm] of this.realms) {
      if (!infos.some((p) => p.id === id) || id === changed) {
        realm.stop();
        this.realms.delete(id);
        this.status.delete(id);
      }
    }
    for (const info of infos) if (!this.realms.has(info.id)) this.launch(info);
    markPluginsLoaded();
    this.notify();
  }

  private launch(info: PluginInfo) {
    const realm = new Realm(
      {
        id: info.id,
        kind: info.manifest.runtime.type,
        code: pluginFile(info.id, info.manifest.runtime.main, info.revision),
        connect: info.granted ? (info.manifest.permissions?.network ?? []) : [],
      },
      {
        ready: (session) => this.ready(info.id, session),
        command: (command, session) => {
          if (this.sessions.get(info.id) === session) this.command(info.id, command, session);
        },
        state: (state, message) => {
          this.status.set(info.id, { id: info.id, state, message });
          if (message) void invoke("plugin_log", { id: info.id, level: "error", message: `${state}: ${message}` }).catch(() => undefined);
          this.notify();
        },
        ended: (session) => {
          this.sessions.delete(info.id);
          void invoke("plugin_session_end", { id: info.id, session }).catch(() => undefined);
          for (const inst of this.instances.values()) {
            if (inst.plugin !== info.id) continue;
            this.gestures.cancel(inst.context);
            forget(inst.context);
          }
        },
      },
    );
    this.realms.set(info.id, realm);
    void invoke("plugin_log_start", { id: info.id }).catch(() => undefined);
    realm.start();
  }

  private ready(id: string, session: number) {
    this.sessions.set(id, session);
    const info = this.details(id);
    this.toPlugin(id, {
      type: "init",
      plugin: { id, version: info?.manifest.version ?? "" },
      app: { version: this.appVersion, os: OS, language: getLang() },
      device: this.deviceInfo(),
      globals: this.globalsFor(id),
    });
    if (this.navigation) this.toPlugin(id, this.navigation);
    for (const inst of this.instances.values()) if (inst.plugin === id) this.toPlugin(id, this.appearEvent(inst));
    for (const [context, link] of this.inspectors) {
      const inst = this.instances.get(context);
      if (link.plugin === id && inst) this.toPlugin(id, this.keyEvent(inst, "inspectorOpen"));
    }
    if (this.settingsWindows.has(id)) this.toPlugin(id, { type: "settingsPageOpen" });
  }

  setLanguage(language: string) {
    for (const id of this.realms.keys()) this.toPlugin(id, { type: "language", language });
  }

  async install(path: string) {
    const info = await invoke<PluginInfo>("plugin_install", { path });
    await this.refresh(info.id);
    return info;
  }

  async installFromStore(id: string) {
    const info = await invoke<PluginInfo>("store_install", { id });
    await this.refresh(info.id);
    return info;
  }

  async uninstall(id: string) {
    for (const inst of [...this.instances.values()]) if (inst.plugin === id) this.disappear(inst);
    await invoke("plugin_uninstall", { id });
    await this.refresh(id);
  }

  async restart(id: string) {
    const realm = this.realms.get(id);
    if (!realm) throw new Error("Plugin not found");
    realm.stop();
    realm.start();
  }

  openSettingsPage(id: string) {
    if (!this.details(id)?.manifest.ui?.settings) return;
    invoke("plugin_settings_window", { id }).catch((e) => log(`plugin settings ${id}: ${e}`));
  }

  private deviceInfo() {
    return {
      id: DEVICE_ID,
      name: this.device.name,
      connected: this.device.connected,
      keys: { columns: COLUMNS, rows: 3, width: 103, height: 103 },
      side: { slots: 3, width: 85, height: 103 },
    };
  }

  private toPlugin(id: string, event: Record<string, unknown>) {
    this.realms.get(id)?.send(event);
  }

  private keyOf(inst: Instance) {
    const key = this.binding?.key(inst);
    return key?.action?.pluginId === inst.plugin && key.action.actionId === inst.action ? this.devState.key(inst.plugin, inst.context, key) : undefined;
  }

  private updateInstance(inst: Instance, update: (key: KeyConfig) => KeyConfig) {
    const key = this.keyOf(inst);
    if (!key) return;
    if (this.devState.setKey(inst.plugin, inst.context, update(structuredClone(key)))) invalidateVisuals();
    else this.binding?.updateKey(inst, update);
  }

  private globalsFor(plugin: string) {
    return this.devState.global(plugin, this.binding?.globals(plugin) ?? {});
  }

  private saveGlobals(plugin: string, settings: JsonObject) {
    if (!this.devState.setGlobal(plugin, settings)) this.binding?.setGlobals(plugin, settings);
  }

  private actionOf(inst: Instance): ExternalAction | undefined {
    return externalAction(this.plugins, { pluginId: inst.plugin, actionId: inst.action })?.actionExt;
  }

  private keyEvent(inst: Instance, type: string, key = this.keyOf(inst)) {
    return { type, context: inst.context, action: inst.action, settings: key?.ext?.settings ?? {}, state: key?.ext?.state ?? 0 };
  }

  private appearEvent(inst: Instance) {
    return { ...this.keyEvent(inst, "appear"), controller: inst.controller, position: inst.position };
  }

  private appear(inst: Instance) {
    this.instances.set(inst.context, inst);
    this.toPlugin(inst.plugin, this.appearEvent(inst));
  }

  private disappear(inst: Instance, keep = false) {
    this.gestures.cancel(inst.context);
    this.instances.delete(inst.context);
    this.toPlugin(inst.plugin, { type: "disappear", context: inst.context, action: inst.action });
    if (!keep) forget(inst.context);
  }

  sync(profile: Profile, page: number) {
    const keys = profile.pages[page] ?? [];
    const next = new Map<string, Instance>();
    keys.forEach((key, slot) => {
      const found = externalAction(this.plugins, key.action);
      if (!found) return;
      const side = slot >= KEY_COUNT;
      const context = contextId(profile.id, page, slot, found.action.id);
      next.set(context, {
        context,
        profileId: profile.id,
        page,
        slot,
        plugin: found.plugin.id,
        action: found.action.id,
        controller: side ? "side" : "key",
        position: side ? { column: COLUMNS, row: slot - KEY_COUNT } : { column: slot % COLUMNS, row: Math.floor(slot / COLUMNS) },
      });
    });
    for (const inst of [...this.instances.values()]) if (!next.has(inst.context)) this.disappear(inst, inst.profileId !== profile.id || inst.page !== page);
    for (const inst of next.values()) if (!this.instances.has(inst.context)) this.appear(inst);
    const navigation = { type: "navigation", profile: { id: profile.id, name: profile.name }, page, pages: profile.pages.length };
    if (JSON.stringify(navigation) === JSON.stringify(this.navigation)) return;
    this.navigation = navigation;
    for (const id of this.realms.keys()) this.toPlugin(id, navigation);
  }

  contextAt(slot: number) {
    for (const inst of this.instances.values()) if (inst.slot === slot) return inst.context;
    return undefined;
  }

  present(key: KeyConfig, profileId: string, page: number, slot: number) {
    const found = externalAction(this.plugins, key.action);
    if (!found) return key;
    const context = contextId(profileId, page, slot, found.action.id);
    return present(this.devState.key(found.plugin.id, context, key), found.actionExt, context);
  }

  press(slot: number, down: boolean) {
    const context = this.contextAt(slot);
    const inst = context ? this.instances.get(context) : undefined;
    if (!inst || inst.controller !== "key") return false;
    const action = this.actionOf(inst);
    if (!this.keyOf(inst) || !action) return true;
    this.activity.set(inst.plugin, performance.now());
    this.toPlugin(inst.plugin, this.keyEvent(inst, down ? "keyDown" : "keyUp"));
    if (down) this.gestures.down(inst.context, action.gestures);
    else this.gestures.up(inst.context);
    return true;
  }

  patchSettings(context: string, patch: JsonObject) {
    const inst = this.instances.get(context);
    const key = inst && this.keyOf(inst);
    if (!inst || !key) return;
    const settings = { ...(key.ext?.settings ?? {}), ...patch };
    this.updateInstance(inst, (k) => ({ ...k, ext: { state: 0, ...k.ext, settings } }));
    this.toPlugin(inst.plugin, { ...this.keyEvent(inst, "settings"), settings });
  }

  connectInspector(context: string, frame: HTMLIFrameElement) {
    let link: InspectorLink | null = null;
    let loads = 0;
    let closed = false;
    const onLoad = () => {
      if (++loads > 1) close(true);
    };
    const onHello = (e: MessageEvent, tries = 0) => {
      if (closed || e.source !== frame.contentWindow || link || loads > 1) return;
      if ((e.data as { opensd?: string })?.opensd !== "hello") return;
      const inst = this.instances.get(context);
      if (!inst) {
        if (tries < 40) window.setTimeout(() => onHello(e, tries + 1), 50);
        return;
      }
      const key = this.keyOf(inst);
      const channel = new MessageChannel();
      link = { plugin: inst.plugin, port: channel.port1 };
      this.inspectors.set(context, link);
      channel.port1.onmessage = (m) => this.inspectorMessage(inst, m.data as Record<string, unknown>);
      frame.contentWindow?.postMessage(
        {
          opensd: "connect",
          context: {
            kind: "inspector",
            plugin: { id: inst.plugin, version: this.details(inst.plugin)?.manifest.version ?? "" },
            action: inst.action,
            context,
            settings: key?.ext?.settings ?? {},
            globals: this.globalsFor(inst.plugin),
            theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
            language: getLang(),
          },
        },
        "*",
        [channel.port2],
      );
      this.toPlugin(inst.plugin, this.keyEvent(inst, "inspectorOpen"));
    };
    const close = (navigated = false) => {
      closed = true;
      window.removeEventListener("message", onHello);
      frame.removeEventListener("load", onLoad);
      if (navigated) frame.src = "about:blank";
      if (!link) return;
      link.port.close();
      if (this.inspectors.get(context) === link) this.inspectors.delete(context);
      link = null;
      const current = this.instances.get(context);
      if (current) this.toPlugin(current.plugin, this.keyEvent(current, "inspectorClose"));
    };
    window.addEventListener("message", onHello);
    frame.addEventListener("load", onLoad);
    return () => close();
  }

  setTheme(theme: string) {
    for (const link of this.inspectors.values()) link.port.postMessage({ type: "theme", theme });
    for (const label of this.settingsWindows.values()) void emitTo(label, "opensd-settings-down", { type: "theme", theme });
  }

  private inspectorMessage(inst: Instance, m: Record<string, unknown>) {
    if (!this.instances.has(inst.context)) return;
    switch (m.type) {
      case "saveSettings":
        if (!isObject(m.settings)) return;
        this.updateInstance(inst, (k) => ({ ...k, ext: { state: 0, ...k.ext, settings: m.settings as JsonObject } }));
        this.toPlugin(inst.plugin, { ...this.keyEvent(inst, "settings"), settings: m.settings });
        return;
      case "saveGlobals":
        if (!isObject(m.settings)) return;
        this.globalsChanged(inst.plugin, m.settings, inst.context);
        return;
      case "send":
        this.activity.set(inst.plugin, performance.now());
        this.toPlugin(inst.plugin, { ...this.keyEvent(inst, "inspectorMessage"), payload: m.payload ?? null });
        return;
      case "openSettings":
        this.openSettingsPage(inst.plugin);
        return;
      case "openUrl":
        if (typeof m.url === "string") this.openUrl(inst.plugin, m.url, true);
        return;
    }
  }

  private globalsChanged(plugin: string, settings: JsonObject, fromContext?: string) {
    this.saveGlobals(plugin, settings);
    this.toPlugin(plugin, { type: "globals", settings });
    for (const [context, link] of this.inspectors) {
      if (link.plugin === plugin && context !== fromContext) link.port.postMessage({ type: "globals", settings });
    }
    const label = this.settingsWindows.get(plugin);
    if (label) void emitTo(label, "opensd-settings-down", { type: "globals", settings });
  }

  private settingsPageMessage(m: SettingsPageMessage) {
    const info = this.details(m.plugin);
    if (!info?.manifest.ui?.settings) return;
    switch (m.type) {
      case "hello":
        this.settingsWindows.set(m.plugin, m.label);
        void emitTo(m.label, "opensd-settings-down", {
          type: "context",
          context: {
            kind: "settings",
            plugin: { id: m.plugin, version: info.manifest.version },
            settings: {},
            globals: this.globalsFor(m.plugin),
            theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
            language: getLang(),
          },
          page: pluginFile(m.plugin, info.manifest.ui.settings, info.revision),
        });
        this.toPlugin(m.plugin, { type: "settingsPageOpen" });
        return;
      case "bye":
        if (this.settingsWindows.get(m.plugin) === m.label) {
          this.settingsWindows.delete(m.plugin);
          this.toPlugin(m.plugin, { type: "settingsPageClose" });
        }
        return;
      case "saveGlobals":
        if (isObject(m.settings)) this.globalsChanged(m.plugin, m.settings);
        return;
      case "send":
        this.activity.set(m.plugin, performance.now());
        this.toPlugin(m.plugin, { type: "settingsPageMessage", payload: m.payload ?? null });
        return;
      case "openUrl":
        if (typeof m.url === "string") this.openUrl(m.plugin, m.url, true);
        return;
    }
  }

  private openUrl(plugin: string, url: string, userAction: boolean) {
    const recent = performance.now() - (this.activity.get(plugin) ?? -Infinity) <= ACTIVITY_MS;
    if (!url.startsWith("https://") || (!userAction && !recent)) {
      void invoke("plugin_log", { id: plugin, level: "warn", message: `openUrl ignored: ${url.slice(0, 200)}` }).catch(() => undefined);
      return;
    }
    void invoke("plugin_open_url", { url }).catch((e) => log(`openUrl: ${e}`));
  }

  private remoteImage(plugin: string, context: string, url: string) {
    const key = `${plugin} ${url}`;
    const cached = this.images.get(key);
    if (cached) {
      this.images.delete(key);
      this.images.set(key, cached);
      return setImage(context, cached);
    }
    this.loading.set(context, url);
    invoke<string>("plugin_image", { id: plugin, url })
      .then((data) => {
        this.images.set(key, data);
        if (this.images.size > IMAGE_CACHE) this.images.delete(this.images.keys().next().value!);
        if (this.loading.get(context) !== url) return;
        this.loading.delete(context);
        setImage(context, data);
      })
      .catch((e) => {
        if (this.loading.get(context) === url) this.loading.delete(context);
        void invoke("plugin_log", { id: plugin, level: "warn", message: `setImage ${url.slice(0, 200)}: ${e}` }).catch(() => undefined);
      });
  }

  private command(id: string, c: Record<string, unknown>, session: number) {
    try {
      this.apply(id, c, session);
    } catch (e) {
      log(`plugin ${id}: command ${String(c.type)} failed: ${e}`);
    }
  }

  private apply(id: string, c: Record<string, unknown>, session: number) {
    const context = typeof c.context === "string" ? c.context : "";
    const inst = this.instances.get(context);
    const own = inst && inst.plugin === id ? inst : undefined;
    switch (c.type) {
      case "setTitle":
        if (!own) return;
        if (c.title !== null && typeof c.title !== "string") return;
        setTitle(own.context, c.title === null ? null : (c.title as string).slice(0, MAX_TITLE), titleStyle(c.style));
        return;
      case "setImage": {
        if (!own) return;
        const image = c.image;
        this.loading.delete(own.context);
        if (image === null) return setImage(own.context, null);
        if (typeof image !== "string") return;
        if (IMAGE_URL.test(image)) return this.remoteImage(id, own.context, image);
        if (image.startsWith("data:")) {
          if (image.length <= MAX_IMAGE * 1.4 && IMAGE_DATA.test(image)) setImage(own.context, image);
        } else if (safePath(image)) {
          setImage(own.context, pluginFile(id, image, this.details(id)?.revision ?? 0));
        }
        return;
      }
      case "setState": {
        if (!own) return;
        const states = Math.max(1, this.actionOf(own)?.states.length ?? 1);
        const state = Number(c.state);
        if (!Number.isInteger(state) || state < 0 || state >= states) return;
        this.updateInstance(own, (k) => ({ ...k, ext: { settings: {}, ...k.ext, state } }));
        return;
      }
      case "flash":
        if (own) flash(own.context, c.kind === "alert" ? "alert" : "ok");
        return;
      case "switchProfile":
      case "switchPage": {
        if (!this.details(id)?.granted || !this.details(id)?.manifest.permissions?.navigation) {
          void invoke("plugin_log", { id, level: "warn", message: `${c.type} ignored: the plugin has no navigation permission` }).catch(() => undefined);
          return;
        }
        const page = c.page == null ? null : Number(c.page);
        if (page !== null && (!Number.isInteger(page) || page < 0)) return;
        const profile = c.type === "switchProfile" ? String(c.profile ?? "").slice(0, 128) : null;
        if (this.binding && !this.binding.navigate(profile, page)) {
          void invoke("plugin_log", { id, level: "warn", message: `Profile not found: ${profile}` }).catch(() => undefined);
        }
        return;
      }
      case "setSettings":
        if (!own || !isObject(c.settings)) return;
        this.updateInstance(own, (k) => ({ ...k, ext: { state: 0, ...k.ext, settings: c.settings as JsonObject } }));
        this.inspectors.get(own.context)?.port.postMessage({ type: "settings", settings: c.settings });
        return;
      case "setGlobals":
        if (!isObject(c.settings)) return;
        this.saveGlobals(id, c.settings);
        for (const link of this.inspectors.values()) if (link.plugin === id) link.port.postMessage({ type: "globals", settings: c.settings });
        if (this.settingsWindows.has(id)) void emitTo(this.settingsWindows.get(id)!, "opensd-settings-down", { type: "globals", settings: c.settings });
        return;
      case "toInspector":
        if (own) this.inspectors.get(own.context)?.port.postMessage({ type: "message", payload: (c.payload ?? null) as Json });
        return;
      case "toSettingsPage": {
        const label = this.settingsWindows.get(id);
        if (label) void emitTo(label, "opensd-settings-down", { type: "message", payload: c.payload ?? null });
        return;
      }
      case "log": {
        const level = ["debug", "info", "warn", "error"].includes(String(c.level)) ? String(c.level) : "info";
        void invoke("plugin_log", { id, level, message: String(c.message ?? "").slice(0, 16384) }).catch(() => undefined);
        return;
      }
      case "openUrl":
        if (typeof c.url === "string") this.openUrl(id, c.url, false);
        return;
      case "http":
      case "wsOpen":
      case "wsSend":
      case "wsClose":
      case "appStatus":
      case "appWatch":
      case "appUnwatch":
      case "appLaunch":
      case "appQuit":
      case "clipboard":
      case "hotkey":
      case "typeText":
        if (typeof c.id !== "string" || !c.id || c.id.length > 128) return;
        void invoke("plugin_broker", { id, session, command: c }).catch((e) => {
          this.realms.get(id)?.send({ type: "denied", id: c.id, message: String(e) });
        });
        return;
      default:
        void invoke("plugin_log", { id, level: "debug", message: `Unknown command ${String(c.type).slice(0, 64)}` }).catch(() => undefined);
    }
  }
}

export const pluginHost = new PluginHostClient();

export function useExternalPlugins() {
  const [plugins, setPlugins] = useState(pluginHost.list);
  useEffect(() => pluginHost.subscribe(() => setPlugins(pluginHost.list)), []);
  return plugins;
}

import.meta.hot?.dispose(() => location.reload());
