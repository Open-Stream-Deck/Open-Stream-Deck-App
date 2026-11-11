import type { KeySettings } from "../types";
import { frameAt, isMediaRef, mediaFrames } from "../media";
import { isPet, isWeather, widgetStyle, type WidgetKind } from "./catalog";
import { driveLetter, formatGb, formatRate, HISTORY, pick, stats } from "./stats";
import { countdownTarget, timerState, timerTotal } from "./timer";
import { cityCaption, zoned } from "./zones";
import { drawPet } from "./pets";
import { clock as sunClock, type Day, iconCode, isDay, pressure, speed, temp, weather, weatherIcon, weatherPlace, type Weather, windPoint } from "./weather";
import { getLang, type Key, type Lang, t } from "../i18n";

export type PageInfo = { page: number; pages: number; profile: string };

export type WidgetEnv = {
  id: string;
  kind: WidgetKind;
  settings: KeySettings;
  label: string;
  pressed: boolean;
  page: PageInfo;
  t: number;
  now: Date;
};

type Ctx = CanvasRenderingContext2D;

const FONT = '"Inter Variable", Inter, "Segoe UI", sans-serif';
const RED = "#ff3b30";

let WHITE = "#ffffff";
let GREY = "rgba(255,255,255,0.55)";
let DIM = "rgba(255,255,255,0.22)";

