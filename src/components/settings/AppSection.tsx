import { useState } from "preact/hooks";
import { createBackup, pickBackup, restoreBackup } from "../../backup";
import { isTauri } from "../../deck/link";
import { APP_VERSION } from "../../data";
import type { AppSettings, AppState } from "../../types";
import { checkForUpdate, type UpdateState, useUpdate } from "../../updater";
import { LANGUAGES, t } from "../../i18n";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Import } from "../ui/icons";
import { showToast } from "../ui/Toast";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { SettingGroup, SettingRow } from "./SettingRow";

type Props = {
  app: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onResetAll: () => void;
  getState: () => AppState;
};

function updateStatus(update: UpdateState) {
  switch (update.kind) {
    case "checking":
      return t("update.checking");
    case "latest":
      return t("update.latest");
    case "available":
    case "downloading":
      return t("update.available", { version: update.version });
    case "failed":
      return t("update.failed");
    default:
      return undefined;
  }
}

export function AppSection({ app, onChange, onResetAll, getState }: Props) {
  const [resetOpen, setResetOpen] = useState(false);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  async function saveBackup() {
    setBackupBusy(true);
    try {
      if (await createBackup(getState())) showToast(t("backup.saved"));
    } catch (e) {
      showToast(String(e));
    } finally {
      setBackupBusy(false);
    }
  }

  function restore(path: string) {
    setRestorePath(null);
    setBackupBusy(true);
    restoreBackup(path).catch((e) => {
      showToast(String(e));
      setBackupBusy(false);
    });
  }
  const update = useUpdate();
  const busy = update.kind === "checking" || update.kind === "downloading";

  return (
    <>
      <SettingGroup title={t("app.look")}>
        <SettingRow title={t("app.theme")}>
          <Select
            value={app.theme}
            options={[
              { value: "dark", label: t("app.theme.dark") },
              { value: "light", label: t("app.theme.light") },
            ]}
            label={t("app.theme")}
            onChange={(theme) => onChange({ theme: theme === "light" ? "light" : "dark" })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("app.general")}>
        <SettingRow title={t("app.autostart")}>
          <Toggle checked={app.autostart} onChange={(autostart) => onChange({ autostart })} />
        </SettingRow>
        <SettingRow title={t("app.tray")} description={t("app.tray.desc")}>
          <Toggle checked={app.minimizeToTray} onChange={(minimizeToTray) => onChange({ minimizeToTray })} />
        </SettingRow>
        <SettingRow title={t("app.language")}>
          <Select
            value={app.language}
            options={LANGUAGES}
            label={t("app.language")}
            onChange={(v) => onChange({ language: String(v) })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("app.updates")}>
        <SettingRow title={t("update.status", { version: APP_VERSION })} description={updateStatus(update)}>
          <button type="button" class="button" disabled={busy} onClick={() => void checkForUpdate()}>
            {t("update.check")}
          </button>
        </SettingRow>
        <SettingRow title={t("app.autoUpdate")} description={t("app.autoUpdate.desc")}>
          <Toggle checked={app.autoUpdate} onChange={(autoUpdate) => onChange({ autoUpdate })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("backup.title")}>
        <SettingRow title={t("backup.create")} description={t("backup.create.desc")}>
          <button type="button" class="button" disabled={backupBusy || !isTauri()} onClick={() => void saveBackup()}>
            {backupBusy && <span class="spinner" />}
            {t("backup.save")}
          </button>
        </SettingRow>
        <SettingRow title={t("backup.restore")} description={t("backup.restore.desc")}>
          <button
            type="button"
            class="button"
            disabled={backupBusy || !isTauri()}
            onClick={() => void pickBackup().then((path) => path && setRestorePath(path))}
          >
            {t("backup.choose")}
          </button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("app.data")}>
        <SettingRow title={t("app.resetAll")} description={t("app.resetAll.desc")}>
          <button type="button" class="button button--danger" onClick={() => setResetOpen(true)}>
            {t("common.reset")}
          </button>
        </SettingRow>
      </SettingGroup>

      <ConfirmDialog
        open={restorePath !== null}
        title={t("backup.restore.title")}
        confirmLabel={t("backup.restore.confirm")}
        icon={Import}
        onClose={() => setRestorePath(null)}
        onConfirm={() => restorePath && restore(restorePath)}
      >
        {t("backup.restore.text")}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetOpen}
        title={t("app.resetAll.title")}
        confirmLabel={t("app.resetAll.confirm")}
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          setResetOpen(false);
          onResetAll();
        }}
      >
        {t("app.resetAll.text")}
      </ConfirmDialog>
    </>
  );
}
