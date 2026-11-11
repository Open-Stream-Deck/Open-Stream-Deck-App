import { getLang } from "../i18n";
import { loadImage, type Picture } from "../deck/render";
import type { KeySettings } from "../types";

const HOSTS = ["wttr.in", "wttr.is"];
const NOT_FOUND = /not found|unknown location|unable to find/i;
const TIMEOUT_MS = 15_000;
const RETRY_MS = 60_000;
const DEFAULT_EVERY_MIN = 30;

export type Hour = { hour: number; temp: number; code: number; rain: number };
export type Day = { date: string; min: number; max: number; code: number; rain: number; sunrise: string; sunset: string; hours: Hour[] };

export type Weather = {
  place: string;
  lat: number;
  lon: number;
  temp: number;
  feels: number;
  code: number;
  desc: string;
  humidity: number;
  pressure: number;
  wind: number;
  windDir: number;
  uv: number;
  precip: number;
  visibility: number;
  cloud: number;
  days: Day[];
};

type Entry = { data: Weather | null; at: number; tried: number; born: number; busy: boolean; error: "" | "offline" | "notFound" };

const SETTLE_MS = 1000;
const CACHE_LIMIT = 16;
const cache = new Map<string, Entry>();

const num = (v: unknown) => Number(v) || 0;
const text = (v: any) => String(v?.[0]?.value ?? "").trim();

function parse(j: any, lang: string): Weather {
  const c = j.current_condition[0];
  const area = j.nearest_area?.[0] ?? {};
  const days: Day[] = (j.weather ?? []).map((d: any) => {
    const hours: Hour[] = (d.hourly ?? []).map((h: any) => ({
      hour: num(h.time) / 100,
      temp: num(h.tempC),
      code: num(h.weatherCode),
      rain: Math.max(num(h.chanceofrain), num(h.chanceofsnow)),
    }));
    return {
      date: d.date,
      min: num(d.mintempC),
      max: num(d.maxtempC),
      code: (hours.find((h) => h.hour === 12) ?? hours[0])?.code ?? 113,
      rain: Math.max(0, ...hours.map((h) => h.rain)),
      sunrise: d.astronomy?.[0]?.sunrise ?? "",
      sunset: d.astronomy?.[0]?.sunset ?? "",
      hours,
    };
  });
  return {
    place: text(area.areaName),
    lat: num(area.latitude),
    lon: num(area.longitude),
    temp: num(c.temp_C),
    feels: num(c.FeelsLikeC),
    code: num(c.weatherCode),
    desc: text(c[`lang_${lang}`]) || text(c.weatherDesc),
    humidity: num(c.humidity),
    pressure: num(c.pressure),
    wind: num(c.windspeedKmph),
    windDir: num(c.winddirDegree),
    uv: num(c.uvIndex),
    precip: num(c.precipMM),
    visibility: num(c.visibility),
    cloud: num(c.cloudcover),
    days,
  };
}

export function weatherPlace(settings: KeySettings) {
  return typeof settings.location === "string" ? settings.location.trim() : "";
}

function url(host: string, place: string, lang: string) {
  return `https://${host}/${encodeURIComponent(place).replace(/%20/g, "+")}?format=j1&lang=${lang}`;
}

async function load(entry: Entry, place: string, lang: string) {
  entry.busy = true;
  entry.tried = Date.now();
  let error: Entry["error"] = "offline";
  for (const host of HOSTS) {
    try {
      const res = await fetch(url(host, place, lang), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await res.text();
      if (!res.ok || !body.includes("current_condition")) {
        if (!NOT_FOUND.test(body)) continue;
        error = "notFound";
        entry.at = Date.now();
        break;
      }
      entry.data = parse(JSON.parse(body), lang);
      entry.at = Date.now();
      error = "";
      break;
    } catch {
    }
  }
  entry.error = error;
  entry.busy = false;
}

function prune(keep: string) {
  for (const [key, entry] of cache) {
    if (cache.size <= CACHE_LIMIT) return;
    if (key !== keep && !entry.busy) cache.delete(key);
  }
}

export function weather(settings: KeySettings, force = false) {
  const place = weatherPlace(settings);
  const lang = getLang();
  const key = `${place.toLowerCase()}|${lang}`;
  const now = Date.now();
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: null, at: 0, tried: 0, born: now, busy: false, error: "" };
    cache.set(key, entry);
    prune(key);
  }
  const every = (Number(settings.refresh) || DEFAULT_EVERY_MIN) * 60_000;
  const stale = now - entry.at > every && now - entry.tried > RETRY_MS && now - entry.born >= SETTLE_MS;
  if (!entry.busy && (stale || force)) load(entry, place, lang);
  return entry;
}

