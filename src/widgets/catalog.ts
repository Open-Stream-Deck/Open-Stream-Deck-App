import { L, localize, t } from "../i18n";
import type { Field, KeySettings, Plugin } from "../types";
import { driveLetter, stats } from "./stats";
import { CITIES, cityTime } from "./zones";
import { version } from "../../package.json";

export type WidgetKind = "clock" | "date" | "page" | "cpu" | "ram" | "disk" | "gpu" | "network" | "timer" | "countdown" | "fox" | "cat" | "dog" | "bunny" | "weather" | "forecast" | "meteo";

export const WIDGET_PLUGIN_ID = "widgets";
export const TIMER_PLUGIN_ID = "timer";
export const PET_PLUGIN_ID = "pet";
export const WEATHER_PLUGIN_ID = "weather";

type Spec = {
  name: string;
  description: string;
  styles: { value: string; label: string }[];
  fields?: Field[];
  system?: boolean;
};

const APPEARANCE: Field[] = localize([
  { id: "color", label: L("Цвет", "Color", "颜色"), type: "color", defaultValue: "#ffffff" },
  {
    id: "background",
    label: L("Фон", "Background", "背景"),
    type: "image",
    hint: L("Картинка или GIF до 8 МБ", "Image or GIF up to 8 MB", "图片或 GIF，不超过 8 MB"),
  },
  {
    id: "backgroundColor",
    label: L("Цвет фона", "Background color", "背景颜色"),
    type: "color",
    defaultValue: "#000000",
    colors: ["#000000", "#1c1c1e", "#2c2c2e", "#0a1f3d", "#0f2e1c", "#3a1414", "#2a1740", "#3a2a0c"],
  },
  {
    id: "dim",
    label: L("Затемнение картинки", "Image dimming", "图片调暗"),
    type: "select",
    defaultValue: "40",
    options: ["0", "20", "40", "60", "80"].map((v) => ({ value: v, label: v === "0" ? L("Нет", "None", "无") : `${v}%` })),
  },
]);

const ROLL: Field = localize({
  id: "roll",
  label: L("Анимация цифр", "Digit animation", "数字动画"),
  type: "toggle",
  defaultValue: "true",
});

const DISK: Field = localize({
  id: "disk",
  label: L("Диск", "Disk", "磁盘"),
  type: "select",
  get options() {
    const disks = stats()?.stats.disks ?? [];
    return disks.length
      ? disks.map((d) => ({ value: d.id, label: d.name ? `${driveLetter(d.id)} ${d.name}` : driveLetter(d.id) }))
      : [{ value: "", label: t("common.none") }];
  },
});

const GPU: Field = localize({
  id: "gpu",
  label: L("Видеокарта", "Graphics card", "显卡"),
  type: "select",
  get options() {
    const gpus = stats()?.stats.gpus ?? [];
    return gpus.length ? gpus.map((g) => ({ value: g.id, label: g.name })) : [{ value: "", label: t("common.none") }];
  },
});

const CITY: Field = localize({
  id: "city",
  label: L("Город", "City", "城市"),
  type: "select",
  defaultValue: "",
  options: CITIES.map((c) => ({
    value: c.zone,
    get label() {
      return c.label;
    },
    get hint() {
      return cityTime(c.zone);
    },
  })),
});

const PLACE: Field = localize({
  id: "location",
  label: L("Город", "City", "城市"),
  type: "text",
  placeholder: L("Определить по IP", "Detect by IP", "按 IP 自动定位"),
  hint: L(
    "Название, индекс, код аэропорта, координаты 55.75,37.62 или ~Эйфелева башня",
    "Name, ZIP code, airport code, coordinates 55.75,37.62 or ~Eiffel Tower",
    "名称、邮编、机场代码、坐标 55.75,37.62 或 ~Eiffel Tower",
  ),
});

const TEMP_UNIT: Field = localize({
  id: "tempUnit",
  when: { metric: ["feels"], style: ["icon", "big", "detail", "day", "hours", "number", "ring"] },
  label: L("Температура", "Temperature", "温度"),
  type: "select",
  defaultValue: "c",
  options: [
    { value: "c", label: "°C" },
    { value: "f", label: "°F" },
  ],
});

const WIND_UNIT: Field = localize({
  id: "windUnit",
  when: { metric: ["wind"] },
  label: L("Скорость ветра", "Wind speed", "风速"),
  type: "select",
  defaultValue: "ms",
  options: [
    { value: "ms", label: L("м/с", "m/s", "米/秒") },
    { value: "kmh", label: L("км/ч", "km/h", "公里/时") },
    { value: "mph", label: L("миль/ч", "mph", "英里/时") },
  ],
});

