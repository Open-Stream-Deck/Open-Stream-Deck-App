import { PLURALS, STRINGS } from "./strings";

export type Lang = "ru" | "en" | "zh";
export type Key = keyof typeof STRINGS;
export type PluralKey = keyof typeof PLURALS;
type Vars = Record<string, string | number>;

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
];

const INDEX: Record<Lang, number> = { ru: 0, en: 1, zh: 2 };
const HTML_LANG: Record<Lang, string> = { ru: "ru", en: "en", zh: "zh-CN" };

let current: Lang = "ru";

export function normalizeLang(value: string | undefined | null): Lang {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("ru")) return "ru";
  if (v.startsWith("zh")) return "zh";
  return "en";
}

export function systemLang(): Lang {
  return normalizeLang(typeof navigator === "undefined" ? "" : navigator.language);
}

export function setLang(lang: string) {
  const next = normalizeLang(lang);
  if (next === current) return;
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = HTML_LANG[next];
}

export function getLang(): Lang {
  return current;
}

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function t(key: Key, vars?: Vars): string {
  return fill(STRINGS[key][INDEX[current]], vars);
}

function pluralIndex(lang: Lang, n: number) {
  const a = Math.abs(n);
  if (lang === "ru") {
    if (a % 10 === 1 && a % 100 !== 11) return 0;
    if (a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 12 || a % 100 > 14)) return 1;
    return 2;
  }
  if (lang === "en") return a === 1 ? 0 : 1;
  return 0;
}

export function tn(key: PluralKey, n: number, vars?: Vars): string {
  const forms = PLURALS[key][current];
  const form = forms[Math.min(pluralIndex(current, n), forms.length - 1)];
  return fill(form, { n, ...vars });
}

export class Text {
  constructor(private readonly forms: readonly [string, string, string]) {}
  get value() {
    return this.forms[INDEX[current]];
  }
}

export function L(ru: string, en: string, zh: string): string {
  return new Text([ru, en, zh]) as unknown as string;
}

export function localize<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(localize);
    return value;
  }
  if (value && typeof value === "object" && !(value instanceof Text)) {
    const record = value as Record<string, unknown>;
    for (const field of Object.keys(record)) {
      const item = record[field];
      if (item instanceof Text) {
        Object.defineProperty(record, field, { get: () => item.value, enumerable: true, configurable: true });
      } else {
        localize(item);
      }
    }
  }
  return value;
}
