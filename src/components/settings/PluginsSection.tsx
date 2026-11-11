import { useEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../deck/link";
import { type Key, t, tn } from "../../i18n";
import { pluginHost } from "../../plugins/host";
import type { Plugin } from "../../types";
import { type MenuItem, openContextMenu } from "../ui/ContextMenu";
import { DocumentText, FolderOpen, Gear, Import, Refresh, Shield, Trash } from "../ui/icons";
import { PluginIcon } from "../ui/pluginIcons";
import { showToast } from "../ui/Toast";
import { Toggle } from "../ui/Toggle";
import { type Grant, GrantDialog } from "./GrantDialog";
import { PluginStore } from "./PluginStore";
import { SettingGroup, SettingRow } from "./SettingRow";

const INSTALL_DURATION = 1300;
// TODO: вернуться к реализации магазина плагинов
const STORE_ENABLED = false;

type Props = {
  installed: Plugin[];
  available: Plugin[];
  onInstall: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenFolder: (id?: string) => void;
};


const STATE: Record<string, Key> = {
  starting: "plugins.state.starting",
  restarting: "plugins.state.restarting",
  crashed: "plugins.state.crashed",
  stopped: "plugins.state.stopped",
};


function meta(plugin: Plugin) {
  const parts = [`v${plugin.version}`];
  const ext = plugin.ext;
  if (ext?.dev) parts.push(t("plugins.dev"));
  parts.push(tn("actions", plugin.actions.length));
  if (ext && ext.permissions.length && !ext.granted) parts.push(t("plugins.needsPermissions"));
  const status = ext ? pluginHost.processStatus(ext.id) : undefined;
  if (status && status.state !== "running" && STATE[status.state]) parts.push(status.message ? `${t(STATE[status.state])}: ${status.message}` : t(STATE[status.state]));
  return parts.join(" · ");
}

async function pick() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ title: t("plugins.pickFile"), filters: [{ name: t("plugins.fileFilter"), extensions: ["opensd"] }] });
  return typeof picked === "string" ? picked : null;
}