function rgba(hex: string, a: number) {
  const v = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function background(ctx: Ctx, w: number, h: number, settings: KeySettings, t: number) {
  ctx.fillStyle = color(settings.backgroundColor, "#000000");
  ctx.fillRect(0, 0, w, h);
  if (!isMediaRef(settings.background)) return;
  const frames = mediaFrames(settings.background);
  if (!frames) return;
  const img = frameAt(frames, t);
  const k = Math.max(w / img.width, h / img.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
  const dim = Number(settings.dim ?? 40);
  if (dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.9, dim / 100)})`;
    ctx.fillRect(0, 0, w, h);
  }
}
const TAU = Math.PI * 2;

const ROLL_MS = 900;
const ROLL_GAP = 1.25;
const ROLL_TOP = 0.08;
const ROLL_BOTTOM = 0.12;
const ROLL_STALE_MS = 300;

type Roll = { text: string; from: string; trend: number; at: number; width: number; fromWidth: number; seen: number };

const rolls = new Map<string, Roll>();
let scope = "";
let part = 0;
let clock = 0;
let animated = true;

const ROLL_SPRING = 7;
const spring = (t: number) => 1 - Math.exp(-ROLL_SPRING * t) * (1 + ROLL_SPRING * t);
const easeRoll = (t: number) => spring(t) / spring(1);
const numeric = (text: string) => Number(text.replace(/[^\d.]/g, "")) || 0;

let rollActive = false;

export function takeRolling() {
  const was = rollActive;
  rollActive = false;
  return was;
}

function progress(r: Roll) {
  return easeRoll(Math.min(1, Math.max(0, (clock - r.at) / ROLL_MS)));
}

function shown(r: Roll) {
  return r.fromWidth + (r.width - r.fromWidth) * progress(r);
}

function roll(text: string, width: number, trend?: number) {
  const key = `${scope}:${part++}`;
  const r = rolls.get(key);
  if (!r) {
    const fresh = { text, from: text, trend: 1, at: -Infinity, width, fromWidth: width, seen: clock };
    rolls.set(key, fresh);
    return fresh;
  }
  if (r.text !== text) {
    r.fromWidth = shown(r);
    r.trend = trend ?? (Math.sign(numeric(text) - numeric(r.text)) || 1);
    r.from = r.text;
    r.text = text;
    r.at = animated && clock - r.seen < ROLL_STALE_MS ? clock : -Infinity;
    r.width = width;
  } else if (r.width !== width && clock - r.at >= ROLL_MS) {
    r.width = r.fromWidth = width;
  }
  r.seen = clock;
  if (clock - r.at < ROLL_MS) rollActive = true;
  return r;
}

function textWidth(text: string, widthOf: (ch: string) => number) {
  return [...text].reduce((w, ch) => w + widthOf(ch), 0);
}

const SPRITE_LIMIT = 400;
const sprites = new Map<string, { canvas: HTMLCanvasElement; baseline: number }>();
document.fonts?.addEventListener("loadingdone", () => sprites.clear());

function sprite(ctx: Ctx, ch: string, asc: number) {
  const key = `${ctx.font}|${String(ctx.fillStyle)}|${ch}`;
  let s = sprites.get(key);
  if (!s) {
    if (sprites.size > SPRITE_LIMIT) sprites.clear();
    const canvas = document.createElement("canvas");
    const pad = Math.ceil(asc * 0.5);
    canvas.width = Math.ceil(ctx.measureText(ch).width / 2 + pad) * 2;
    canvas.height = Math.ceil(asc) + pad * 2;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.font = ctx.font;
    g.fillStyle = ctx.fillStyle;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillText(ch, canvas.width / 2, Math.ceil(asc) + pad);
    s = { canvas, baseline: Math.ceil(asc) + pad };
    sprites.set(key, s);
  }
  return s;
}

function drawGlyph(ctx: Ctx, ch: string, asc: number, x: number, baseline: number) {
  const s = sprite(ctx, ch, asc);
  ctx.drawImage(s.canvas, x - s.canvas.width / 2, baseline - s.baseline);
}

function drawRoll(ctx: Ctx, r: Roll, end: number, at: number, widthOf: (ch: string) => number, hidden = (_: string) => false) {
  const asc = ctx.measureText("0").actualBoundingBoxAscent;
  const baseline = Math.round(at);
  const step = asc * ROLL_GAP * r.trend;
  const p = progress(r);
  const before = p < 1 ? r.from : r.text;
  const alpha = ctx.globalAlpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let x = end;
  for (let k = 1; k <= Math.max(r.text.length, before.length); k++) {
    const next = r.text[r.text.length - k] ?? "";
    const prev = before[before.length - k] ?? "";
    const w = widthOf(next || prev);
    x -= w;
    const cx = x + w / 2;
    if (prev === next) {
      if (next && !hidden(next)) ctx.fillText(next, cx, baseline);
      continue;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - w, baseline - asc * (1 + ROLL_TOP), w * 2, asc * (1 + ROLL_TOP + ROLL_BOTTOM));
    ctx.clip();
    ctx.globalAlpha = alpha * (1 - p);
    if (prev && !hidden(prev)) drawGlyph(ctx, prev, asc, cx, baseline - p * step);
    ctx.globalAlpha = alpha * p;
    if (next && !hidden(next)) drawGlyph(ctx, next, asc, cx, baseline + (1 - p) * step);
    ctx.restore();
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function font(ctx: Ctx, weight: number, px: number) {
  ctx.font = `${weight} ${px}px ${FONT}`;
}

function digits(ctx: Ctx, text: string, cx: number, cy: number, px: number, weight: number, color: string, colon = true) {
  font(ctx, weight, px);
  const cell = ctx.measureText("0").width;
  const widthOf = (ch: string) => (ch === ":" ? cell * 0.55 : cell);
  const r = roll(text, textWidth(text, widthOf));
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText("0");
  const baseline = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.fillStyle = color;
  drawRoll(ctx, r, cx + shown(r) / 2, baseline, widthOf, (ch) => ch === ":" && !colon);
}

function fitDigits(ctx: Ctx, sample: string, px: number, weight: number, max: number) {
  for (; px > 10; px--) {
    font(ctx, weight, px);
    const cell = ctx.measureText("0").width;
    const width = [...sample].reduce((w, ch) => w + (ch === ":" ? cell * 0.55 : cell), 0);
    if (width <= max) break;
  }
  return px;
}

function digital(ctx: Ctx, w: number, h: number, d: Date, seconds: boolean) {
  const colon = d.getSeconds() % 2 === 0;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const px = fitDigits(ctx, "00:00", 40, 600, w - 12);
  const mid = h / 2;
  if (seconds) {
    digits(ctx, time, w / 2, mid - 10, px, 600, WHITE, colon);
    digits(ctx, pad2(d.getSeconds()), w / 2, mid + 25, Math.max(14, Math.round(px * 0.45)), 500, GREY);
  } else {
    digits(ctx, time, w / 2, mid, px, 600, WHITE, colon);
  }
}

function dial(ctx: Ctx, w: number, h: number, d: Date, seconds: boolean) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 4;
  ctx.lineCap = "round";
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU - Math.PI / 2;
    const hour = i % 5 === 0;
    const quarter = i % 15 === 0;
    const len = quarter ? r * 0.2 : hour ? r * 0.13 : r * 0.05;
    ctx.strokeStyle = hour ? WHITE : DIM;
    ctx.lineWidth = quarter ? 3.2 : hour ? 2.2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  const hand = (turn: number, length: number, width: number, color: string, tail = 0) => {
    const a = turn * TAU - Math.PI / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * tail, cy - Math.sin(a) * tail);
    ctx.lineTo(cx + Math.cos(a) * length, cy + Math.sin(a) * length);
    ctx.stroke();
  };
  const minutes = d.getMinutes() + d.getSeconds() / 60;
  hand(((d.getHours() % 12) + minutes / 60) / 12, r * 0.5, 4.5, WHITE);
  hand(minutes / 60, r * 0.78, 3, WHITE);
  if (seconds) hand(d.getSeconds() / 60, r * 0.88, 1.4, RED, r * 0.18);
  ctx.fillStyle = seconds ? RED : WHITE;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(cx, cy, 1.3, 0, TAU);
  ctx.fill();
}

function modern(ctx: Ctx, w: number, h: number, d: Date, seconds: boolean) {
  const strip = seconds ? 16 : 0;
  const px = Math.min(fitDigits(ctx, "00", 60, 800, w - 10), Math.floor((h - 10 - strip) / (0.73 + 0.84)));
  const lh = px * 0.84;
  const total = px * (0.73 + 0.84) + strip;
  const top = (h - total) / 2 + px * 0.365;
  digits(ctx, pad2(d.getHours()), w / 2, top, px, 800, WHITE);
  digits(ctx, pad2(d.getMinutes()), w / 2, top + lh, px, 250, WHITE);
  if (seconds) {
    const y = top + lh + px * 0.365 + 10;
    const x0 = 10;
    const len = w - 20;
    const s = d.getSeconds();
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i += 2) {
      ctx.strokeStyle = i <= s ? WHITE : DIM;
      const x = Math.round(x0 + (len * i) / 58) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y - (i % 10 === 0 ? 4 : 2));
      ctx.lineTo(x, y + (i % 10 === 0 ? 4 : 2));
      ctx.stroke();
    }
  }
}

function caption(ctx: Ctx, text: string, x: number, y: number, align: CanvasTextAlign = "center", max = Infinity, fill = GREY) {
  let label = text ? text[0].toUpperCase() + text.slice(1) : text;
  font(ctx, 500, 13);
  ctx.letterSpacing = "0.2px";
  if (ctx.measureText(label).width > max) ctx.letterSpacing = "0px";
  if (ctx.measureText(label).width > max) {
    while (label.length > 2 && ctx.measureText(`${label}…`).width > max) label = label.slice(0, -1);
    label = `${label}…`;
  }
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
  ctx.letterSpacing = "0px";
}

function plain(ctx: Ctx, text: string, x: number, y: number, px: number, weight: number, fill: string, align: CanvasTextAlign = "center") {
  font(ctx, weight, px);
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function rolled(ctx: Ctx, text: string, x: number, y: number, px: number, weight: number, fill: string, align: CanvasTextAlign = "center") {
  font(ctx, weight, px);
  const cell = ctx.measureText("0").width;
  const widthOf = (ch: string) => (/\d/.test(ch) ? cell : ctx.measureText(ch).width);
  const r = roll(text, textWidth(text, widthOf));
  const width = shown(r);
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText("0");
  const baseline = y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  const end = align === "right" ? x : align === "left" ? x + width : x + width / 2;
  ctx.fillStyle = fill;
  drawRoll(ctx, r, end, baseline, widthOf);
}

function quantity(ctx: Ctx, value: string, unit: string, cx: number, cy: number, px: number, max: number, prefix = "", centerNumber = false) {
  const unitSize = (p: number) => Math.max(12, Math.round(p * 0.48));
  const prefixWidth = (p: number) => {
    if (!prefix) return 0;
    font(ctx, 600, unitSize(p));
    return ctx.measureText(prefix).width + p * 0.12;
  };
  for (; px > 14; px--) {
    font(ctx, 600, px);
    const cell = ctx.measureText("0").width;
    const nw = [...value].reduce((w, ch) => w + (/\d/.test(ch) ? cell : ctx.measureText(ch).width), 0);
    const pw = prefixWidth(px);
    font(ctx, 500, unitSize(px));
    const uw = ctx.measureText(unit).width + px * 0.08;
    if (centerNumber ? nw / 2 + uw <= max / 2 && pw + nw / 2 <= max / 2 : pw + nw + uw <= max) break;
  }
  font(ctx, 600, px);
  const cell = ctx.measureText("0").width;
  const numberWidth = (ch: string) => (/\d/.test(ch) ? cell : ctx.measureText(ch).width);
  const r = roll(value, textWidth(value, numberWidth));
  const nw = shown(r);
  const unitPx = unitSize(px);
  const pw = prefixWidth(px);
  font(ctx, 500, unitPx);
  const unitWidth = (ch: string) => ctx.measureText(ch).width;
  const u = roll(unit, textWidth(unit, unitWidth), r.trend);
  const uw = shown(u);
  const gap = px * 0.08;
  const x = (centerNumber ? cx - nw / 2 - pw : cx - (pw + nw + gap + uw) / 2) + pw;
  font(ctx, 600, px);
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText("0");
  const baseline = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  if (prefix) {
    font(ctx, 600, unitPx);
    ctx.fillStyle = GREY;
    ctx.textAlign = "left";
    ctx.fillText(prefix, x - pw, baseline);
    font(ctx, 600, px);
  }
  ctx.fillStyle = WHITE;
  drawRoll(ctx, r, x + nw, baseline, numberWidth);
  font(ctx, 500, unitPx);
  ctx.fillStyle = GREY;
  drawRoll(ctx, u, x + nw + gap + uw, baseline, unitWidth);
}

function ring(ctx: Ctx, cx: number, cy: number, r: number, frac: number) {
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.strokeStyle = DIM;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  const f = Math.max(0, Math.min(1, frac));
  if (f <= 0.005) return;
  ctx.strokeStyle = WHITE;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + f * TAU);
  ctx.stroke();
}

function graph(ctx: Ctx, values: number[], max: number, x: number, y: number, w: number, h: number, stroke: string, fill: boolean, slots = HISTORY) {
  if (values.length < 2) return;
  const step = w / (slots - 1);
  const px = (i: number) => x + w - (values.length - 1 - i) * step;
  const py = (v: number) => y + h - Math.min(1, v / (max || 1)) * h;
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.stroke();
  if (!fill) return;
  ctx.lineTo(px(values.length - 1), y + h);
  ctx.lineTo(px(0), y + h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba(WHITE, 0.22));
  g.addColorStop(1, rgba(WHITE, 0));
  ctx.fillStyle = g;
  ctx.fill();
}

const LABEL: Record<string, Key> = {
  cpu: "widget.label.cpu",
  ram: "widget.label.ram",
  disk: "widget.label.disk",
  gpu: "widget.label.gpu",
  network: "widget.label.network",
};

const LOCALE: Record<Lang, string> = { ru: "ru-RU", en: "en-US", zh: "zh-CN" };

function load(ctx: Ctx, w: number, h: number, kind: WidgetKind, style: string, now: Date, settings: KeySettings) {
  const snap = stats(now.getTime());
  const s = snap?.stats;
  let pct = 0;
  let known = false;
  let detail = "";
  let history: number[] = [];
  let label = t(LABEL[kind]);
  if (s && kind === "cpu") {
    pct = s.cpu;
    known = true;
    history = snap.cpu;
  } else if (s && kind === "ram") {
    pct = s.ram_total ? (s.ram_used / s.ram_total) * 100 : 0;
    known = s.ram_total > 0;
    detail = `${formatGb(s.ram_used)} / ${formatGb(s.ram_total)} ${t("widget.gb")}`;
    history = snap.ram;
  } else if (s && kind === "disk") {
    const disk = pick(s.disks, settings.disk);
    if (disk) {
      pct = disk.total ? (disk.used / disk.total) * 100 : 0;
      known = disk.total > 0;
      detail = `${formatGb(disk.used)} / ${formatGb(disk.total)} ${t("widget.gb")}`;
      label = `${label} ${driveLetter(disk.id)}`;
    }
  } else if (s && kind === "gpu") {
    const gpu = pick(s.gpus, settings.gpu);
    pct = gpu?.load ?? 0;
    known = Number.isFinite(gpu?.load);
    if (gpu?.mem_total) detail = `${formatGb(gpu.mem_used)} / ${formatGb(gpu.mem_total)} ${t("widget.gb")}`;
    history = gpu ? (snap.gpu[gpu.id] ?? []) : [];
  }
  const value = known ? String(Math.round(pct)) : "–";

  if (style === "ring") {
    const r = Math.min(w, h) / 2 - 7;
    ring(ctx, w / 2, h / 2, r, pct / 100);
    quantity(ctx, value, "%", w / 2, h / 2 - 5, 24, r * 1.45);
    caption(ctx, label, w / 2, h / 2 + 15);
    return;
  }
  if (style === "graph") {
    caption(ctx, label, 8, 15, "left");
    rolled(ctx, `${value}%`, w - 8, 15, 16, 700, WHITE, "right");
    graph(ctx, history, 100, 6, 32, w - 12, h - 40, WHITE, true);
    return;
  }
  caption(ctx, label, w / 2, 16);
  quantity(ctx, value, "%", w / 2, h / 2, 34, w - 12);
  if (detail) rolled(ctx, detail, w / 2, h - 13, 12, 500, GREY);
}

function network(ctx: Ctx, w: number, h: number, style: string, now: Date) {
  const snap = stats(now.getTime());
  const down = formatRate(snap?.stats.net_down ?? 0);
  const up = formatRate(snap?.stats.net_up ?? 0);
  if (style === "graph") {
    rolled(ctx, `↓ ${down.value} ${down.unit}`, 8, 14, 13, 700, WHITE, "left");
    rolled(ctx, `↑ ${up.value} ${up.unit}`, 8, 30, 12, 500, GREY, "left");
    const max = Math.max(64 * 1024, ...(snap?.down ?? []), ...(snap?.up ?? [])) * 1.1;
    graph(ctx, snap?.up ?? [], max, 6, 42, w - 12, h - 50, GREY, false);
    graph(ctx, snap?.down ?? [], max, 6, 42, w - 12, h - 50, WHITE, true);
    return;
  }
  caption(ctx, t(LABEL.network), w / 2, 16);
  quantity(ctx, down.value, down.unit, w / 2, 47, 24, w - 8, "↓");
  quantity(ctx, up.value, up.unit, w / 2, 79, 18, w - 8, "↑");
}

function isoWeek(d: Date) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day + 3);
  const first = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t.getTime() - first.getTime()) / 86400000 - 3 + ((first.getDay() + 6) % 7)) / 7);
}

function dayOfYear(d: Date) {
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
}

function dateFootnote(d: Date, extra: unknown, city: string) {
  const parts: string[] = [];
  if (extra === "week") parts.push(t("widget.week", { n: isoWeek(d) }));
  else if (extra === "day") parts.push(t("widget.day", { n: dayOfYear(d) }));
  else if (extra === "left") {
    const left = Math.round((new Date(d.getFullYear() + 1, 0, 1).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
    parts.push(t("widget.daysLeft", { n: left }));
  }
  if (city) parts.push(city);
  return parts.join(" · ");
}

function fitPlain(ctx: Ctx, text: string, x: number, y: number, px: number, weight: number, fill: string, max: number, min = px) {
  for (font(ctx, weight, px); px > min && ctx.measureText(text).width > max; font(ctx, weight, --px));
  let s = text;
  while (s.length > 2 && ctx.measureText(s).width > max) s = s.slice(0, -1);
  plain(ctx, s === text ? s : `${s.slice(0, -1)}…`, x, y, px, weight, fill);
}

function calendarMonth(d: Date) {
  const lang = getLang();
  if (lang === "ru") return d.toLocaleDateString(LOCALE.ru, { day: "numeric", month: "long" }).split(" ")[1] ?? "";
  return d.toLocaleDateString(LOCALE[lang], { month: lang === "zh" ? "short" : "long" });
}

function date(ctx: Ctx, w: number, h: number, d: Date, style: string, extra: unknown, city: string) {
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const dayTone = weekend ? RED : GREY;
  const foot = dateFootnote(d, extra, city);
  const locale = LOCALE[getLang()];
  const weekdayLong = d.toLocaleDateString(locale, { weekday: "long" });

  if (style === "line") {
    const month = d.toLocaleDateString(locale, { month: "short" }).replace(".", "");
    quantity(ctx, String(d.getDate()), month, w / 2, foot ? 38 : 44, 38, w - 10);
    fitPlain(ctx, weekdayLong, w / 2, foot ? 66 : 74, 13, 600, dayTone, w - 8);
    if (foot) fitPlain(ctx, foot, w / 2, h - 13, 12, 500, GREY, w - 8);
    return;
  }

  const month = calendarMonth(d);
  caption(ctx, weekdayLong, w / 2, foot ? 14 : 17, "center", w - 8, dayTone);
  digits(ctx, String(d.getDate()), w / 2, foot ? 45 : 50, 46, 700, WHITE);
  fitPlain(ctx, month, w / 2, foot ? 73 : 82, 13, 500, GREY, w - 8);
  if (foot) fitPlain(ctx, foot, w / 2, h - 11, 12, 500, GREY, w - 8);
}

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(seconds % 60)}` : `${pad2(m)}:${pad2(seconds % 60)}`;
}

