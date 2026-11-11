import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { showToast } from "./components/ui/Toast";
import { isTauri } from "./deck/link";

function pluginsDir() {
  return invoke<string>("plugins_folder");
}

async function reveal(path: () => Promise<string>) {
  if (!isTauri()) {
    showToast(t("system.foldersAppOnly"));
    return;
  }
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(await path());
  } catch {
    showToast(t("system.folderFailed"));
  }
}

export function openPluginsFolder() {
  return reveal(pluginsDir);
}

export async function openPluginFolder(pluginId: string) {
  return reveal(async () => {
    const { join } = await import("@tauri-apps/api/path");
    return join(await pluginsDir(), pluginId);
  });
}