const RAD = Math.PI / 180;

export function isDay(lat: number, lon: number, at = Date.now()) {
  const d = at / 86_400_000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD;
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  const ha = (gmst + lon - ra) * RAD;
  const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha));
  return alt > -0.833 * RAD;
}

const ICON: Record<number, string> = {
  113: "skc",
  116: "bkn",
  119: "ovc",
  122: "ovc",
  143: "fg",
  248: "fg",
  260: "fg",
  176: "bkn_-ra",
  179: "bkn_-sn",
  182: "ovc_ra_sn",
  185: "ovc_-ra",
  200: "ovc_ts",
  227: "-bl",
  230: "bl",
  263: "bkn_-ra",
  266: "ovc_-ra",
  281: "ovc_-ra",
  284: "ovc_ra",
  293: "bkn_-ra",
  296: "ovc_-ra",
  299: "bkn_ra",
  302: "ovc_ra",
  305: "bkn_+ra",
  308: "ovc_+ra",
  311: "ovc_-ra",
  314: "ovc_ra",
  317: "ovc_ra_sn",
  320: "ovc_ra_sn",
  323: "bkn_-sn",
  326: "ovc_-sn",
  329: "bkn_sn",
  332: "ovc_sn",
  335: "bkn_+sn",
  338: "ovc_+sn",
  350: "ovc_ha",
  353: "bkn_-ra",
  356: "bkn_+ra",
  359: "ovc_+ra",
  362: "ovc_ra_sn",
  365: "ovc_ra_sn",
  368: "bkn_-sn",
  371: "bkn_+sn",
  374: "ovc_ha",
  377: "ovc_ha",
  386: "ovc_ts_ra",
  389: "ovc_ts_ra",
  392: "ovc_ts",
  395: "ovc_ts",
};

export function iconCode(code: number, day: boolean) {
  const base = ICON[code] ?? "ovc";
  return /^(skc|fg|bkn)/.test(base) ? `${base}_${day ? "d" : "n"}` : base;
}

const SOURCES = import.meta.glob<string>("./weather/*/*.svg", { query: "?raw", import: "default" });
const ICON_CACHE = 64;
const icons = new Map<string, Picture | null>();

export function weatherIcon(theme: unknown, code: string, color: string) {
  const set = typeof theme === "string" && SOURCES[`./weather/${theme}/${code}.svg`] ? theme : "dark";
  const tint = set === "flat" ? color : "";
  const key = `${set}/${code}/${tint}`;
  if (!icons.has(key)) {
    if (icons.size > ICON_CACHE) icons.clear();
    icons.set(key, null);
    SOURCES[`./weather/${set}/${code}.svg`]()
      .then((svg) => loadImage(`data:image/svg+xml,${encodeURIComponent(tint ? svg.replace(/"(white|#FFF)"/g, `"${tint}"`) : svg)}`))
      .then((img) => icons.set(key, img))
      .catch(() => icons.delete(key));
  }
  return icons.get(key) ?? null;
}

export const WIND_POINTS = 8;

export function windPoint(deg: number) {
  return Math.round((((deg % 360) + 360) % 360) / (360 / WIND_POINTS)) % WIND_POINTS;
}

export function clock(value: string) {
  const m = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(value.trim());
  if (!m) return "–";
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return getLang() === "en" ? value.replace(/^0/, "") : `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function temp(c: number, unit: unknown) {
  return Math.round(unit === "f" ? c * 1.8 + 32 : c);
}

export function speed(kmh: number, unit: unknown) {
  if (unit === "kmh") return { value: Math.round(kmh), unit: "kmh" as const };
  if (unit === "mph") return { value: Math.round(kmh / 1.609), unit: "mph" as const };
  return { value: Math.round(kmh / 3.6), unit: "ms" as const };
}

export function pressure(hpa: number, unit: unknown) {
  if (unit === "hpa") return { value: Math.round(hpa), unit: "hpa" as const };
  if (unit === "inhg") return { value: (hpa * 0.02953).toFixed(2), unit: "inhg" as const };
  return { value: Math.round(hpa * 0.750062), unit: "mmhg" as const };
}

import.meta.hot?.dispose(() => location.reload());
