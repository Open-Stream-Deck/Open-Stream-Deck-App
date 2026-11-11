import { t } from "../../i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Json, JsonObject } from "../../types";
import type { SettingsPageMessage } from "../../plugins/host";
import "../../styles/plugin-settings.css";

type Down =
  | { type: "context"; context: JsonObject; page: string }
  | { type: "globals"; settings: JsonObject }
  | { type: "message"; payload: Json }
  | { type: "theme"; theme: string };

function up(message: SettingsPageMessage) {
  void invoke("plugin_settings_up", { message });
}

export function PluginSettingsShell({ uuid: plugin }: { uuid: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const [target, setTarget] = useState<{ context: JsonObject; page: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const label = getCurrentWebviewWindow().label;
    const off = listen<Down>("opensd-settings-down", (e) => {
      const m = e.payload;
      if (m.type === "context") setTarget((current) => current ?? { context: m.context, page: m.page });
      else if (m.type === "globals") port.current?.postMessage({ type: "globals", settings: m.settings });
      else if (m.type === "message") port.current?.postMessage({ type: "message", payload: m.payload });
      else if (m.type === "theme") port.current?.postMessage({ type: "theme", theme: m.theme });
    });
    void off.then(() => up({ type: "hello", plugin, label }));
    const timeout = window.setTimeout(() => setFailed((f) => f ?? t("plugins.settingsPageTimeout")), 5000);
    const bye = () => up({ type: "bye", plugin, label });
    window.addEventListener("beforeunload", bye);
    return () => {
      clearTimeout(timeout);
      bye();
      window.removeEventListener("beforeunload", bye);
      void off.then((stop) => stop());
    };
  }, [plugin]);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!target || !element) return;
    setFailed(null);
    let loads = 0;
    const onLoad = () => {
      if (++loads > 1) element.src = "about:blank";
    };
    const onHello = (e: MessageEvent) => {
      if (e.source !== element.contentWindow || port.current || loads > 1) return;
      if ((e.data as { opensd?: string })?.opensd !== "hello") return;
      const channel = new MessageChannel();
      port.current = channel.port1;
      channel.port1.onmessage = (m) => {
        const data = m.data as { type?: string; settings?: unknown; payload?: Json; url?: unknown };
        if (data.type === "saveGlobals" && data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)) {
          up({ type: "saveGlobals", plugin, settings: data.settings as JsonObject });
        } else if (data.type === "send") up({ type: "send", plugin, payload: data.payload ?? null });
        else if (data.type === "openUrl" && typeof data.url === "string") up({ type: "openUrl", plugin, url: data.url });
      };
      element.contentWindow?.postMessage({ opensd: "connect", context: target.context }, "*", [channel.port2]);
    };
    window.addEventListener("message", onHello);
    element.addEventListener("load", onLoad);
    return () => {
      window.removeEventListener("message", onHello);
      element.removeEventListener("load", onLoad);
      port.current?.close();
      port.current = null;
    };
  }, [plugin, target]);

  return (
    <div class="plugin-settings-shell">
      {failed && !target ? (
        <p class="plugin-settings-shell__error">{failed}</p>
      ) : (
        target && <iframe ref={frame} class="plugin-settings-shell__frame" sandbox="allow-scripts" src={target.page} title={t("plugins.settingsPage")} />
      )}
    </div>
  );
}