async function revealLog(id: string) {
  const path = await invoke<string | null>("plugin_log_path", { id });
  if (!path) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export function PluginsSection({ installed, available, onInstall, onDelete, onOpenFolder }: Props) {
  const [installing, setInstalling] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const [, rerender] = useState(0);
  const timers = useRef<number[]>([]);

  const review = (request: Grant) => {
    setGrant(request);
    setGrantOpen(true);
  };

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      await pluginHost.refresh();
    } catch (error) {
      showToast(String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isTauri()) void invoke<{ enabled: boolean }>("plugin_dev_status").then((s) => setDeveloperMode(s.enabled));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => pluginHost.subscribe(() => rerender((n) => n + 1)), []);

  function install(id: string) {
    setInstalling((list) => [...list, id]);
    timers.current.push(
      window.setTimeout(() => {
        setInstalling((list) => list.filter((x) => x !== id));
        onInstall(id);
        showToast(t("plugins.installed"));
      }, INSTALL_DURATION),
    );
  }

  async function installFromFile() {
    if (!isTauri()) {
      showToast(t("plugins.appOnly"));
      return;
    }
    const path = await pick().catch(() => null);
    if (!path) return;
    setBusy(true);
    try {
      const plugin = await pluginHost.install(path);
      showToast(t("plugins.installedNamed", { name: plugin.manifest.name }));
      if (plugin.permissions.length && !plugin.granted) {
        review(await invoke<Grant>("plugin_permissions_review", { id: plugin.id }));
      }
    } catch (e) {
      showToast(t("plugins.installFailed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeveloperMode(enabled: boolean) {
    try {
      const status = await invoke<{ enabled: boolean }>("plugin_dev_enable", { enabled });
      setDeveloperMode(status.enabled);
    } catch (error) {
      const status = await invoke<{ enabled: boolean }>("plugin_dev_status");
      setDeveloperMode(status.enabled);
      showToast(String(error));
    }
  }

  function pluginMenu(plugin: Plugin): MenuItem[] {
    const id = plugin.id;
    const ext = plugin.ext;
    const items: MenuItem[] = [];
    if (ext?.settingsPage) {
      items.push({ label: t("plugins.settingsPage"), icon: Gear, onSelect: () => pluginHost.openSettingsPage(id) });
    }
    if (ext?.permissions.length) {
      items.push({
        label: t(ext.granted ? "plugins.revokePermissions" : "plugins.allowPermissions"),
        icon: Shield,
        disabled: busy,
        onSelect: () => {
          if (ext.granted) void run(() => invoke("plugin_permissions_revoke", { id }));
          else invoke<Grant>("plugin_permissions_review", { id }).then(review).catch((e) => showToast(String(e)));
        },
      });
    }
    if (ext) {
      items.push(
        { label: t("plugins.openLog"), icon: DocumentText, onSelect: () => void revealLog(id).catch((e) => showToast(String(e))) },
        {
          label: t("common.restart"),
          icon: Refresh,
          onSelect: () =>
            void pluginHost
              .restart(id)
              .then(() => showToast(t("plugins.restarted", { name: plugin.name })))
              .catch((e) => showToast(String(e))),
        },
      );
    }
    items.push(
      { label: t("common.openFolder"), icon: FolderOpen, onSelect: () => onOpenFolder(id) },
      "separator",
      { label: t("common.delete"), icon: Trash, danger: true, disabled: ext?.dev, onSelect: () => onDelete(id) },
    );
    return items;
  }

  return (
    <>
      <div class="plugins-toolbar">
        <button type="button" class="button" onClick={() => onOpenFolder()}>
          <FolderOpen size={16} />
          {t("plugins.openFolder")}
        </button>
        <button type="button" class="button" disabled={busy} onClick={installFromFile}>
          {busy ? <span class="spinner" /> : <Import size={16} />}
          {t("plugins.installFile")}
        </button>
      </div>

      <SettingGroup title={t("plugins.devGroup")}>
        <SettingRow title={t("plugins.devMode")} description={t("plugins.devMode.desc")}>
          <Toggle checked={developerMode} label={t("plugins.devMode")} onChange={toggleDeveloperMode} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("plugins.installedGroup")}>
        {installed.map((plugin) => (
          <div key={plugin.id} class="plugin-row">
            <PluginIcon pluginId={plugin.id} src={plugin.ext?.icon} />
            <div class="plugin-row__text">
              <span class="plugin-row__name">
                {plugin.name}
                {plugin.builtin && <span class="badge">{t("plugins.builtin")}</span>}
              </span>
              <span class="plugin-row__meta" data-tip={meta(plugin)}>
                {meta(plugin)}
              </span>
            </div>
            <div class="plugin-row__actions">
              {!plugin.builtin && (
                <button
                  type="button"
                  class="icon-button plugin-row__gear"
                  aria-label={t("common.more")}
                  onClick={(e) => openContextMenu(e, pluginMenu(plugin))}
                >
                  <Gear size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </SettingGroup>

      <SettingGroup title={t("plugins.availableGroup")}>
        {available.length === 0 ? (
          <p class="plugins-empty">{t("plugins.allInstalled")}</p>
        ) : (
          available.map((plugin) => {
            const installingThis = installing.includes(plugin.id);
            return (
              <div key={plugin.id} class="plugin-row">
                <PluginIcon pluginId={plugin.id} src={plugin.ext?.icon} />
                <div class="plugin-row__text">
                  <span class="plugin-row__name">{plugin.name}</span>
                  <span class="plugin-row__meta">
                    v{plugin.version} · {plugin.description}
                  </span>
                </div>
                <button type="button" class="button" disabled={installingThis} onClick={() => install(plugin.id)}>
                  {installingThis && <span class="spinner" />}
                  {installingThis ? t("common.installing") : t("common.install")}
                </button>
              </div>
            );
          })
        )}
      </SettingGroup>

      {STORE_ENABLED && (
        <PluginStore
          onInstalled={(plugin) => {
            if (plugin.permissions.length && !plugin.granted) {
              invoke<Grant>("plugin_permissions_review", { id: plugin.id }).then(review).catch((e) => showToast(String(e)));
            }
          }}
        />
      )}

      <GrantDialog
        grant={grant}
        open={grantOpen}
        icon={installed.find((p) => p.id === grant?.id)?.ext?.icon}
        onClose={() => setGrantOpen(false)}
        onAllow={() => {
          if (!grant || busy) return;
          setGrantOpen(false);
          void run(() => invoke("plugin_permissions_approve", { id: grant.id, digest: grant.digest }));
        }}
      />
    </>
  );
}