const digitSample = (text: string) => text.replace(/\d/g, "0");

function timerWidget(ctx: Ctx, w: number, h: number, e: WidgetEnv, style: string) {
  const total = timerTotal(e.settings);
  const s = timerState(e.id, total, e.t);
  const text = duration(Math.ceil(s.left / 1000));
  const active = s.running || s.fresh;
  const color = s.done ? (Math.floor(e.t / 500) % 2 ? WHITE : RED) : active ? WHITE : GREY;
  const label = t(s.done ? "widget.timer.done" : active ? "widget.timer" : "widget.timer.paused");
  if (style === "ring") {
    const r = Math.min(w, h) / 2 - 7;
    ring(ctx, w / 2, h / 2, r, s.left / total);
    digits(ctx, text, w / 2, h / 2 - 4, fitDigits(ctx, digitSample(text), 24, 600, r * 1.45), 600, color);
    caption(ctx, label, w / 2, h / 2 + 16, "center", r * 1.6, s.done ? RED : GREY);
    return;
  }
  caption(ctx, label, w / 2, 16, "center", w - 8, s.done ? RED : GREY);
  digits(ctx, text, w / 2, h / 2 + 6, fitDigits(ctx, digitSample(text), 36, 600, w - 12), 600, color);
}

function countdownWidget(ctx: Ctx, w: number, h: number, settings: KeySettings, now: Date) {
  const raw = typeof settings.target === "string" && settings.target.trim() ? settings.target : "01.01";
  const target = countdownTarget(raw, now);
  if (!target) {
    caption(ctx, t("widget.countdown"), w / 2, 16);
    plain(ctx, "--:--", w / 2, h / 2 + 2, 30, 600, GREY);
    return;
  }
  const left = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const locale = LOCALE[getLang()];
  const when = raw.includes(".")
    ? target.toLocaleDateString(locale, { day: "numeric", month: "short" })
    : target.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  caption(ctx, t("widget.countdown.until", { when }), w / 2, 16, "center", w - 8, left ? GREY : RED);
  const days = Math.floor(left / 86400);
  if (days) {
    quantity(ctx, String(days), t("widget.unit.days"), w / 2, h / 2 + 2, 38, w - 12);
    const rest = left % 86400;
    rolled(ctx, `${pad2(Math.floor(rest / 3600))}:${pad2(Math.floor((rest % 3600) / 60))}:${pad2(rest % 60)}`, w / 2, h - 14, 12, 500, GREY);
    return;
  }
  const text = duration(left);
  digits(ctx, text, w / 2, h / 2 + 6, fitDigits(ctx, digitSample(text), 36, 600, w - 12), 600, left ? WHITE : RED);
}

