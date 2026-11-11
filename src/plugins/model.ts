import type { Action, ActionRef, ExternalAction, Field, JsonObject, Permission, Plugin, PluginTitleStyle } from "../types";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

type ManifestField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "toggle" | "color";
  placeholder?: string;
  hint?: string;
  default?: unknown;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
};

type ManifestAction = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  controllers?: ("key" | "side")[];
  inspector?: string;
  fields?: ManifestField[];
  settings?: JsonObject;
  states?: { image?: string; title?: string; show_title?: boolean }[];
  title?: PluginTitleStyle & { align?: "top" | "middle" | "bottom" };
  gestures?: { long_press?: number; hold?: number; repeat?: number };
};

export type Manifest = {
  sdk: number;
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  homepage?: string;
  license?: string;
  icon?: string;
  runtime: { type: "wasm" | "js"; main: string };
  ui?: { inspector?: string; settings?: string };
  permissions?: { loopback?: string[]; network?: string[]; clipboard?: boolean; launch?: unknown[]; keyboard?: boolean; navigation?: boolean };
  actions: ManifestAction[];
};

export type PluginInfo = {
  id: string;
  manifest: Manifest;
  dev: boolean;
  revision: number;
  permissions: Permission[];
  digest: string;
  granted: boolean;
};

export function pluginFile(dir: string, rel: string, revision = 0) {
  const path = `${dir}/${rel}`.split("/").map(encodeURIComponent).join("/");
  const base = isTauri() ? convertFileSrc("", "osd-plugin") : "http://osd-plugin.localhost/";
  return `${base}${path}${revision ? `?v=${revision}` : ""}`;
}

function toField(field: ManifestField): Field {
  const value = field.default;
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    placeholder: field.placeholder,
    hint: field.hint,
    options: field.options,
    defaultValue: value === undefined || value === null ? undefined : String(value),
    min: field.min,
    max: field.max,
    step: field.step,
  };
}

function toAction(info: PluginInfo, a: ManifestAction): Action {
  const file = (rel?: string) => (rel ? pluginFile(info.id, rel, info.revision) : undefined);
  const states = a.states?.length ? a.states : [{}];
  const ext: ExternalAction = {
    uuid: a.id,
    icon: file(a.icon) ?? file(states[0].image),
    states: states.map((s) => ({ image: file(s.image), title: s.title, showTitle: s.show_title })),
    controllers: a.controllers?.length ? a.controllers : ["key"],
    inspector: a.inspector ?? info.manifest.ui?.inspector,
    fields: (a.fields ?? []).map(toField),
    title: a.title,
    gestures: a.gestures,
    defaults: a.settings ?? {},
  };
  return { id: a.id, name: a.name, description: a.description || a.name, ext };
}

export function toPlugin(info: PluginInfo): Plugin {
  const m = info.manifest;
  return {
    id: info.id,
    name: m.name,
    version: m.version,
    description: m.description ?? "",
    actions: m.actions.map((a) => toAction(info, a)),
    ext: {
      id: info.id,
      dir: info.id,
      runtime: m.runtime.type,
      author: m.author,
      icon: m.icon ? pluginFile(info.id, m.icon, info.revision) : undefined,
      homepage: m.homepage,
      license: m.license,
      settingsPage: m.ui?.settings,
      permissions: info.permissions,
      granted: info.granted,
      dev: info.dev,
    },
  };
}

export function fitsKey(action: ExternalAction) {
  return action.controllers.includes("key");
}

export function fitsSide(action: ExternalAction) {
  return action.controllers.includes("side");
}

export function externalAction(plugins: Plugin[], ref: ActionRef | null) {
  if (!ref) return undefined;
  const plugin = plugins.find((p) => p.id === ref.pluginId);
  const action = plugin?.ext ? plugin.actions.find((a) => a.id === ref.actionId) : undefined;
  return plugin?.ext && action?.ext ? { plugin, pluginExt: plugin.ext, action, actionExt: action.ext } : undefined;
}

export function formSettings(action: ExternalAction, settings: JsonObject) {
  const out: Record<string, string | boolean> = {};
  for (const field of action.fields) {
    const value = settings[field.id];
    if (typeof value === "boolean") out[field.id] = value;
    else if (value !== undefined && value !== null) out[field.id] = String(value);
    else if (field.type === "toggle") out[field.id] = field.defaultValue === "true";
    else if (field.defaultValue !== undefined) out[field.id] = field.defaultValue;
  }
  return out;
}

export function fieldValue(action: ExternalAction, id: string, value: string | boolean) {
  const field = action.fields.find((f) => f.id === id);
  if (field?.type === "number" && typeof value === "string") {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return null;
    const clamped = Math.min(field.max ?? n, Math.max(field.min ?? n, n));
    return clamped;
  }
  return value;
}