const PRESSURE_UNIT: Field = localize({
  id: "pressureUnit",
  when: { metric: ["pressure"] },
  label: L("Давление", "Pressure", "气压"),
  type: "select",
  defaultValue: "mmhg",
  options: [
    { value: "mmhg", label: L("мм рт. ст.", "mmHg", "毫米汞柱") },
    { value: "hpa", label: L("гПа", "hPa", "百帕") },
    { value: "inhg", label: L("дюймы рт. ст.", "inHg", "英寸汞柱") },
  ],
});

const ICONS: Field = localize({
  id: "icons",
  when: { style: ["icon", "big", "detail", "day"] },
  label: L("Иконки", "Icons", "图标"),
  type: "select",
  defaultValue: "dark",
  options: [
    { value: "dark", label: L("Цветные", "Colored", "彩色") },
    { value: "circle", label: L("В круге", "In a circle", "圆形") },
    { value: "flat", label: L("Плоские, цветом виджета", "Flat, in the widget color", "扁平，跟随小组件颜色") },
    { value: "light", label: L("Для светлого фона", "For a light background", "适合浅色背景") },
  ],
});

const REFRESH: Field = localize({
  id: "refresh",
  label: L("Обновлять", "Refresh", "刷新"),
  type: "select",
  defaultValue: "30",
  hint: L("Нажатие на клавишу обновляет сразу", "Pressing the key refreshes right away", "按下按键立即刷新"),
  options: [
    { value: "15", label: L("Раз в 15 мин", "Every 15 min", "每 15 分钟") },
    { value: "30", label: L("Раз в 30 мин", "Every 30 min", "每 30 分钟") },
    { value: "60", label: L("Раз в час", "Every hour", "每小时") },
    { value: "180", label: L("Раз в 3 часа", "Every 3 hours", "每 3 小时") },
  ],
});

const DAY: Field = localize({
  id: "day",
  label: L("День", "Day", "日期"),
  type: "select",
  defaultValue: "0",
  options: [
    { value: "0", label: L("Сегодня", "Today", "今天") },
    { value: "1", label: L("Завтра", "Tomorrow", "明天") },
    { value: "2", label: L("Послезавтра", "Day after tomorrow", "后天") },
  ],
});

const NUMBER = L("Число", "Number", "数字");
const RING = L("Кольцо", "Ring", "圆环");
const GRAPH = L("График", "Graph", "图表");

const PIXEL = [{ value: "pixel", label: L("Пиксельный", "Pixel", "像素") }];

const LOAD_STYLES = [
  { value: "number", label: NUMBER },
  { value: "ring", label: RING },
  { value: "graph", label: GRAPH },
];

