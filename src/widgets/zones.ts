import { getLang, L, localize } from "../i18n";

const city = (zone: string, label: string, short: string = label) => ({ zone, label, short });

export const CITIES = localize([
  city("", L("Как на компьютере", "System time", "与电脑相同"), ""),
  city("Europe/Moscow", L("Москва", "Moscow", "莫斯科")),
  city("Europe/Kaliningrad", L("Калининград", "Kaliningrad", "加里宁格勒")),
  city("Europe/Samara", L("Самара", "Samara", "萨马拉")),
  city("Asia/Yekaterinburg", L("Екатеринбург", "Yekaterinburg", "叶卡捷琳堡"), L("Екб", "Yekat.", "叶卡捷琳堡")),
  city("Asia/Omsk", L("Омск", "Omsk", "鄂木斯克")),
  city("Asia/Novosibirsk", L("Новосибирск", "Novosibirsk", "新西伯利亚"), L("Новосиб", "Novosib.", "新西伯利亚")),
  city("Asia/Krasnoyarsk", L("Красноярск", "Krasnoyarsk", "克拉斯诺亚尔斯克"), L("Красноярск", "Krasnoyarsk", "克拉斯诺亚尔斯克")),
  city("Asia/Irkutsk", L("Иркутск", "Irkutsk", "伊尔库茨克")),
  city("Asia/Vladivostok", L("Владивосток", "Vladivostok", "符拉迪沃斯托克"), L("Владивосток", "Vladivostok", "海参崴")),
  city(
    "Asia/Kamchatka",
    L("Петропавловск-Камчатский", "Petropavlovsk-Kamchatsky", "堪察加彼得罗巴甫洛夫斯克"),
    L("Камчатка", "Kamchatka", "堪察加"),
  ),
  city("Europe/Minsk", L("Минск", "Minsk", "明斯克")),
  city("Europe/Kiev", L("Киев", "Kyiv", "基辅")),
  city("Asia/Almaty", L("Алматы", "Almaty", "阿拉木图")),
  city("Asia/Tashkent", L("Ташкент", "Tashkent", "塔什干")),
  city("Asia/Tbilisi", L("Тбилиси", "Tbilisi", "第比利斯")),
  city("Asia/Yerevan", L("Ереван", "Yerevan", "埃里温")),
  city("Asia/Baku", L("Баку", "Baku", "巴库")),
  city("Europe/Istanbul", L("Стамбул", "Istanbul", "伊斯坦布尔")),
  city("Europe/London", L("Лондон", "London", "伦敦")),
  city("Europe/Berlin", L("Берлин", "Berlin", "柏林")),
  city("Europe/Paris", L("Париж", "Paris", "巴黎")),
  city("Europe/Madrid", L("Мадрид", "Madrid", "马德里")),
  city("Asia/Dubai", L("Дубай", "Dubai", "迪拜")),
  city("Asia/Kolkata", L("Дели", "Delhi", "德里")),
  city("Asia/Bangkok", L("Бангкок", "Bangkok", "曼谷")),
  city("Asia/Shanghai", L("Пекин", "Beijing", "北京")),
  city("Asia/Tokyo", L("Токио", "Tokyo", "东京")),
  city("Asia/Seoul", L("Сеул", "Seoul", "首尔")),
  city("Australia/Sydney", L("Сидней", "Sydney", "悉尼")),
  city("America/New_York", L("Нью-Йорк", "New York", "纽约")),
  city("America/Chicago", L("Чикаго", "Chicago", "芝加哥")),
  city("America/Los_Angeles", L("Лос-Анджелес", "Los Angeles", "洛杉矶"), L("Лос-Андж.", "L.A.", "洛杉矶")),
  city("America/Sao_Paulo", L("Сан-Паулу", "São Paulo", "圣保罗")),
]);

const clocks = new Map<string, Intl.DateTimeFormat>();

export function cityTime(zone: string, now = new Date()) {
  const key = `${getLang()}|${zone}`;
  let f = clocks.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(getLang(), { timeZone: zone || undefined, hour: "2-digit", minute: "2-digit" });
    clocks.set(key, f);
  }
  return f.format(now);
}

const aliases: Record<string, string> = { "Europe/Kyiv": "Europe/Kiev" };

export function cityCaption(zone: unknown) {
  const id = aliases[zone as string] ?? zone;
  return CITIES.find((c) => c.zone === id)?.short ?? "";
}

const formats = new Map<string, Intl.DateTimeFormat | null>();

export function zoned(now: Date, raw: unknown): Date {
  if (typeof raw !== "string" || !raw) return now;
  const zone = aliases[raw] ?? raw;
  let f = formats.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      f = null;
    }
    formats.set(zone, f);
  }
  if (!f) return now;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(now)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return new Date(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second, now.getMilliseconds());
}
