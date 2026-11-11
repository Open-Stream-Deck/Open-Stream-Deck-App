import { useEffect, useState } from "preact/hooks";
import { getLang, t, tn } from "../../i18n";
import { pluginHost, useExternalPlugins } from "../../plugins/host";
import type { PluginInfo } from "../../plugins/model";
import { hasUpdate, storeList, type StorePlugin } from "../../plugins/store";
import { Close, Verified } from "../ui/icons";
import { Modal } from "../ui/Modal";
import { ScrollArea } from "../ui/ScrollArea";
import { showToast } from "../ui/Toast";
import { PermissionList } from "./PermissionList";
import { SettingGroup } from "./SettingRow";

function Tile({ plugin, size }: { plugin: StorePlugin; size: number }) {
  const [broken, setBroken] = useState(false);
  const image = plugin.icon && !broken;
  const tile = image ? "transparent" : (plugin.color ?? "#48484a");
  return (
    <span class="store-tile" style={`--tile: ${tile}; --size: ${size}px`}>
      {image ? <img src={plugin.icon ?? ""} alt="" onError={() => setBroken(true)} /> : plugin.name[0]}
    </span>
  );
}

function Badge({ plugin }: { plugin: StorePlugin }) {
  if (!plugin.verified) return null;
  return (
    <span class="store-verified" role="img" aria-label={t("store.verified")} data-tip={t("store.verified")}>
      <Verified size={15} />
    </span>
  );
}

function downloads(n: number) {
  return tn("downloads", n, { count: new Intl.NumberFormat(getLang(), { notation: "compact" }).format(n) });
}

function ActionButton({ plugin, busy, onRun }: { plugin: StorePlugin; busy: boolean; onRun: () => void }) {
  if (plugin.installed && !hasUpdate(plugin)) return <span class="store-installed">{t("store.installed")}</span>;
  const update = hasUpdate(plugin);
  return (
    <button
      type="button"
      class={update ? "button button--primary" : "button"}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onRun();
      }}
    >
      {busy && <span class="spinner" />}
      {busy ? t(update ? "store.updating" : "common.installing") : t(update ? "store.update" : "common.install")}
    </button>
  );
}

export function PluginStore({ onInstalled }: { onInstalled: (plugin: PluginInfo) => void }) {
  const [plugins, setPlugins] = useState<StorePlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const shown = plugins?.find((p) => p.id === shownId);

  function load() {
    setError(null);
    storeList()
      .then(setPlugins)
      .catch((e) => setError(String(e)));
  }

  const installed = useExternalPlugins()
    .map((p) => `${p.id}@${p.version}`)
    .join();
  useEffect(load, [installed]);

  function open(id: string) {
    setShownId(id);
    setOpenId(id);
  }

  async function run(plugin: StorePlugin) {
    const update = hasUpdate(plugin);
    setBusy((b) => [...b, plugin.id]);
    try {
      const info = await pluginHost.installFromStore(plugin.id);
      showToast(t(update ? "store.updated" : "plugins.installedNamed", { name: plugin.name }));
      onInstalled(info);
    } catch (e) {
      showToast(t("plugins.installFailed", { error: String(e) }));
    } finally {
      setBusy((b) => b.filter((id) => id !== plugin.id));
    }
  }

  return (
    <SettingGroup title={t("store.title")}>
      {error ? (
        <p class="plugins-empty store-loading">
          {error}
          <button type="button" class="button" onClick={load}>
            {t("store.retry")}
          </button>
        </p>
      ) : !plugins ? (
        <p class="plugins-empty store-loading">
          <span class="spinner" />
          {t("store.loading")}
        </p>
      ) : (
        plugins.map((plugin) => (
          <div
            key={plugin.id}
            class="plugin-row store-row"
            role="button"
            tabIndex={0}
            onClick={() => open(plugin.id)}
            onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open(plugin.id)}
          >
            <Tile plugin={plugin} size={31} />
            <span class="plugin-row__text">
              <span class="plugin-row__name">
                {plugin.name}
                <Badge plugin={plugin} />
                {hasUpdate(plugin) && <span class="badge badge--accent">{t("store.updateBadge")}</span>}
              </span>
              <span class="plugin-row__meta">
                {plugin.author} · v{plugin.version} · {plugin.summary}
              </span>
            </span>
            <ActionButton plugin={plugin} busy={busy.includes(plugin.id)} onRun={() => run(plugin)} />
          </div>
        ))
      )}

      <Modal open={openId !== null} onClose={() => setOpenId(null)} label={shown?.name ?? ""} class="store-details">
        {shown && (
          <>
            <button type="button" class="icon-button store-details__close" aria-label={t("common.close")} onClick={() => setOpenId(null)}>
              <Close size={16} />
            </button>
            <div class="store-details__head">
              <Tile plugin={shown} size={56} />
              <div class="store-details__title">
                <h2>
                  {shown.name}
                  <Badge plugin={shown} />
                </h2>
                <span>
                  {shown.author} · v{shown.version} · {downloads(shown.downloads)}
                </span>
              </div>
            </div>
            <ScrollArea class="store-details__body">
              <p>{shown.description}</p>
              {hasUpdate(shown) && shown.changes.length > 0 && (
                <section>
                  <h3>{t("store.changes", { version: shown.version })}</h3>
                  <ul>
                    {shown.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </section>
              )}
              {shown.features.length > 0 && (
                <section>
                  <h3>{t("store.features")}</h3>
                  <ul>
                    {shown.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <h3>{t("store.permissions")}</h3>
                {shown.permissions.length ? (
                  <PermissionList items={shown.permissions} />
                ) : (
                  <p>{t("store.noPermissions")}</p>
                )}
              </section>
            </ScrollArea>
            <div class="store-details__footer">
              {shown.installed && (
                <span class="store-details__version">{t("store.installedVersion", { version: shown.installed })}</span>
              )}
              <ActionButton plugin={shown} busy={busy.includes(shown.id)} onRun={() => run(shown)} />
            </div>
          </>
        )}
      </Modal>
    </SettingGroup>
  );
}
