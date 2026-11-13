import { getLang, L, localize, setLang, systemLang, t } from "./i18n";
import type { Action, ActionRef, AppState, KeyConfig, Page, Plugin, Profile, TitleStyle } from "./types";
import { PET_PLUGIN, TIMER_PLUGIN, WEATHER_PLUGIN, WIDGET_PLUGIN } from "./widgets/catalog";
import { version } from "../package.json";

export const APP_VERSION = version;

export const COLUMNS = 5;
export const ROWS = 3;
export const KEY_COUNT = COLUMNS * ROWS;
export const SIDE_SLOTS = 3;
export const PAGE_SLOTS = KEY_COUNT + SIDE_SLOTS;

export function isSideSlot(index: number) {
  return index >= KEY_COUNT;
}

export const DEFAULT_PAGE_COUNT = 5;
export const MAX_PAGES = 10;

let profileOptions: { value: string; label: string }[] = [];

export function setProfileOptions(profiles: Profile[]) {
  profileOptions = profiles.map((p) => ({ value: p.id, label: p.name }));
}

const VOLUME_STEPS = [
  { value: "2", label: "2%" },
  { value: "5", label: "5%" },
  { value: "10", label: "10%" },
];

export const OS = navigator.userAgent.includes("Windows") ? "windows" : navigator.userAgent.includes("Mac") ? "macos" : "linux";

const APP_PLACEHOLDERS = { windows: "C:\\Program Files\\…\\app.exe", macos: "/Applications/…/App.app", linux: "/usr/bin/…" };
const APP_PLACEHOLDER = APP_PLACEHOLDERS[OS];
const PLAY_PAUSE = L("Пауза / воспроизведение", "Play / Pause", "播放 / 暂停");

