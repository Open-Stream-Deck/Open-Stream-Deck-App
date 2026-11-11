import { common } from "./strings/common";
import { editor } from "./strings/editor";
import { settings } from "./strings/settings";
import { widgets } from "./strings/widgets";

export const STRINGS = { ...common, ...settings, ...editor, ...widgets };

export const PLURALS = {
  actions: {
    ru: ["{n} действие", "{n} действия", "{n} действий"],
    en: ["{n} action", "{n} actions"],
    zh: ["{n} 个操作"],
  },
  downloads: {
    ru: ["{count} загрузка", "{count} загрузки", "{count} загрузок"],
    en: ["{count} download", "{count} downloads"],
    zh: ["{count} 次下载"],
  },
} satisfies Record<string, { ru: readonly string[]; en: readonly string[]; zh: readonly string[] }>;
