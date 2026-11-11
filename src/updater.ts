import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "preact/hooks";
import { isTauri } from "./deck/link";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "failed"; error: string };

let state: UpdateState = { kind: "idle" };
const listeners = new Set<(state: UpdateState) => void>();

function set(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener(next);
}

export function useUpdate() {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

export async function checkForUpdate() {
  if (!isTauri() || state.kind === "checking" || state.kind === "downloading") return;
  set({ kind: "checking" });
  try {
    const version = await invoke<string | null>("update_check");
    set(version ? { kind: "available", version } : { kind: "latest" });
  } catch (e) {
    set({ kind: "failed", error: String(e) });
  }
}

export async function installUpdate() {
  if (state.kind !== "available") return;
  const version = state.version;
  set({ kind: "downloading", version, percent: 0 });
  let unlisten = () => {};
  try {
    unlisten = await listen<number>("update://progress", (e) => set({ kind: "downloading", version, percent: e.payload }));
    await invoke("update_install");
  } catch (e) {
    set({ kind: "failed", error: String(e) });
  } finally {
    unlisten();
  }
}
