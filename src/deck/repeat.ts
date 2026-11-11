import { invoke } from "@tauri-apps/api/core";
import type { KeySettings } from "../types";
import { log, runAction } from "./link";

const HOLD_MS = 400;
const VOLUME_EVERY_MS = 150;
const VOLUME_FASTEST_MS = 40;
const VOLUME_ACCEL = 0.85;
const SEEK_EVERY_MS = 250;
const SEEK_SECONDS = 5;

type Repeat = { tap: () => void; step: () => void; every: number; fastest: number; accel: number; tapFirst: boolean };

const held = new Map<number, { timer: number; repeated: boolean; repeat: Repeat }>();

export function mediaRepeat(actionId: string, settings: KeySettings, fail: (e: unknown) => void): Repeat | null {
  const run = () => void runAction("media", actionId, settings).catch(fail);
  const seek = (seconds: number) => () => void invoke("media_seek", { seconds }).catch((e) => log(`seek: ${e}`));
  switch (actionId) {
    case "volume-up":
    case "volume-down":
      return { tap: run, step: run, every: VOLUME_EVERY_MS, fastest: VOLUME_FASTEST_MS, accel: VOLUME_ACCEL, tapFirst: true };
    case "next":
      return { tap: run, step: seek(SEEK_SECONDS), every: SEEK_EVERY_MS, fastest: SEEK_EVERY_MS, accel: 1, tapFirst: false };
    case "prev":
      return { tap: run, step: seek(-SEEK_SECONDS), every: SEEK_EVERY_MS, fastest: SEEK_EVERY_MS, accel: 1, tapFirst: false };
    default:
      return null;
  }
}

export function releaseRepeats() {
  held.forEach((entry) => clearTimeout(entry.timer));
  held.clear();
}

export function repeatKey(index: number, down: boolean, repeat: Repeat | null) {
  const current = held.get(index);
  if (current) {
    clearTimeout(current.timer);
    held.delete(index);
    if (!down && !current.repeated && !current.repeat.tapFirst) current.repeat.tap();
  }
  if (!down || !repeat) return;
  if (repeat.tapFirst) repeat.tap();
  const entry = { timer: 0, repeated: false, repeat };
  const tick = (delay: number, next: number) => {
    entry.timer = window.setTimeout(() => {
      entry.repeated = true;
      repeat.step();
      tick(next, Math.max(repeat.fastest, next * repeat.accel));
    }, delay);
  };
  tick(HOLD_MS, repeat.every);
  held.set(index, entry);
}
