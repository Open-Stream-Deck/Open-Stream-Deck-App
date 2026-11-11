import "@fontsource-variable/inter";
import "./splash.css";
import { invoke } from "@tauri-apps/api/core";
import splash from "../../src-tauri/icons/splash.png";
import { mount } from "./view";

function settings(): { language?: string; autoUpdate?: boolean } {
  try {
    const saved = localStorage.getItem("open-stream-deck:app:v1") ?? localStorage.getItem("open-stream-deck:state:v1");
    return JSON.parse(saved ?? "{}").app ?? {};
  } catch {
    return {};
  }
}

const send = (message: string) => void invoke("launcher", { message });
const { language, autoUpdate } = settings();
mount(splash, send, language ?? navigator.language);
send(autoUpdate === false ? "skip" : "check");