function pageWidget(ctx: Ctx, w: number, h: number, info: PageInfo, style: string) {
  if (style !== "dots") {
    quantity(ctx, String(info.page + 1), `/ ${info.pages}`, w / 2, h / 2, 40, w - 12);
    return;
  }
  const r = Math.min(5, (w - 16) / (info.pages * 3));
  const pitch = r * 3;
  const x0 = w / 2 - (pitch * (info.pages - 1)) / 2;
  for (let i = 0; i < info.pages; i++) {
    ctx.fillStyle = i === info.page ? WHITE : DIM;
    ctx.beginPath();
    ctx.arc(x0 + i * pitch, h / 2, i === info.page ? r * 1.25 : r, 0, TAU);
    ctx.fill();
  }
}

const degrees = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n)}°`;

function weatherStatus(ctx: Ctx, w: number, h: number, error: string) {
  caption(ctx, t("weather"), w / 2, 16);
  if (!error) {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = Math.floor(clock / 300) % 3 === i ? WHITE : DIM;
      ctx.beginPath();
      ctx.arc(w / 2 + (i - 1) * 12, h / 2 + 4, 3.5, 0, TAU);
      ctx.fill();
    }
    return;
  }
  wrap(ctx, t(error === "notFound" ? "weather.notFound" : "weather.offline"), w / 2, h / 2 + 2, 13, 600, WHITE, w - 8);
  wrap(ctx, t("weather.retry"), w / 2, h - 17, 11, 500, GREY, w - 8);
}

function wrap(ctx: Ctx, text: string, x: number, y: number, px: number, weight: number, fill: string, max: number) {
  font(ctx, weight, px);
  const spaces = [...text.matchAll(/ /g)].map((m) => m.index);
  if (ctx.measureText(text).width <= max || !spaces.length) return fitPlain(ctx, text, x, y, px, weight, fill, max, px - 2);
  const cut = spaces.reduce((a, b) => (Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a));
  fitPlain(ctx, text.slice(0, cut), x, y - px * 0.6, px, weight, fill, max, px - 2);
  fitPlain(ctx, text.slice(cut + 1), x, y + px * 0.6, px, weight, fill, max, px - 2);
}

function weatherBadge(ctx: Ctx, w: number, busy: boolean, error: string) {
  if (!busy && !error) return;
  ctx.fillStyle = busy ? GREY : RED;
  ctx.globalAlpha = busy ? 0.5 + 0.5 * Math.sin(clock / 150) : 1;
  ctx.beginPath();
  ctx.arc(w - 7, 7, 2.5, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function icon(ctx: Ctx, settings: KeySettings, code: string, cx: number, cy: number, size: number) {
  const img = weatherIcon(settings.icons, code, WHITE);
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
}

function row(ctx: Ctx, label: string, value: string, w: number, y: number) {
  const size = w < 100 ? 11 : 12;
  font(ctx, 600, size);
  const room = w - 22 - ctx.measureText(value).width;
  let px = size;
  for (font(ctx, 500, px); px > 9 && ctx.measureText(label).width > room; font(ctx, 500, --px));
  plain(ctx, label, 8, y, px, 500, GREY, "left");
  rolled(ctx, value, w - 8, y, size, 600, WHITE, "right");
}

function weatherNote(settings: KeySettings, place: string, desc: string, feels: string) {
  const mode = settings.caption ?? "place";
  if (mode === "none") return "";
  if (mode === "desc") return desc;
  if (mode === "feels") return feels;
  return weatherPlace(settings) || place;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function currentWeather(ctx: Ctx, w: number, h: number, settings: KeySettings, style: string) {
  const entry = weather(settings);
  const d = entry.data;
  if (!d) return weatherStatus(ctx, w, h, entry.busy ? "" : entry.error);
  const code = iconCode(d.code, isDay(d.lat, d.lon));
  const now = degrees(temp(d.temp, settings.tempUnit));
  const feels = degrees(temp(d.feels, settings.tempUnit));
  const note = capital(weatherNote(settings, d.place, d.desc, feels));
  if (style === "detail") {
    const size = w < 100 ? 30 : 38;
    icon(ctx, settings, code, 6 + size / 2, 25, size);
    rolled(ctx, now, w - 8, 25, fitDigits(ctx, now.replace(/\d/g, "0"), 24, 700, w - size - 18), 700, WHITE, "right");
    row(ctx, t("weather.short.feels"), feels, w, 56);
    row(ctx, t("weather.short.humidity"), `${d.humidity}%`, w, 73);
    row(ctx, t("weather.short.rain"), `${d.days[0]?.rain ?? 0}%`, w, 90);
  } else if (style === "big") {
    if (note) fitPlain(ctx, note, w / 2, 15, 13, 500, GREY, w - 10, 10);
    rolled(ctx, now, w / 2, note ? 50 : 42, fitDigits(ctx, now.replace(/\d/g, "0"), 40, 700, w - 12), 700, WHITE);
    icon(ctx, settings, code, w / 2, h - 20, 28);
  } else if (note) {
    icon(ctx, settings, code, w / 2, 29, 44);
    rolled(ctx, now, w / 2, 66, fitDigits(ctx, now.replace(/\d/g, "0"), 26, 700, w - 12), 700, WHITE);
    fitPlain(ctx, note, w / 2, h - 13, 12, 500, GREY, w - 10, 10);
  } else {
    icon(ctx, settings, code, w / 2, 35, 52);
    rolled(ctx, now, w / 2, 80, fitDigits(ctx, now.replace(/\d/g, "0"), 28, 700, w - 12), 700, WHITE);
  }
  weatherBadge(ctx, w, entry.busy, entry.error);
}

function dayName(day: Day, index: number) {
  if (index < 2) return t(index ? "weather.tomorrow" : "weather.today");
  return capital(new Date(`${day.date}T12:00`).toLocaleDateString(LOCALE[getLang()], { weekday: "long" }));
}

function hourMarks(ctx: Ctx, y: number, at: (slot: number) => number) {
  font(ctx, 500, 10);
  ctx.fillStyle = GREY;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const hour of [0, 6, 12, 18]) ctx.fillText(String(hour), at(hour / 3), y);
}

function pointLabel(ctx: Ctx, text: string, x: number, y: number, w: number, fill: string) {
  font(ctx, 600, 10);
  const half = ctx.measureText(text).width / 2;
  plain(ctx, text, Math.min(w - 4 - half, Math.max(4 + half, x)), y, 10, 600, fill);
}

function forecast(ctx: Ctx, w: number, h: number, settings: KeySettings, style: string) {
  const entry = weather(settings);
  const index = Math.min(2, Math.max(0, Number(settings.day) || 0));
  const day = entry.data?.days[index];
  if (!day) return weatherStatus(ctx, w, h, entry.busy ? "" : entry.error);
  const name = dayName(day, index);
  const max = degrees(temp(day.max, settings.tempUnit));
  const min = degrees(temp(day.min, settings.tempUnit));
  fitPlain(ctx, name, w / 2, 15, 13, 500, GREY, w - 10, 10);
  if (style === "hours" && day.hours.length > 1) {
    const temps = day.hours.map((x) => temp(x.temp, settings.tempUnit));
    const lo = Math.min(...temps);
    const hi = Math.max(lo + 1, Math.max(...temps));
    const top = 38;
    const height = h - 76;
    const at = (i: number) => 8 + ((w - 16) * i) / (temps.length - 1);
    const y = (v: number) => top + height - ((v - lo) / (hi - lo)) * height;
    graph(ctx, temps.map((v) => v - lo), hi - lo, 8, top, w - 16, height, WHITE, true, temps.length);
    const hottest = temps.indexOf(Math.max(...temps));
    const coldest = temps.indexOf(lo);
    pointLabel(ctx, degrees(temps[hottest]), at(hottest), y(temps[hottest]) - 8, w, WHITE);
    pointLabel(ctx, degrees(lo), at(coldest), y(lo) + 9, w, GREY);
    hourMarks(ctx, h - 10, at);
  } else if (style === "rain" && day.hours.length) {
    const pitch = (w - 16) / day.hours.length;
    const top = 38;
    const height = h - 62;
    const at = (i: number) => 8 + (i + 0.5) * pitch;
    day.hours.forEach((x, i) => {
      const bar = Math.max(2, (height * x.rain) / 100);
      ctx.fillStyle = x.rain >= 50 ? WHITE : x.rain >= 20 ? GREY : DIM;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(at(i) - pitch / 2 + 1.5, top + height - bar, pitch - 3, bar, 2);
      else ctx.rect(at(i) - pitch / 2 + 1.5, top + height - bar, pitch - 3, bar);
      ctx.fill();
    });
    const wettest = day.hours.findIndex((x) => x.rain === day.rain);
    pointLabel(ctx, `${day.rain}%`, at(wettest), top + height - Math.max(2, (height * day.rain) / 100) - 8, w, WHITE);
    hourMarks(ctx, h - 10, at);
  } else {
    icon(ctx, settings, iconCode(day.code, true), w / 2, 47, 42);
    font(ctx, 700, 18);
    const a = ctx.measureText(max).width;
    font(ctx, 500, 14);
    const x = (w - a - ctx.measureText(` ${min}`).width) / 2;
    plain(ctx, max, x, h - 16, 18, 700, WHITE, "left");
    plain(ctx, ` ${min}`, x + a, h - 15, 14, 500, GREY, "left");
  }
  weatherBadge(ctx, w, entry.busy, entry.error);
}

const UV: Key[] = ["weather.uv.low", "weather.uv.moderate", "weather.uv.high", "weather.uv.veryHigh", "weather.uv.extreme"];

const uvLevel = (uv: number) => UV[uv >= 11 ? 4 : uv >= 8 ? 3 : uv >= 6 ? 2 : uv >= 3 ? 1 : 0];

const METRICS = ["wind", "feels", "humidity", "pressure", "uv", "cloud", "precip", "visibility", "sun"];

type Reading = { label: string; value: string; unit: string; foot: string; tag: string; frac: number };

function reading(metric: string, d: Weather, settings: KeySettings): Reading {
  const label = t(`weather.metric.${metric}` as Key);
  const r: Reading = { label, value: "", unit: "", foot: "", tag: label, frac: 0 };
  const today = d.days[0];
  if (metric === "feels") {
    return { ...r, value: degrees(temp(d.feels, settings.tempUnit)), foot: t("weather.actual", { t: degrees(temp(d.temp, settings.tempUnit)) }), frac: (d.feels + 30) / 70 };
  }
  if (metric === "humidity" || metric === "cloud") {
    const pct = metric === "humidity" ? d.humidity : d.cloud;
    return { ...r, value: String(pct), unit: "%", frac: pct / 100 };
  }
  if (metric === "pressure") {
    const p = pressure(d.pressure, settings.pressureUnit);
    return { ...r, value: String(p.value), unit: t(`weather.unit.${p.unit}`), frac: (d.pressure - 960) / 90 };
  }
  if (metric === "uv") {
    const level = t(uvLevel(d.uv));
    return { ...r, value: String(d.uv), foot: level, tag: level, frac: d.uv / 11 };
  }
  if (metric === "precip") {
    return { ...r, value: String(d.precip), unit: t("weather.unit.mm"), foot: today ? t("weather.chance", { n: today.rain }) : "", frac: d.precip / 10 };
  }
  if (metric === "visibility") return { ...r, value: String(d.visibility), unit: t("weather.unit.km"), frac: d.visibility / 10 };
  if (metric === "sun" && today) {
    const rising = !isDay(d.lat, d.lon);
    const solarHour = (((Date.now() / 3_600_000 + d.lon / 15) % 24) + 24) % 24;
    const sunrise = rising && solarHour >= 12 ? (d.days[1] ?? today).sunrise : today.sunrise;
    const [value, unit = ""] = sunClock(rising ? sunrise : today.sunset).split(" ");
    const next = t(rising ? "weather.sunrise" : "weather.sunset");
    const other = `${t(rising ? "weather.sunset" : "weather.sunrise")} ${sunClock(rising ? today.sunset : sunrise)}`;
    return { ...r, label: next, tag: next, value, unit, foot: other };
  }
  const s = speed(d.wind, settings.windUnit);
  const side = t("weather.compass").split(",")[windPoint(d.windDir)];
  return { ...r, label: t("weather.metric.wind"), value: String(s.value), unit: t(`weather.unit.${s.unit}`), foot: side, tag: side, frac: d.wind / 50 };
}

function windArrow(ctx: Ctx, cx: number, cy: number, r: number, from: number) {
  const a = ((from + 180) / 360) * TAU - Math.PI / 2;
  ctx.save();
  ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  ctx.rotate(a + Math.PI / 2);
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(5, 4);
  ctx.lineTo(-5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function meteo(ctx: Ctx, w: number, h: number, settings: KeySettings, style: string) {
  const entry = weather(settings);
  const d = entry.data;
  if (!d) return weatherStatus(ctx, w, h, entry.busy ? "" : entry.error);
  const metric = METRICS.includes(settings.metric as string) ? (settings.metric as string) : "wind";
  const r = reading(metric, d, settings);
  if (style === "ring") {
    const radius = Math.min(w, h) / 2 - 7;
    ring(ctx, w / 2, h / 2, radius, metric === "wind" ? 0 : r.frac);
    if (metric === "wind") windArrow(ctx, w / 2, h / 2, radius, d.windDir);
    quantity(ctx, r.value, r.unit, w / 2, h / 2 - 5, 24, radius * 1.45);
    fitPlain(ctx, r.tag, w / 2, h / 2 + 15, 13, 500, GREY, radius * 1.6, 9);
  } else {
    fitPlain(ctx, r.label, w / 2, 16, 13, 500, GREY, w - 10, 10);
    quantity(ctx, r.value, r.unit, w / 2, h / 2 + 2, 34, w - 12);
    if (r.foot) fitPlain(ctx, r.foot, w / 2, h - 13, 12, 500, GREY, w - 8, 10);
  }
  weatherBadge(ctx, w, entry.busy, entry.error);
}

export function drawWidget(ctx: Ctx, w: number, h: number, e: WidgetEnv) {
  ctx.save();
  part = 0;
  clock = e.t;
  animated = e.settings.roll !== false;
  WHITE = color(e.settings.color, "#ffffff");
  GREY = rgba(WHITE, 0.55);
  DIM = rgba(WHITE, 0.22);
  background(ctx, w, h, e.settings, e.t);
  const seconds = e.settings.seconds === true;
  const style = widgetStyle(e.kind, e.settings);
  scope = `${e.id}:${e.kind}:${style}`;
  const city = cityCaption(e.settings.city);
  const local = zoned(e.now, e.settings.city);
  if (e.kind === "network") network(ctx, w, h, style, e.now);
  else if (e.kind === "date") date(ctx, w, h, local, style, e.settings.extra, city);
  else if (e.kind === "page") pageWidget(ctx, w, h, e.page, style);
  else if (e.kind === "timer") timerWidget(ctx, w, h, e, style);
  else if (e.kind === "countdown") countdownWidget(ctx, w, h, e.settings, e.now);
  else if (isPet(e.kind)) drawPet(ctx, w, h, e.id, e.t, e.kind);
  else if (e.kind === "weather") currentWeather(ctx, w, h, e.settings, style);
  else if (e.kind === "forecast") forecast(ctx, w, h, e.settings, style);
  else if (isWeather(e.kind)) meteo(ctx, w, h, e.settings, style);
  else if (e.kind !== "clock") load(ctx, w, h, e.kind, style, e.now, e.settings);
  else if (style === "dial") dial(ctx, w, h, local, seconds);
  else if (style === "modern") modern(ctx, w, h, local, seconds);
  else digital(ctx, w, h, local, seconds);
  ctx.restore();
}