export const PLUGINS: Plugin[] = localize([
  {
    id: "system",
    name: L("Система", "System", "系统"),
    version: APP_VERSION,
    description: L(
      "Приложения, сайты, горячие клавиши и ввод текста",
      "Apps, websites, hotkeys and text input",
      "应用、网站、快捷键和文本输入",
    ),
    builtin: true,
    actions: [
      {
        id: "open-app",
        name: L("Открыть приложение", "Open App", "打开应用"),
        description: L(
          "Запускает выбранную программу или переключается на неё, если она уже открыта",
          "Launches the selected program, or switches to it if it is already running",
          "启动所选程序；如果程序已在运行，则切换到它",
        ),
        fields: [
          {
            id: "path",
            label: L("Приложение", "Application", "应用程序"),
            type: "text",
            placeholder: APP_PLACEHOLDER,
          },
          {
            id: "args",
            label: L("Аргументы запуска", "Launch arguments", "启动参数"),
            type: "text",
            placeholder: L("Необязательно", "Optional", "可选"),
          },
          {
            id: "focus",
            label: L(
              "Переключиться на окно, если уже запущено",
              "Switch to its window if already running",
              "如果已在运行，切换到其窗口",
            ),
            type: "toggle",
          },
        ],
      },
      {
        id: "open-url",
        name: L("Открыть сайт", "Open Website", "打开网站"),
        description: L(
          "Открывает ссылку в браузере по умолчанию",
          "Opens the link in the default browser",
          "在默认浏览器中打开链接",
        ),
        fields: [
          { id: "url", label: L("Адрес", "URL", "网址"), type: "text", placeholder: "https://" },
          {
            id: "browser",
            label: L("Браузер", "Browser", "浏览器"),
            type: "select",
            options: [
              { value: "default", label: L("По умолчанию", "Default", "默认") },
              { value: "chrome", label: "Chrome" },
              { value: "firefox", label: "Firefox" },
              { value: "edge", label: "Edge" },
            ],
          },
        ],
      },
      {
        id: "hotkey",
        name: L("Горячая клавиша", "Hotkey", "快捷键"),
        description: L("Нажимает заданное сочетание клавиш", "Presses the specified key combination", "按下指定的组合键"),
        fields: [
          {
            id: "keys",
            label: L("Сочетание клавиш", "Key combination", "组合键"),
            type: "hotkey",
            hint: L(
              "Нажмите на поле и затем нужные клавиши",
              "Click the field, then press the keys",
              "点击此处，然后按下所需的按键",
            ),
          },
        ],
      },
      {
        id: "text",
        name: L("Ввод текста", "Type Text", "输入文本"),
        description: L(
          "Печатает заранее заданный текст в активное окно",
          "Types predefined text into the active window",
          "在当前窗口中输入预设文本",
        ),
        fields: [
          {
            id: "text",
            label: L("Текст", "Text", "文本"),
            type: "textarea",
            placeholder: L("Что напечатать", "Text to type", "要输入的内容"),
          },
          { id: "enter", label: L("Нажать Enter после ввода", "Press Enter after typing", "输入后按回车键"), type: "toggle" },
        ],
      },
      {
        id: "lock",
        name: L("Заблокировать ПК", "Lock PC", "锁定电脑"),
        description: L(
          "Блокирует компьютер и показывает экран входа",
          "Locks the computer and shows the sign-in screen",
          "锁定电脑并显示登录界面",
        ),
      },
    ],
  },
  {
    id: "media",
    name: L("Мультимедиа", "Media", "媒体"),
    version: APP_VERSION,
    description: L("Управление воспроизведением и громкостью", "Playback and volume control", "播放与音量控制"),
    builtin: true,
    actions: [
      {
        id: "play-pause",
        name: PLAY_PAUSE,
        description: L("Ставит воспроизведение на паузу или продолжает его", "Pauses or resumes playback", "暂停或继续播放"),
      },
      {
        id: "next",
        name: L("Следующий трек", "Next Track", "下一曲"),
        description: L(
          "Переключает на следующий трек, удержание перематывает вперёд",
          "Skips to the next track, hold to fast-forward",
          "切换到下一曲，长按快进",
        ),
      },
      {
        id: "prev",
        name: L("Предыдущий трек", "Previous Track", "上一曲"),
        description: L("Возвращает к предыдущему треку, удержание перематывает назад", "Goes back to the previous track, hold to rewind", "返回上一曲，长按快退"),
      },
      {
        id: "volume-up",
        name: L("Громкость +", "Volume Up", "音量 +"),
        description: L(
          "Увеличивает системную громкость на шаг, удержание прибавляет непрерывно",
          "Raises the system volume by one step, hold to keep raising",
          "将系统音量调高一级，长按持续调高",
        ),
        fields: [{ id: "step", label: L("Шаг", "Step", "步长"), type: "select", options: VOLUME_STEPS }],
      },
      {
        id: "volume-down",
        name: L("Громкость −", "Volume Down", "音量 −"),
        description: L(
          "Уменьшает системную громкость на шаг, удержание убавляет непрерывно",
          "Lowers the system volume by one step, hold to keep lowering",
          "将系统音量调低一级，长按持续调低",
        ),
        fields: [{ id: "step", label: L("Шаг", "Step", "步长"), type: "select", options: VOLUME_STEPS }],
      },
      {
        id: "mute",
        name: L("Без звука", "Mute", "静音"),
        description: L("Полностью выключает или возвращает звук", "Mutes or unmutes all sound", "关闭或恢复全部声音"),
      },
    ],
  },
  {
    id: "navigation",
    name: L("Навигация", "Navigation", "导航"),
    version: APP_VERSION,
    description: L(
      "Переключение страниц и профилей устройства",
      "Switch device pages and profiles",
      "切换设备的页面和配置文件",
    ),
    builtin: true,
    actions: [
      {
        id: "next-page",
        name: L("Следующая страница", "Next Page", "下一页"),
        description: L("Переходит к следующей странице клавиш", "Goes to the next page of keys", "切换到下一页按键"),
      },
      {
        id: "prev-page",
        name: L("Предыдущая страница", "Previous Page", "上一页"),
        description: L("Возвращается к предыдущей странице клавиш", "Goes back to the previous page of keys", "返回上一页按键"),
      },
      {
        id: "profile",
        name: L("Сменить профиль", "Switch Profile", "切换配置文件"),
        description: L(
          "Переключает устройство на другой профиль",
          "Switches the device to another profile",
          "将设备切换到其他配置文件",
        ),
        fields: [
          {
            id: "profile",
            label: L("Профиль", "Profile", "配置文件"),
            type: "select",
            get options() {
              return profileOptions;
            },
          },
        ],
      },
    ],
  },
]);