export const WIDGETS: Record<WidgetKind, Spec> = localize({
  clock: {
    name: L("Время", "Time", "时间"),
    description: L(
      "Часы: цифровые, классический циферблат или стильные цифры",
      "Clock: digital, classic dial or stylish numerals",
      "时钟：数字、经典表盘或时尚数字",
    ),
    styles: [
      { value: "digital", label: L("Цифровые", "Digital", "数字") },
      { value: "dial", label: L("Циферблат", "Dial", "表盘") },
      { value: "modern", label: L("Стильные цифры", "Stylish numerals", "时尚数字") },
    ],
    fields: [CITY, { id: "seconds", label: L("Секунды", "Seconds", "秒"), type: "toggle" }],
  },
  date: {
    name: L("Дата", "Date", "日期"),
    description: L(
      "День недели, число и месяц; выходные выделены",
      "Weekday, day and month; weekends highlighted",
      "星期、日期和月份；周末突出显示",
    ),
    styles: [
      { value: "calendar", label: L("Календарь", "Calendar", "日历") },
      { value: "line", label: L("Строка", "Line", "单行") },
    ],
    fields: [
      CITY,
      {
        id: "extra",
        label: L("Дополнительно", "Extra", "附加信息"),
        type: "select",
        defaultValue: "none",
        options: [
          { value: "none", label: L("Ничего", "Nothing", "无") },
          { value: "week", label: L("Номер недели", "Week number", "周数") },
          { value: "day", label: L("День года", "Day of the year", "一年中的第几天") },
          { value: "left", label: L("Дней до Нового года", "Days until New Year", "距新年天数") },
        ],
      },
    ],
  },
  page: {
    name: L("Страница", "Page", "页面"),
    description: L(
      "Номер текущей страницы",
      "Current page number",
      "当前页码",
    ),
    styles: [
      { value: "number", label: NUMBER },
      { value: "dots", label: L("Точки", "Dots", "圆点") },
    ],
  },
  cpu: {
    name: L("Процессор", "CPU", "处理器"),
    description: L("Загрузка процессора, обновляется раз в секунду", "CPU load, updated every second", "处理器占用率，每秒更新"),
    styles: LOAD_STYLES,
    system: true,
  },
  ram: {
    name: L("Память", "Memory", "内存"),
    description: L("Занятая оперативная память, обновляется раз в секунду", "RAM in use, updated every second", "已用内存，每秒更新"),
    styles: LOAD_STYLES,
    system: true,
  },
  disk: {
    name: L("Диск", "Disk", "磁盘"),
    description: L("Заполненность системного диска", "System drive usage", "系统盘占用"),
    styles: [
      { value: "number", label: NUMBER },
      { value: "ring", label: RING },
    ],
    fields: [DISK],
    system: true,
  },
  gpu: {
    name: L("Видеокарта", "Graphics card", "显卡"),
    description: L(
      "Загрузка и видеопамять видеокарты, обновляется раз в секунду",
      "Graphics card load and video memory, updated every second",
      "显卡占用和显存，每秒更新",
    ),
    styles: LOAD_STYLES,
    fields: [GPU],
    system: true,
  },
  timer: {
    name: L("Таймер", "Timer", "计时器"),
    description: L(
      "Нажатие запускает и ставит на паузу, удержание сбрасывает",
      "Press to start or pause, hold to reset",
      "按下开始或暂停，长按重置",
    ),
    styles: [
      { value: "number", label: L("Цифры", "Numbers", "数字") },
      { value: "ring", label: RING },
    ],
    fields: [
      {
        id: "minutes",
        label: L("Минуты", "Minutes", "分钟"),
        type: "number",
        placeholder: "5",
        min: 1,
        max: 999,
        step: 1,
      },
      {
        id: "sound",
        label: L("Звук", "Sound", "提示音"),
        type: "sound",
        defaultValue: "chime",
        options: [
          { value: "none", label: L("Без звука", "No sound", "无") },
          { value: "chime", label: L("Колокольчик", "Chime", "风铃") },
          { value: "bell", label: L("Колокол", "Bell", "铃声") },
          { value: "beep", label: L("Будильник", "Alarm", "闹钟") },
          { value: "soft", label: L("Мягкий", "Soft", "柔和") },
          { value: "file", label: L("Свой файл", "Custom file", "自定义文件") },
        ],
      },
      {
        id: "volume",
        label: L("Громкость", "Volume", "音量"),
        type: "select",
        defaultValue: "75",
        hint: L("От системной громкости", "Relative to the system volume", "相对于系统音量"),
        options: ["25", "50", "75", "100"].map((v) => ({ value: v, label: `${v}%` })),
      },
      { id: "repeat", label: L("Повторять до сброса", "Repeat until reset", "重复直到重置"), type: "toggle" },
      {
        id: "pressReset",
        label: L("Сброс нажатием", "Reset on press", "按下重置"),
        type: "toggle",
        defaultValue: "true",
      },
      {
        id: "autoReset",
        label: L("Автосброс", "Auto reset", "自动重置"),
        type: "select",
        defaultValue: "0",
        options: [
          { value: "0", label: L("Нет", "Off", "关闭") },
          { value: "10", label: L("Через 10 с", "After 10 s", "10 秒后") },
          { value: "30", label: L("Через 30 с", "After 30 s", "30 秒后") },
          { value: "60", label: L("Через 1 мин", "After 1 min", "1 分钟后") },
          { value: "300", label: L("Через 5 мин", "After 5 min", "5 分钟后") },
        ],
      },
    ],
  },
  countdown: {
    name: L("Обратный отсчёт", "Countdown", "倒计时"),
    description: L(
      "Сколько осталось до даты или времени",
      "Time left until a date or time",
      "距离某个日期或时间还剩多久",
    ),
    styles: [{ value: "number", label: L("Цифры", "Numbers", "数字") }],
    fields: [
      {
        id: "target",
        label: L("Когда", "When", "时间"),
        type: "text",
        placeholder: "01.01",
        hint: L(
          "ДД.ММ.ГГГГ ЧЧ:ММ, можно только дату или только время",
          "DD.MM.YYYY HH:MM, a date or a time alone works too",
          "DD.MM.YYYY HH:MM，也可只填日期或时间",
        ),
      },
    ],
  },
  fox: {
    name: L("Лисёнок", "Fox Cub", "小狐狸"),
    description: L(
      "Белый лисёнок живёт своей жизнью: спит, играет, гуляет. Нажмите, чтобы погладить",
      "A white fox cub living its own life: sleeps, plays, wanders. Press to pet it",
      "一只白色小狐狸过着自己的生活：睡觉、玩耍、闲逛。按下按键摸摸它",
    ),
    styles: PIXEL,
  },
  cat: {
    name: L("Котёнок", "Kitten", "小猫"),
    description: L(
      "Рыжий котёнок: умывается, охотится на бабочек, гоняет мячик и много спит. Нажмите, чтобы погладить",
      "A ginger kitten: grooms, hunts butterflies, chases a ball and sleeps a lot. Press to pet it",
      "一只橘色小猫：舔毛、扑蝴蝶、追球，还很爱睡觉。按下按键摸摸它",
    ),
    styles: PIXEL,
  },
  dog: {
    name: L("Щенок", "Puppy", "小狗"),
    description: L(
      "Щенок с висячими ушами: обожает мячик и иногда лает. Нажмите, чтобы погладить",
      "A floppy-eared puppy: loves the ball and barks now and then. Press to pet it",
      "一只垂耳小狗：最爱玩球，偶尔会叫几声。按下按键摸摸它",
    ),
    styles: PIXEL,
  },
  bunny: {
    name: L("Зайчонок", "Bunny", "小兔"),
    description: L(
      "Зайчонок скачет, грызёт морковку и дремлет. Нажмите, чтобы погладить",
      "A bunny that hops around, nibbles carrots and naps. Press to pet it",
      "一只小兔：蹦蹦跳跳、啃胡萝卜、打瞌睡。按下按键摸摸它",
    ),
    styles: PIXEL,
  },
  weather: {
    name: L("Погода сейчас", "Current weather", "当前天气"),
    description: L(
      "Температура, иконка и описание погоды от wttr.in",
      "Temperature, icon and conditions from wttr.in",
      "来自 wttr.in 的温度、图标和天气描述",
    ),
    styles: [
      { value: "icon", label: L("Иконка", "Icon", "图标") },
      { value: "big", label: L("Крупная температура", "Large temperature", "大号温度") },
      { value: "detail", label: L("Подробно", "Detailed", "详细") },
    ],
    fields: [
      PLACE,
      {
        id: "caption",
        when: { style: ["icon", "big"] },
        label: L("Подпись", "Caption", "说明"),
        type: "select",
        defaultValue: "place",
        options: [
          { value: "place", label: L("Город", "City", "城市") },
          { value: "desc", label: L("Описание погоды", "Conditions", "天气描述") },
          { value: "feels", label: L("Ощущается как", "Feels like", "体感温度") },
          { value: "none", label: L("Без подписи", "None", "无") },
        ],
      },
      ICONS,
      TEMP_UNIT,
      REFRESH,
    ],
  },
  forecast: {
    name: L("Прогноз", "Forecast", "天气预报"),
    description: L(
      "Прогноз на сегодня, завтра или послезавтра: иконка, минимум и максимум или график по часам",
      "Forecast for today, tomorrow or the day after: icon with low and high, or an hourly graph",
      "今天、明天或后天的预报：图标加最低和最高温度，或逐小时曲线",
    ),
    styles: [
      { value: "day", label: L("День", "Day", "日") },
      { value: "hours", label: L("По часам", "Hourly", "逐小时") },
      { value: "rain", label: L("Вероятность осадков", "Chance of precipitation", "降水概率") },
    ],
    fields: [DAY, PLACE, ICONS, TEMP_UNIT, REFRESH],
  },
  meteo: {
    name: L("Показатель погоды", "Weather detail", "天气指标"),
    description: L(
      "Один показатель крупно: ветер, влажность, давление, УФ-индекс, восход и закат",
      "One value in large type: wind, humidity, pressure, UV index, sunrise and sunset",
      "大字显示单项指标：风、湿度、气压、紫外线指数、日出日落",
    ),
    styles: [
      { value: "number", label: NUMBER },
      { value: "ring", label: RING },
    ],
    fields: [
      {
        id: "metric",
        label: L("Показатель", "Value", "指标"),
        type: "select",
        defaultValue: "wind",
        options: [
          { value: "wind", label: L("Ветер", "Wind", "风") },
          { value: "feels", label: L("Ощущается как", "Feels like", "体感温度") },
          { value: "humidity", label: L("Влажность", "Humidity", "湿度") },
          { value: "pressure", label: L("Давление", "Pressure", "气压") },
          { value: "uv", label: L("УФ-индекс", "UV index", "紫外线指数") },
          { value: "cloud", label: L("Облачность", "Cloud cover", "云量") },
          { value: "precip", label: L("Осадки", "Precipitation", "降水") },
          { value: "visibility", label: L("Видимость", "Visibility", "能见度") },
          { value: "sun", label: L("Восход и закат", "Sunrise and sunset", "日出日落") },
        ],
      },
      PLACE,
      TEMP_UNIT,
      WIND_UNIT,
      PRESSURE_UNIT,
      REFRESH,
    ],
  },
  network: {
    name: L("Сеть", "Network", "网络"),
    description: L(
      "Скорость загрузки и отдачи, обновляется раз в секунду",
      "Download and upload speed, updated every second",
      "下载和上传速度，每秒更新",
    ),
    styles: [
      { value: "number", label: L("Цифры", "Numbers", "数字") },
      { value: "graph", label: GRAPH },
    ],
    system: true,
  },
});

