import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";

export type DiskStat = { id: string; name: string; used: number; total: number };
export type GpuStat = { id: string; name: string; load: number; mem_used: number; mem_total: number };

export type Stats = {
  cpu: number;
  cores: number[];
  ram_used: number;
  ram_total: number;
  net_down: number;
  net_up: number;
  disks: DiskStat[];
  gpus: GpuStat[];
  uptime: number;
};

export const PERIOD_MS = 2000;
export const HISTORY = 30;
const LEAD_MS = 200;
const IDLE_MS = 10_000;
let read = 0;

type Snapshot = {
  at: number;
  stats: Stats;
  cpu: number[];
  ram: number[];
  down: number[];
  up: number[];
  gpu: Record<string, number[]>;
};

let current: Snapshot | null = null;
let pending: Snapshot | null = null;

function fake(): Stats {
  const t = Date.now() / 1000;
  const cores = Array.from({ length: 8 }, (_, i) => Math.max(2, 25 + 20 * Math.sin(t * 0.7 + i) + 10 * Math.random()));
  return {
    cpu: cores.reduce((a, b) => a + b, 0) / cores.length,
    cores,
    ram_used: (9.4 + 0.6 * Math.sin(t / 9)) * 2 ** 30,
    ram_total: 16 * 2 ** 30,
    net_down: Math.max(0, 1.5e6 * (1 + Math.sin(t / 4)) * Math.random()),
    net_up: Math.max(0, 2.5e5 * Math.random()),
    disks: [
      { id: "C:\\", name: "Windows", used: 310 * 2 ** 30, total: 476 * 2 ** 30 },
      { id: "D:\\", name: "Games", used: 1.2 * 2 ** 40, total: 1.8 * 2 ** 40 },
    ],
    gpus: [
      {
        id: "gpu0",
        name: "NVIDIA GeForce RTX 4070",
        load: Math.max(0, 40 + 30 * Math.sin(t / 3)),
        mem_used: 5.2 * 2 ** 30,
        mem_total: 12 * 2 ** 30,
      },
    ],
    uptime: 3600 * 27 + Math.floor(t % 3600),
  };
}

function append(list: number[] | undefined, v: number) {
  const next = [...(list ?? []), v];
  return next.length > HISTORY ? next.slice(next.length - HISTORY) : next;
}

async function sample() {
  try {
    const stats = "__TAURI_INTERNALS__" in window ? await invoke<Stats>("system_stats") : fake();
    const base = pending ?? current;
    pending = {
      at: Math.ceil(Date.now() / PERIOD_MS) * PERIOD_MS,
      stats,
      cpu: append(base?.cpu, stats.cpu),
      ram: append(base?.ram, stats.ram_total ? (stats.ram_used / stats.ram_total) * 100 : 0),
      down: append(base?.down, stats.net_down),
      up: append(base?.up, stats.net_up),
      gpu: Object.fromEntries(stats.gpus.map((g) => [g.id, append(base?.gpu[g.id], g.load)])),
    };
  } catch {
  }
}

function schedule() {
  const now = Date.now();
  const next = Math.ceil((now + LEAD_MS + 1) / PERIOD_MS) * PERIOD_MS - LEAD_MS;
  window.setTimeout(async () => {
    if (Date.now() - read < IDLE_MS) await sample();
    schedule();
  }, next - now);
}

let started = false;
export function startStats() {
  if (started) return;
  started = true;
  sample().then(() => {
    current = pending;
    pending = null;
  });
  schedule();
}

export function stats(now = Date.now()) {
  read = Date.now();
  if (pending && pending.at <= now) {
    current = pending;
    pending = null;
  }
  return current;
}

export const driveLetter = (id: string) => id.replace(/\\$/, "");

export function pick<T extends { id: string }>(list: T[], id: unknown) {
  return list.find((item) => item.id === id) ?? list[0];
}

export function formatRate(bytes: number) {
  if (bytes >= 1e9) return { value: (bytes / 1e9).toFixed(1), unit: t("widget.unit.gbps") };
  if (bytes >= 1e6) return { value: (bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1), unit: t("widget.unit.mbps") };
  if (bytes >= 1e3) return { value: (bytes / 1e3).toFixed(0), unit: t("widget.unit.kbps") };
  return { value: String(Math.round(bytes)), unit: t("widget.unit.bps") };
}

export function formatGb(bytes: number) {
  const gb = bytes / 2 ** 30;
  return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1);
}

import.meta.hot?.dispose(() => location.reload());
