import { invoke } from "@tauri-apps/api/core";
import { render } from "preact";
import App from "./App";
import { PluginSettingsShell } from "./components/settings/PluginSettingsPage";
import { isTauri } from "./deck/link";
import { loadState } from "./store";

const settings = /^#plugin-settings=(.+)$/.exec(location.hash);
if (settings) document.documentElement.classList.add("plugin-settings-window");

const root = document.getElementById("root")!;
if (settings) render(<PluginSettingsShell uuid={decodeURIComponent(settings[1])} />, root);
else
  void loadState().then((initial) => {
    render(<App initial={initial} />, root);
    if (!isTauri()) return;
    let sent = false;
    const ready = () => {
      if (sent) return;
      sent = true;
      void invoke("launcher", { message: "ready" });
    };
    requestAnimationFrame(ready);
    setTimeout(ready, 300);
  });
