export type FieldType = "text" | "textarea" | "number" | "select" | "toggle" | "hotkey" | "color" | "image" | "sound";

export type Field = {
  id: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string; hint?: string }[];
  colors?: string[];
  defaultValue?: string;
  min?: number;
  max?: number;
  step?: number;
  when?: Record<string, string[]>;
};

export type Action = {
  id: string;
  name: string;
  description: string;
  fields?: Field[];
  ext?: ExternalAction;
};

export type Plugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  builtin?: boolean;
  actions: Action[];
  ext?: ExternalPlugin;
};

export type ActionRef = {
  pluginId: string;
  actionId: string;
};

export type TitlePosition = "top" | "middle" | "bottom";

export type TitleStyle = {
  visible: boolean;
  position: TitlePosition;
  size: number;
  color: string;
  font: string;
  bold: boolean;
  italic: boolean;
};

export type KeySettings = Record<string, string | boolean>;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type PluginInstance = {
  settings: JsonObject;
  state: number;
};

export type PluginTitleStyle = {
  align?: TitlePosition;
  size?: number;
  color?: string;
  bold?: boolean;
};

export type ExternalState = {
  image?: string;
  title?: string;
  showTitle?: boolean;
};

export type Permission = { kind: string; title: string; detail: string };

export type ExternalAction = {
  uuid: string;
  icon?: string;
  states: ExternalState[];
  controllers: ("key" | "side")[];
  inspector?: string;
  fields: Field[];
  title?: PluginTitleStyle;
  gestures?: { long_press?: number; hold?: number; repeat?: number };
  defaults: JsonObject;
};

export type ExternalPlugin = {
  id: string;
  dir: string;
  runtime: "wasm" | "js";
  author: string;
  icon?: string;
  homepage?: string;
  license?: string;
  settingsPage?: string;
  permissions: Permission[];
  granted: boolean;
  dev: boolean;
};

export type KeyConfig = {
  title: string;
  titleStyle: TitleStyle;
  action: ActionRef | null;
  image: string | null;
  backdrop?: string | null;
  settings: KeySettings;
  ext?: PluginInstance;
  badge?: "ok" | "alert";
  state?: number;
};

export type Page = KeyConfig[];

export type Profile = {
  id: string;
  name: string;
  pages: Page[];
};

export type DeviceSettings = {
  brightness: number;
  sleepAfter: number;
  keyRadius: number;
  sideRadius: number;
};

export type Theme = "dark" | "light";

export type AppSettings = {
  autostart: boolean;
  minimizeToTray: boolean;
  autoUpdate: boolean;
  language: string;
  theme: Theme;
};

export type AppState = {
  installedPlugins: string[];
  pluginGlobals: Record<string, JsonObject>;
  profiles: Profile[];
  activeProfileId: string;
  device: DeviceSettings;
  app: AppSettings;
};