PLUGINS.splice(1, 0, WIDGET_PLUGIN, TIMER_PLUGIN, WEATHER_PLUGIN, PET_PLUGIN);

export const REGISTRY: Plugin[] = PLUGINS;

export function pluginsFromIds(ids: string[]) {
  return REGISTRY.filter((p) => p.builtin || ids.includes(p.id));
}

export function findAction(plugins: Plugin[], ref: ActionRef | null): { plugin: Plugin; action: Action } | undefined {
  if (!ref) return undefined;
  const plugin = plugins.find((p) => p.id === ref.pluginId);
  const action = plugin?.actions.find((a) => a.id === ref.actionId);
  return plugin && action ? { plugin, action } : undefined;
}

let pluginsLoaded = typeof window === "undefined" || !("__TAURI_INTERNALS__" in window);

export function markPluginsLoaded() {
  pluginsLoaded = true;
}

export function actionLost(plugins: Plugin[], ref: ActionRef | null) {
  return !!ref && pluginsLoaded && !findAction(plugins, ref);
}

export const FONTS = [
  { value: "inter", label: "Inter", css: '"Inter Variable", Inter, sans-serif' },
  { value: "segoe", label: "Segoe UI", css: '"Segoe UI", system-ui, sans-serif' },
  { value: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { value: "georgia", label: "Georgia", css: "Georgia, serif" },
  { value: "consolas", label: "Consolas", css: 'Consolas, "Courier New", monospace' },
  { value: "impact", label: "Impact", css: 'Impact, "Arial Black", sans-serif' },
];

export const AUTO_COLOR = "auto";

export const TITLE_COLORS = [AUTO_COLOR, "#ffffff", "#aaaaaa", "#ff5c5c", "#ffb547", "#ffe066", "#4ade80", "#4fb3ff", "#a78bfa"];

export const DEFAULT_TITLE_STYLE: TitleStyle = {
  visible: true,
  position: "bottom",
  size: 11,
  color: AUTO_COLOR,
  font: "inter",
  bold: false,
  italic: false,
};

export function titleColor(color: string) {
  return color === AUTO_COLOR ? "#ffffff" : color;
}

export function fontCss(value: string) {
  return (FONTS.find((f) => f.value === value) ?? FONTS[0]).css;
}

export function createKey(): KeyConfig {
  return { title: "", titleStyle: { ...DEFAULT_TITLE_STYLE }, action: null, image: null, settings: {} };
}

export function createPages(): Page[] {
  return Array.from({ length: DEFAULT_PAGE_COUNT }, createPage);
}

export function createPage(): Page {
  return Array.from({ length: PAGE_SLOTS }, createKey);
}

export function createId() {
  return Math.random().toString(36).slice(2, 10);
}

export function createProfile(name: string): Profile {
  return { id: createId(), name, pages: createPages() };
}

export function createInitialState(): AppState {
  setLang(systemLang());
  const profile = createProfile(t("profile.default", { n: 1 }));
  profile.pages[0][KEY_COUNT] = { ...createKey(), action: { pluginId: WIDGET_PLUGIN.id, actionId: "clock" } };
  return {
    installedPlugins: PLUGINS.map((p) => p.id),
    pluginGlobals: {},
    profiles: [profile],
    activeProfileId: profile.id,
    device: { brightness: 100, sleepAfter: 0, keyRadius: 12, sideRadius: 12 },
    app: { autostart: true, minimizeToTray: true, autoUpdate: true, language: getLang(), theme: "dark" },
  };
}