export const WIDGET_KINDS = Object.keys(WIDGETS) as WidgetKind[];

const PETS: WidgetKind[] = ["fox", "cat", "dog", "bunny"];

export function isPet(kind: WidgetKind) {
  return PETS.includes(kind);
}

export function isWidgetKind(id: string): id is WidgetKind {
  return id in WIDGETS;
}

const STYLE = L("Вид", "Style", "样式");

export function widgetFields(kind: WidgetKind): Field[] {
  if (isPet(kind)) return APPEARANCE.slice(1);
  const spec = WIDGETS[kind];
  return [localize({ id: "style", label: STYLE, type: "select", options: spec.styles }), ...(spec.fields ?? []), ROLL, ...APPEARANCE];
}

const WEATHER: WidgetKind[] = ["weather", "forecast", "meteo"];

export function isWeather(kind: WidgetKind) {
  return WEATHER.includes(kind);
}

export function widgetPlugin(kind: WidgetKind) {
  if (isPet(kind)) return PET_PLUGIN_ID;
  if (isWeather(kind)) return WEATHER_PLUGIN_ID;
  return kind === "timer" || kind === "countdown" ? TIMER_PLUGIN_ID : WIDGET_PLUGIN_ID;
}

function widgetActions(pluginId: string) {
  return WIDGET_KINDS.filter((kind) => widgetPlugin(kind) === pluginId).map((kind) => ({
    id: kind,
    get name() {
      return WIDGETS[kind].name;
    },
    get description() {
      return WIDGETS[kind].description;
    },
    fields: widgetFields(kind),
  }));
}

