import { invoke } from "@tauri-apps/api/core";
import { actionLost, fontCss, findAction } from "../data";
import type { KeyConfig, Plugin } from "../types";
import { drawWidget, type WidgetEnv } from "../widgets/draw";
import { actionGlyphUrl } from "../components/ui/pluginIcons";
import { KEY_SIZE } from "./layout";
import { deckStyle, roundCorners } from "./style";

const SCALE = KEY_SIZE / 74;
const LOST_FONT = `"Segoe UI", Inter, system-ui, sans-serif`;
const LOST_COLOR = "#5f6168";
const rasterSize = () => 2 * Math.ceil(Math.max(KEY_SIZE, 74 * devicePixelRatio));

const PLUGIN_COLORS: Record<string, string> = {
  system: "#4f8cff",
  media: "#ff6b8b",
  navigation: "#3ecf8e",
};

export type Picture = HTMLImageElement | ImageBitmap;
type Entry = { promise: Promise<Picture>; img?: Picture };

const images = new Map<string, Entry>();
const frames = new Map<string, Entry>();
const IMAGE_CACHE = 300;
const FRAME_CACHE = 64;
const SVG = /^data:image\/svg\+xml|\.svg(?:[?#]|$)/i;
const SVG_DATA = /^data:image\/svg\+xml/i;

async function raster(src: string) {
  const data = await invoke<ArrayBuffer>("svg_raster", { src, size: rasterSize() });
  const head = new DataView(data, 0, 8);
  return createImageBitmap(new ImageData(new Uint8ClampedArray(data, 8), head.getUint32(0, true), head.getUint32(4, true)));
}

function decode(src: string): Promise<Picture> {
  if (SVG_DATA.test(src) && "__TAURI_INTERNALS__" in window) return raster(src).catch(() => element(src));
  return element(src);
}

async function element(src: string): Promise<Picture> {
  const img = new Image();
  if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!SVG.test(src) || !w || !h) return img;
  const k = Math.max(1, rasterSize() / Math.max(w, h));
  const flat = canvas(Math.round(w * k), Math.round(h * k));
  flat.ctx.drawImage(img, 0, 0, flat.c.width, flat.c.height);
  return createImageBitmap(flat.c);
}

function cached(src: string, frame = false) {
  const cache = frame ? frames : images;
  let entry = cache.get(src);
  if (!entry) {
    const promise = decode(src).then((img) => {
      const e = cache.get(src);
      if (e) e.img = img;
      return img;
    });
    promise.catch(() => undefined);
    entry = { promise };
    cache.set(src, entry);
    if (cache.size > (frame ? FRAME_CACHE : IMAGE_CACHE)) cache.delete(cache.keys().next().value!);
  }
  return entry;
}

export function loadImage(src: string, frame = false) {
  return cached(src, frame).promise;
}

export function pictureSize(img: Picture) {
  return img instanceof HTMLImageElement ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };
}

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return { c, ctx };
}

export function toNative(ctx: CanvasRenderingContext2D, w: number, h: number) {
  return native(ctx.getImageData(0, 0, w, h).data, w, h);
}

