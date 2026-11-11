import { canvas } from "./render";

type Change = { from: HTMLCanvasElement; at: number };
type Press = { down: boolean; downAt: number; upAt: number };
type Fx = { change?: Change; press?: Press };

const CHANGE_MS = 320;
const RING_IN_MS = 240;
const RING_OUT_MS = 280;
const RING_FROM = 10;
const RING_WIDTH = 3;
const RING_RADIUS = 10;

const fx = new Map<string, Fx>();
const scratch = new Map<string, HTMLCanvasElement>();

function canvasFor(key: string, w: number, h: number) {
  let c = scratch.get(key);
  if (!c || c.width !== w || c.height !== h) {
    c = canvas(w, h).c;
    scratch.set(key, c);
  }
  return c;
}

function entry(id: string) {
  let e = fx.get(id);
  if (!e) {
    e = {};
    fx.set(id, e);
  }
  return e;
}

export function startChange(id: string, from: HTMLCanvasElement) {
  const running = fx.get(id)?.change;
  if (running && performance.now() - running.at < CHANGE_MS) return;
  const copy = canvas(from.width, from.height);
  copy.ctx.drawImage(from, 0, 0);
  entry(id).change = { from: copy.c, at: performance.now() };
}

export function cancelChange(id: string) {
  const e = fx.get(id);
  if (!e) return;
  delete e.change;
  if (!e.press) fx.delete(id);
}

export function pressEffect(id: string, down: boolean) {
  const e = entry(id);
  const now = performance.now();
  if (down) e.press = { down: true, downAt: now, upAt: 0 };
  else if (e.press) e.press = { ...e.press, down: false, upAt: now };
}

export function anyEffect() {
  return fx.size > 0;
}

export function hasEffect(id: string) {
  return fx.has(id);
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

function ring(p: Press, now: number) {
  const grow = easeOut(Math.min(1, (now - p.downAt) / RING_IN_MS));
  const fade = p.down ? 1 : 1 - easeOut(Math.min(1, (now - p.upAt) / RING_OUT_MS));
  const edge = RING_WIDTH / 2;
  return { inset: RING_FROM + (edge - RING_FROM) * grow, alpha: Math.min(1, grow * 2) * fade };
}

export function drawWithEffects(
  id: string,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  content: (ctx: CanvasRenderingContext2D) => void,
  now = performance.now(),
) {
  const e = fx.get(id);
  if (!e) {
    content(ctx);
    return false;
  }
  const layer = canvasFor(`${id}:layer`, w, h);
  const lc = layer.getContext("2d")!;
  lc.save();
  content(lc);
  lc.restore();

  let running = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  let base: HTMLCanvasElement = layer;
  if (e.change) {
    const t = Math.min(1, (now - e.change.at) / CHANGE_MS);
    if (t < 1) {
      running = true;
      const mixed = canvasFor(`${id}:mix`, w, h);
      const mc = mixed.getContext("2d")!;
      mc.fillStyle = "#000";
      mc.fillRect(0, 0, w, h);
      const k = easeOut(t);
      const out = 1 - 0.14 * k;
      mc.globalAlpha = 1 - k;
      mc.drawImage(e.change.from, (w * (1 - out)) / 2, (h * (1 - out)) / 2, w * out, h * out);
      const inn = 0.86 + 0.14 * k;
      mc.globalAlpha = k;
      mc.drawImage(layer, (w * (1 - inn)) / 2, (h * (1 - inn)) / 2, w * inn, h * inn);
      mc.globalAlpha = 1;
      base = mixed;
    } else delete e.change;
  }

  ctx.drawImage(base, 0, 0);
  const p = e.press;
  if (p && !p.down && now - p.upAt >= RING_OUT_MS) delete e.press;
  if (e.press && p) {
    running = true;
    const { inset, alpha } = ring(p, now);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = RING_WIDTH;
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, RING_RADIUS);
    ctx.stroke();
  }

  if (!running) fx.delete(id);
  return running;
}
