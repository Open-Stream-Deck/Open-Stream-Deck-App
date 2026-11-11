import type { ActionRef, KeyConfig } from "../types";
import { isWidgetKind, widgetPlugin } from "./catalog";
import type { PageInfo, WidgetEnv } from "./draw";

export function widgetKind(action: ActionRef | null) {
  return action && isWidgetKind(action.actionId) && widgetPlugin(action.actionId) === action.pluginId ? action.actionId : null;
}

export function keyWidget(key: KeyConfig) {
  return widgetKind(key.action);
}

export function keyWidgetId(profileId: string, page: number, index: number) {
  return `key:${profileId}:${page}:${index}`;
}

export function keyEnv(key: KeyConfig, id: string, page: PageInfo, pressed: boolean): WidgetEnv | null {
  const kind = keyWidget(key);
  if (!kind) return null;
  return { id, kind, settings: key.settings, label: "", pressed, page, t: performance.now(), now: new Date() };
}