export function native(rgba: Uint8ClampedArray, w: number, h: number) {
  const out = new Uint8Array(w * h * 2);
  let o = 0;
  for (let ny = 0; ny < w; ny++) {
    const u = w - 1 - ny;
    for (let v = 0; v < h; v++) {
      const i = (v * w + u) * 4;
      const p = ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3);
      out[o++] = p & 0xff;
      out[o++] = p >> 8;
    }
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number) {
  const lines: string[] = [];
  for (const part of text.split("\n")) {
    let line = "";
    for (const word of part.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function loadedImage(src: string, frame = false) {
  return cached(src, frame).img ?? null;
}

export function drawTitle(ctx: CanvasRenderingContext2D, key: KeyConfig, w: number, h: number) {
  const ts = key.titleStyle;
  const title = key.title.trim();
  if (!ts.visible || !title) return;
  ctx.save();
  const size = ts.size * SCALE;
  ctx.font = `${ts.italic ? "italic " : ""}${ts.bold ? 700 : 400} ${size}px ${fontCss(ts.font)}`;
  ctx.fillStyle = ts.color === "auto" ? "#ffffff" : ts.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 4;
  const lines = wrap(ctx, title, w - 10 * SCALE, title.includes("\n") ? 3 : 2);
  const lineH = size * 1.2;
  const block = lines.length * lineH;
  const pad = 6 * SCALE;
  const top = ts.position === "top" ? pad : ts.position === "middle" ? (h - block) / 2 : h - pad - block;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lineH));
  ctx.restore();
}

function cover(ctx: CanvasRenderingContext2D, img: Picture, w: number, h: number) {
  const size = pictureSize(img);
  const iw = size.w || w;
  const ih = size.h || h;
  const k = Math.max(w / iw, h / ih);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
}

function drawContent(
  ctx: CanvasRenderingContext2D,
  key: KeyConfig,
  plugins: Plugin[],
  w: number,
  h: number,
  img: Picture | null,
  backdrop: Picture | null,
) {
  if (actionLost(plugins, key.action)) {
    drawLost(ctx, w, h);
    drawTitle(ctx, key, w, h);
    return;
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (backdrop) cover(ctx, backdrop, w, h);
  if (img) cover(ctx, img, w, h);
  else if (!key.image && !key.ext && findAction(plugins, key.action)) {
    const glyph = glyphUrl(key);
    if (glyph) {
      const icon = loadedImage(glyph);
      const size = 50 * SCALE;
      if (icon) ctx.drawImage(icon, (w - size) / 2, (h - size) / 2, size, size);
    } else {
      const size = 34 * SCALE;
      ctx.fillStyle = PLUGIN_COLORS[key.action!.pluginId] ?? "#8a8f98";
      roundRect(ctx, (w - size) / 2, (h - size) / 2, size, size, 10 * SCALE);
    }
  }
  drawTitle(ctx, key, w, h);
  if (key.badge) drawBadge(ctx, key.badge, w, h);
}

function drawLost(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const r = 8 * SCALE;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ctx.strokeStyle = LOST_COLOR;
  ctx.font = `700 ${26 * SCALE}px ${LOST_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("4", cx - 17 * SCALE, cy + SCALE);
  ctx.fillText("4", cx + 17 * SCALE, cy + SCALE);
  ctx.lineWidth = 3 * SCALE;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.moveTo(cx + r * 0.95, cy - r * 0.95);
  ctx.lineTo(cx - r * 0.95, cy + r * 0.95);
  ctx.stroke();
}

function glyphUrl(key: KeyConfig) {
  return key.action ? actionGlyphUrl(key.action.pluginId, key.action.actionId, key.state) : null;
}

async function drawKey(ctx: CanvasRenderingContext2D, key: KeyConfig, plugins: Plugin[]) {
  const glyph = key.image ? null : glyphUrl(key);
  if (glyph) await loadImage(glyph).catch(() => undefined);
  const img = key.image ? await loadImage(key.image, !!key.ext).catch(() => null) : null;
  const backdrop = key.backdrop ? await loadImage(key.backdrop).catch(() => null) : null;
  drawContent(ctx, key, plugins, KEY_SIZE, KEY_SIZE, img, backdrop);
}

export async function preloadSlot(key: KeyConfig) {
  const sources = [key.backdrop, key.image, key.image ? null : glyphUrl(key)];
  await Promise.all(sources.map((src) => src && loadImage(src, src === key.image && !!key.ext).catch(() => undefined)));
}

export function drawSlot(
  ctx: CanvasRenderingContext2D,
  key: KeyConfig,
  plugins: Plugin[],
  w: number,
  h: number,
  widget: WidgetEnv | null,
) {
  if (widget) {
    drawWidget(ctx, w, h, widget);
    drawTitle(ctx, key, w, h);
  } else drawContent(ctx, key, plugins, w, h, slotImage(ctx, key.image, !!key.ext), key.backdrop ? loadedImage(key.backdrop) : null);
}

const lastDrawn = new WeakMap<CanvasRenderingContext2D, Picture>();

function slotImage(ctx: CanvasRenderingContext2D, src: string | null, frame: boolean) {
  if (!src) {
    lastDrawn.delete(ctx);
    return null;
  }
  const img = loadedImage(src, frame) ?? lastDrawn.get(ctx) ?? null;
  if (img) lastDrawn.set(ctx, img);
  return img;
}

export async function renderKey(key: KeyConfig, plugins: Plugin[], widget?: WidgetEnv | null) {
  const { c, ctx } = canvas(KEY_SIZE, KEY_SIZE);
  if (widget) {
    drawWidget(ctx, KEY_SIZE, KEY_SIZE, widget);
    drawTitle(ctx, key, KEY_SIZE, KEY_SIZE);
  } else await drawKey(ctx, key, plugins);
  roundCorners(ctx, KEY_SIZE, KEY_SIZE, deckStyle.keyRadius);
  return { canvas: c, pixels: toNative(ctx, KEY_SIZE, KEY_SIZE) };
}

function drawBadge(ctx: CanvasRenderingContext2D, badge: "ok" | "alert", w: number, h: number) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, h);
  const r = Math.min(w, h) * 0.24;
  const cx = w / 2;
  const cy = h / 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (badge === "ok") {
    ctx.fillStyle = "#2fbf5b";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.36);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.32);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#f5b800";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.05);
    ctx.lineTo(cx + r * 1.15, cy + r * 0.9);
    ctx.lineTo(cx - r * 1.15, cy + r * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.4);
    ctx.lineTo(cx, cy + r * 0.22);
    ctx.stroke();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.55, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const hashes = new Map<string, string>();

export function hashText(text: string) {
  const known = hashes.get(text);
  if (known) return known;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  const hash = `${text.length}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
  hashes.set(text, hash);
  if (hashes.size > IMAGE_CACHE) hashes.delete(hashes.keys().next().value!);
  return hash;
}
