import type { JsonObject, KeyConfig } from "../types";

export class DevState {
  private active = new Set<string>();
  private keys = new Map<string, { plugin: string; key: KeyConfig }>();
  private merged = new Map<string, { fallback: KeyConfig; ext: KeyConfig["ext"]; key: KeyConfig }>();
  private globals = new Map<string, JsonObject>();

  setActive(plugins: string[]) {
    this.active = new Set(plugins);
    for (const [context, value] of this.keys) if (!this.active.has(value.plugin)) this.keys.delete(context);
    this.merged.clear();
    for (const id of this.globals.keys()) if (!this.active.has(id)) this.globals.delete(id);
  }

  key(plugin: string, context: string, fallback: KeyConfig): KeyConfig {
    const value = this.active.has(plugin) ? this.keys.get(context) : undefined;
    if (!value) return fallback;
    const hit = this.merged.get(context);
    if (hit && hit.fallback === fallback && hit.ext === value.key.ext) return hit.key;
    const key = { ...fallback, ext: value.key.ext };
    this.merged.set(context, { fallback, ext: value.key.ext, key });
    return key;
  }

  setKey(plugin: string, context: string, key: KeyConfig): boolean {
    if (!this.active.has(plugin)) return false;
    this.keys.set(context, { plugin, key: structuredClone(key) });
    this.merged.delete(context);
    return true;
  }

  global(plugin: string, fallback: JsonObject): JsonObject {
    return this.active.has(plugin) ? this.globals.get(plugin) ?? fallback : fallback;
  }

  setGlobal(plugin: string, settings: JsonObject): boolean {
    if (!this.active.has(plugin)) return false;
    this.globals.set(plugin, structuredClone(settings));
    return true;
  }
}
