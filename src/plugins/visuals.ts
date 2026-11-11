import { useEffect, useRef, useState } from "preact/hooks";
import type { ExternalAction, KeyConfig, PluginTitleStyle } from "../types";

const FLASH_MS = 1500;

type Visual = {
  stamp: number;
  image?: string;
  title?: string;
  style?: PluginTitleStyle;
  badge?: "ok" | "alert";
  badgeTimer?: number;
};

const PREVIEW_MS = 33;

const visuals = new Map<string, Visual>();
const listeners = new Set<() => void>();
const deckListeners = new Set<() => void>();
let scheduled = false;
let lastPreview = 0;
let previewTimer = 0;

function notifyPreview() {
  previewTimer = 0;
  lastPreview = performance.now();
  listeners.forEach((fn) => fn());
}

function changed(context?: string) {
  const v = context ? visuals.get(context) : undefined;
  if (v) v.stamp++;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    deckListeners.forEach((fn) => fn());
    if (!previewTimer) previewTimer = window.setTimeout(notifyPreview, Math.max(0, lastPreview + PREVIEW_MS - performance.now()));
  });
}

export function onVisualChange(fn: () => void) {
  deckListeners.add(fn);
  return () => void deckListeners.delete(fn);
}

export function invalidateVisuals() {
  changed();
}

function visual(context: string) {
  let v = visuals.get(context);
  if (!v) {
    v = { stamp: 0 };
    visuals.set(context, v);
  }
  return v;
}

export function setImage(context: string, image: string | null) {
  visual(context).image = image ?? undefined;
  changed(context);
}

export function setTitle(context: string, title: string | null, style?: PluginTitleStyle) {
  const v = visual(context);
  v.title = title ?? undefined;
  if (style) v.style = style;
  else if (title === null) v.style = undefined;
  changed(context);
}

export function flash(context: string, badge: "ok" | "alert") {
  const v = visual(context);
  clearTimeout(v.badgeTimer);
  v.badge = badge;
  v.badgeTimer = window.setTimeout(() => {
    v.badge = undefined;
    changed(context);
  }, FLASH_MS);
  changed(context);
}

export function forget(context: string) {
  const v = visuals.get(context);
  if (!v) return;
  clearTimeout(v.badgeTimer);
  visuals.delete(context);
  cache.delete(context);
  changed();
}

export function useLive<T>(read: () => T) {
  const value = read();
  const latest = useRef({ read, value });
  latest.current = { read, value };
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => {
      if (latest.current.read() !== latest.current.value) tick((n) => n + 1);
    };
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return value;
}

const cache = new Map<string, { key: KeyConfig; action: ExternalAction; stamp: number; shown: KeyConfig }>();

export function present(key: KeyConfig, action: ExternalAction, context: string): KeyConfig {
  const v = visuals.get(context);
  const stamp = v?.stamp ?? -1;
  const hit = cache.get(context);
  if (hit && hit.key === key && hit.action === action && hit.stamp === stamp) return hit.shown;
  const shown = compose(key, action, v);
  cache.set(context, { key, action, stamp, shown });
  return shown;
}

function compose(key: KeyConfig, action: ExternalAction, v: Visual | undefined): KeyConfig {
  const state = Math.min(key.ext?.state ?? 0, Math.max(0, action.states.length - 1));
  const spec = action.states[state];
  const image = v?.image ?? key.image ?? spec?.image ?? null;
  const userTitle = key.title.trim() !== "";
  const pluginTitle = v?.title ?? (spec?.showTitle === false ? "" : (spec?.title ?? ""));
  const style = v?.style;
  const titleStyle = style && !userTitle
    ? {
        ...key.titleStyle,
        position: style.align ?? key.titleStyle.position,
        size: style.size ?? key.titleStyle.size,
        color: style.color ?? key.titleStyle.color,
        bold: style.bold ?? key.titleStyle.bold,
      }
    : key.titleStyle;
  const backdrop = v?.image && key.image ? key.image : null;
  return { ...key, image, backdrop, title: userTitle ? key.title : pluginTitle, titleStyle, badge: v?.badge };
}
