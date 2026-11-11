import { anyEffect, drawWithEffects, hasEffect } from "./effects";
import { patches } from "./patches";
import { Commands } from "./protocol";
import { canvas, native } from "./render";
import type { Rect } from "./layout";
import { takeRolling } from "../widgets/draw";
import { SCREEN, STAGE } from "./layout";

export type Surface = {
  id: string;
  rect: Rect;
  w: number;
  h: number;
  live: boolean;
  draw: (ctx: CanvasRenderingContext2D) => void;
};

const TICK_MS = 33;
const EFFECT_TICK_MS = 16;
const LIVE_EVERY = 2;
const BUDGET_BYTES_PER_S = 1_600_000;
const HOLD_LIMIT_MS = 1000;

let surfaces: Surface[] = [];
const sent = new Map<string, number>();
const onScreen = new Map<string, Uint8Array>();
const screen = new Map<string, HTMLCanvasElement>();
const canvases = new Map<string, CanvasRenderingContext2D>();
let running = false;
let sender: ((cmd: Commands) => Promise<void>) | null = null;
let isConnected: () => boolean = () => false;
const history: { at: number; bytes: number }[] = [];

export const animatorStats = { fps: 0, bytesPerSecond: 0 };

let staged = false;
let heldUntil = 0;
let heldFor = "";

export function setStaged(on: boolean) {
  staged = on;
}

export function present(cmd: Commands, rects: Rect[]) {
  cmd.vsync();
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) cmd.copy(STAGE, r.x, r.y, SCREEN, r.x, r.y, r.w, r.h);
}

export function setSurfaces(next: Surface[]) {
  surfaces = next;
}

export function invalidate() {
  sent.clear();
  onScreen.clear();
}

export function setScreen(id: string, image: HTMLCanvasElement) {
  onScreen.delete(id);
  sent.delete(id);
  remember(id, image);
}

export function holdScreen(view: string) {
  heldFor = view;
  heldUntil = performance.now() + HOLD_LIMIT_MS;
}

export function releaseScreen(view?: string) {
  if (view === undefined || view === heldFor) heldUntil = 0;
}

export function capture(id: string) {
  const s = surfaces.find((s) => s.id === id);
  if (!s) return null;
  const ctx = context(id, s.w, s.h);
  ctx.save();
  try {
    s.draw(ctx);
  } finally {
    ctx.restore();
  }
  const rgba = ctx.getImageData(0, 0, s.w, s.h).data;
  const pixels = native(rgba, s.w, s.h);
  sent.set(id, fnv(rgba));
  onScreen.set(id, pixels);
  remember(id, ctx.canvas);
  return { rect: s.rect, pixels };
}

export function screenImage(id: string) {
  return screen.get(id);
}

function fnv(bytes: Uint8ClampedArray) {
  let h = 0x811c9dc5;
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2);
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193);
  return h >>> 0;
}

function context(id: string, w: number, h: number) {
  let ctx = canvases.get(id);
  if (!ctx || ctx.canvas.width !== w || ctx.canvas.height !== h) {
    ctx = canvas(w, h).ctx;
    canvases.set(id, ctx);
  }
  return ctx;
}

function remember(id: string, source: HTMLCanvasElement) {
  let c = screen.get(id);
  if (c === source) return;
  if (!c || c.width !== source.width || c.height !== source.height || canvases.get(id)?.canvas === c) {
    c = canvas(source.width, source.height).c;
  }
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0);
  screen.set(id, c);
}

export function recordBytes(bytes: number) {
  history.push({ at: performance.now(), bytes });
}

function spentLastSecond(now: number) {
  while (history.length && now - history[0].at > 1000) history.shift();
  return history.reduce((sum, h) => sum + h.bytes, 0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startAnimator(send: (cmd: Commands) => Promise<void>, connected: () => boolean) {
  sender = send;
  isConnected = connected;
  if (running) return;
  running = true;
  (async () => {
    let frames = 0;
    let tick = 0;
    let windowStart = performance.now();
    const rolling = new Set<string>();
    for (;;) {
      const start = performance.now();
      const liveTick = tick++ % LIVE_EVERY === 0;
      if (!isConnected() || !surfaces.length) {
        await sleep(200);
        continue;
      }
      if (start < heldUntil) {
        await sleep(EFFECT_TICK_MS);
        continue;
      }
      const overBudget = spentLastSecond(start) > BUDGET_BYTES_PER_S;
      const cmd = new Commands().canvas(staged ? STAGE : SCREEN);
      const before = cmd.length;
      const shown: { id: string; ctx: CanvasRenderingContext2D; pixels: Uint8Array }[] = [];
      const touched: Rect[] = [];
      for (const s of surfaces) {
        const effect = hasEffect(s.id);
        if (!effect && (!s.live || !(liveTick || rolling.has(s.id)) || overBudget)) continue;
        const ctx = context(s.id, s.w, s.h);
        takeRolling();
        ctx.save();
        try {
          drawWithEffects(s.id, ctx, s.w, s.h, s.draw, start);
        } catch {
          continue;
        } finally {
          ctx.restore();
        }
        if (takeRolling()) rolling.add(s.id);
        else rolling.delete(s.id);
        const rgba = ctx.getImageData(0, 0, s.w, s.h).data;
        const hash = fnv(rgba);
        if (sent.get(s.id) === hash) continue;
        sent.set(s.id, hash);
        const pixels = native(rgba, s.w, s.h);
        for (const p of patches(onScreen.get(s.id), pixels, s.rect.w, s.rect.h)) {
          const rect = { x: s.rect.x + p.x, y: s.rect.y + p.y, w: p.w, h: p.h };
          cmd.blit(rect.x, rect.y, rect.w, rect.h, p.pixels);
          touched.push(rect);
        }
        shown.push({ id: s.id, ctx, pixels });
      }
      if (cmd.length > before) {
        if (staged) present(cmd, touched);
        try {
          await sender!(cmd);
          shown.forEach(({ id, ctx, pixels }) => {
            remember(id, ctx.canvas);
            onScreen.set(id, pixels);
          });
          frames++;
        } catch {
          invalidate();
        }
      }
      const now = performance.now();
      if (now - windowStart >= 1000) {
        animatorStats.fps = Math.round((frames * 1000) / (now - windowStart));
        animatorStats.bytesPerSecond = spentLastSecond(now);
        frames = 0;
        windowStart = now;
      }
      await sleep(Math.max(4, (rolling.size || anyEffect() ? EFFECT_TICK_MS : TICK_MS) - (now - start)));
    }
  })();
}

import.meta.hot?.dispose(() => location.reload());
