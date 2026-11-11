import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { exportMedia, importMedia, type MediaFile } from "./media";
import { resumeSaving, stopSaving } from "./store";
import type { AppState } from "./types";

const EXTENSION = "osdbackup";

const filters = () => [{ name: t("backup.file"), extensions: [EXTENSION] }];

export async function createBackup(state: AppState) {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const date = new Date().toISOString().slice(0, 10);
  const path = await save({ title: t("backup.create"), defaultPath: `open-stream-deck-${date}.${EXTENSION}`, filters: filters() });
  if (!path) return false;
  await invoke("backup_create", { path, state: JSON.stringify(state), media: await exportMedia() });
  return true;
}

export async function pickBackup() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ title: t("backup.restore"), filters: filters() });
  return typeof path === "string" ? path : null;
}

export async function restoreBackup(path: string) {
  stopSaving();
  let media: MediaFile[];
  try {
    media = await invoke<MediaFile[]>("backup_restore", { path });
  } catch (e) {
    resumeSaving();
    throw e;
  }
  await importMedia(media).finally(() => invoke("app_restart"));
}
