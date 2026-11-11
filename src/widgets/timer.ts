import type { KeySettings } from "../types";
import { FALLBACK_SOUND, parseOffset, playSound, type SoundSpec } from "./sounds";

const RESET_HOLD_MS = 600;
const DEFAULT_MINUTES = 5;
const MAX_MINUTES = 999;
const DEFAULT_VOLUME = 75;

export type TimerOptions = { total: number; sound: SoundSpec; volume: number; repeat: boolean; pressReset: boolean; autoReset: number };

export function timerTotal(settings: KeySettings) {
  const minutes = Number(settings.minutes);
  return (minutes >= 1 ? Math.min(minutes, MAX_MINUTES) : DEFAULT_MINUTES) * 60_000;
}

export function timerOptions(settings: KeySettings): TimerOptions {
  return {
    total: timerTotal(settings),
    sound: {
      name: typeof settings.sound === "string" ? settings.sound : FALLBACK_SOUND,
      file: typeof settings.soundFile === "string" ? settings.soundFile : "",
      offset: parseOffset(settings.soundStart),
    },
    volume: Number(settings.volume ?? DEFAULT_VOLUME) / 100,
    repeat: settings.repeat === true,
    pressReset: settings.pressReset !== false,
    autoReset: Number(settings.autoReset ?? 0) * 1000,
  };
}

type Run = {
  started: number | null;
  spent: number;
  hold: number;
  held: boolean;
  finish: number;
  autoReset: number;
  silence: () => void;
};

const runs = new Map<string, Run>();

function run(id: string) {
  let r = runs.get(id);
  if (!r) {
    r = { started: null, spent: 0, hold: 0, held: false, finish: 0, autoReset: 0, silence: () => undefined };
    runs.set(id, r);
  }
  return r;
}

const elapsed = (r: Run, now: number) => r.spent + (r.started === null ? 0 : now - r.started);

export function timerState(id: string, total: number, now: number) {
  const r = run(id);
  const left = Math.max(0, total - elapsed(r, now));
  return { left, running: r.started !== null && left > 0, fresh: r.started === null && r.spent === 0, done: left === 0 };
}

function reset(r: Run) {
  clearTimeout(r.finish);
  clearTimeout(r.autoReset);
  r.silence();
  r.started = null;
  r.spent = 0;
}

function ring(r: Run, o: TimerOptions) {
  r.silence = playSound(o.sound, o.volume, o.repeat);
  if (o.autoReset) r.autoReset = window.setTimeout(() => reset(r), o.autoReset);
}

export function pruneTimers(live: Set<string>) {
  for (const [id, r] of runs) {
    if (live.has(id)) continue;
    clearTimeout(r.hold);
    reset(r);
    runs.delete(id);
  }
}

export function timerPress(id: string, down: boolean, o: TimerOptions) {
  const r = run(id);
  const now = performance.now();
  if (down) {
    r.held = false;
    clearTimeout(r.hold);
    r.hold = window.setTimeout(() => {
      r.held = true;
      reset(r);
    }, RESET_HOLD_MS);
    return;
  }
  clearTimeout(r.hold);
  if (r.held) return;
  if (elapsed(r, now) >= o.total) {
    if (o.pressReset) reset(r);
    else r.silence();
  } else if (r.started === null) {
    r.started = now;
    r.finish = window.setTimeout(() => ring(r, o), o.total - r.spent);
  } else {
    clearTimeout(r.finish);
    r.spent = elapsed(r, now);
    r.started = null;
  }
}

export function countdownTarget(text: string, now: Date) {
  const m = text.trim().match(/^(?:(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?)?\s*(?:(\d{1,2}):(\d{2}))?$/);
  if (!m || (!m[1] && !m[4])) return null;
  const d = new Date(now);
  if (m[1]) d.setFullYear(m[3] ? Number(m[3].padStart(4, "20")) : now.getFullYear(), Number(m[2]) - 1, Number(m[1]));
  d.setHours(Number(m[4] ?? 0), Number(m[5] ?? 0), 0, 0);
  if (!m[3] && d <= now) {
    if (m[1]) d.setFullYear(d.getFullYear() + 1);
    else d.setDate(d.getDate() + 1);
  }
  return d;
}