export const WIDGET_PLUGIN: Plugin = localize({
  id: WIDGET_PLUGIN_ID,
  name: L("Виджеты", "Widgets", "小组件"),
  version,
  description: L("Живые виджеты для клавиш и бокового экрана", "Live widgets for keys and the side screen", "用于按键和侧屏的实时小组件"),
  builtin: true,
  actions: widgetActions(WIDGET_PLUGIN_ID),
});

export const TIMER_PLUGIN: Plugin = localize({
  id: TIMER_PLUGIN_ID,
  name: L("Таймер", "Timer", "计时器"),
  version,
  description: L("Таймер и обратный отсчёт на клавишах", "Timer and countdown on keys", "按键上的计时器和倒计时"),
  builtin: true,
  actions: widgetActions(TIMER_PLUGIN_ID),
});

export const PET_PLUGIN: Plugin = localize({
  id: PET_PLUGIN_ID,
  name: L("Питомцы", "Pets", "宠物"),
  version,
  description: L("Пиксельные зверята на клавишах и боковом экране", "Pixel pets for keys and the side screen", "按键和侧屏上的像素小动物"),
  builtin: true,
  actions: widgetActions(PET_PLUGIN_ID),
});

export const WEATHER_PLUGIN: Plugin = localize({
  id: WEATHER_PLUGIN_ID,
  name: L("Погода", "Weather", "天气"),
  version,
  description: L(
    "Погода и прогноз с wttr.in, без ключей и регистрации",
    "Weather and forecast from wttr.in, no keys or sign-up",
    "来自 wttr.in 的天气和预报，无需密钥或注册",
  ),
  builtin: true,
  actions: widgetActions(WEATHER_PLUGIN_ID),
});

export function widgetStyle(kind: WidgetKind, settings: KeySettings) {
  const styles = WIDGETS[kind].styles;
  const s = settings.style;
  return typeof s === "string" && styles.some((o) => o.value === s) ? s : styles[0].value;
}
