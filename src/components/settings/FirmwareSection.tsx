import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "preact/hooks";
import { Chip, Device, Import } from "../ui/icons";
import { type Key, t } from "../../i18n";
import { Modal } from "../ui/Modal";
import { isTauri, type DeckMode as Mode } from "../../deck/link";

type Outcome = { mode: Mode; version: string; bytes: number; crc: string };
type Bench = { latencyMs: number; usb: number; screen: number; keys: number; keyMs: number };
type BenchState = { kind: "idle" } | { kind: "running" } | { kind: "done"; bench: Bench } | { kind: "failed"; error: string };
type FlashProgress = { stage: string; percent: number; message: string };
type FlashState =
  | { kind: "idle" }
  | { kind: "flashing"; progress: FlashProgress }
  | { kind: "done"; outcome: Outcome }
  | { kind: "failed"; error: string };

function modeLabel(mode: Mode) {
  return mode === "osd" ? "Open Stream Deck" : t(`fw.mode.${mode}`);
}

const MODE_NOTE: Record<Mode, Key> = {
  osd: "fw.note.osd",
  stock: "fw.note.stock",
  loader: "fw.note.loader",
  none: "common.connectUsb",
};

const SHOWS_PERCENT = new Set(["write", "verify", "replug", "done"]);

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

type Props = {
  mode: Mode;
  firmware: string;
};

export function FirmwareSection({ mode, firmware }: Props) {
  const tauri = isTauri();
  const [path, setPath] = useState<string | null>(null);
  const [state, setState] = useState<FlashState>({ kind: "idle" });
  const flashing = state.kind === "flashing";

  useEffect(() => {
    if (!tauri) return;
    const off = listen<FlashProgress>("firmware-progress", (e) =>
      setState((s) => (s.kind === "flashing" ? { kind: "flashing", progress: e.payload } : s)),
    );
    return () => void off.then((stop) => stop());
  }, []);

  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      title: t("fw.dialogTitle"),
      filters: [{ name: t("fw.dialogFilter"), extensions: ["bin"] }],
    });
    if (typeof picked === "string") {
      setPath(picked);
      setState({ kind: "idle" });
    }
  };

  const install = async () => {
    if (!path) return;
    setState({ kind: "flashing", progress: { stage: "prepare", percent: 0, message: t("fw.checking") } });
    try {
      const outcome = await invoke<Outcome>("firmware_flash", { path });
      setState({ kind: "done", outcome });
    } catch (e) {
      setState({ kind: "failed", error: String(e) });
    }
  };

  const [bench, setBench] = useState<BenchState>({ kind: "idle" });
  const runBench = async () => {
    setBench({ kind: "running" });
    try {
      setBench({ kind: "done", bench: await invoke<Bench>("deck_bench") });
    } catch (e) {
      setBench({ kind: "failed", error: String(e) });
    }
  };

  const version = mode === "osd" ? firmware : "";
  const percent = state.kind === "flashing" && state.progress.stage === "write" ? state.progress.percent : null;
  const bar = state.kind === "flashing" && SHOWS_PERCENT.has(state.progress.stage) ? state.progress.percent : 2;
  const replug = state.kind === "flashing" && state.progress.stage === "replug";

  return (
    <>
      <div class="firmware-card">
        <div class="firmware-card__head">
          <div class="firmware-card__icon">
            <Chip size={22} />
          </div>
          <div class="firmware-card__text">
            <span class="firmware-card__label">{t("fw.current")}</span>
            <span key={`${mode}${version}`} class="firmware-card__version">
              {modeLabel(mode)}
              {version ? ` ${version}` : ""}
            </span>
          </div>
        </div>
        <p class="firmware-card__note">{t(MODE_NOTE[mode])}</p>
      </div>

      <div class="firmware-card">
        <div class="firmware-card__head">
          <div class={flashing ? "firmware-card__icon firmware-card__icon--busy" : "firmware-card__icon"}>
            <Import size={22} />
          </div>
          <div class="firmware-card__text">
            <span class="firmware-card__label">{t("fw.install")}</span>
            <span class="firmware-manual__file" data-tip={path ?? undefined}>
              {path ? fileName(path) : t("fw.noFile")}
            </span>
          </div>
          {percent !== null ? (
            <span class="firmware-card__percent">{percent}%</span>
          ) : (
            <>
              <button type="button" class="button" disabled={flashing || !tauri} onClick={pick}>
                {t("fw.pick")}
              </button>
              <button
                type="button"
                class="button button--primary"
                disabled={flashing || !path || !tauri || mode === "none"}
                onClick={install}
              >
                {flashing ? <span class="spinner" /> : null}
                {t("common.install")}
              </button>
            </>
          )}
        </div>

        <div key={state.kind} class="firmware-card__body">
          {state.kind === "idle" && (
            <p class="firmware-card__note">
              {t("fw.hint")}
            </p>
          )}
          {state.kind === "flashing" && (
            <div class="progress-block">
              <div class="progress">
                <div class="progress__bar" style={`width: ${bar}%`} />
              </div>
              <p class="firmware-card__note">{state.progress.message}</p>
              {!replug && <p class="firmware-card__note firmware-card__note--warn">{t("fw.keepConnected")}</p>}
            </div>
          )}
          {state.kind === "done" && (
            <p class="firmware-card__note firmware-card__note--ok">
              {t("fw.done", {
                what: modeLabel(state.outcome.mode) + (state.outcome.version ? ` ${state.outcome.version}` : ""),
                kb: Math.round(state.outcome.bytes / 1024),
                crc: state.outcome.crc,
              })}
            </p>
          )}
          {state.kind === "failed" && <p class="firmware-card__note firmware-card__note--error">{state.error}</p>}
        </div>
      </div>

      {mode === "osd" && (
        <div class="firmware-card">
          <div class="firmware-card__head">
            <div class={bench.kind === "running" ? "firmware-card__icon firmware-card__icon--busy" : "firmware-card__icon"}>
              <Device size={22} />
            </div>
            <div class="firmware-card__text">
              <span class="firmware-card__label">{t("fw.bench")}</span>
              <span class="firmware-manual__file">{t("fw.benchTitle")}</span>
            </div>
            <button type="button" class="button" disabled={bench.kind === "running" || flashing || !tauri} onClick={runBench}>
              {bench.kind === "running" ? <span class="spinner" /> : null}
              {t("fw.benchRun")}
            </button>
          </div>
          <div key={bench.kind} class="firmware-card__body">
            {bench.kind === "done" ? (
              <p class="firmware-card__note firmware-card__note--ok">
                {t("fw.benchResult", {
                  mb: (bench.bench.keys / 1e6).toFixed(2),
                  keys: Math.round(1000 / bench.bench.keyMs),
                  ms: bench.bench.latencyMs.toFixed(1),
                })}
              </p>
            ) : bench.kind === "failed" ? (
              <p class="firmware-card__note firmware-card__note--error">{bench.error}</p>
            ) : (
              <p class="firmware-card__note">{t("fw.benchHint")}</p>
            )}
          </div>
        </div>
      )}

      <Modal open={replug} onClose={() => undefined} label={t("fw.replug.title")} class="confirm replug">
        <div class="confirm__icon replug__icon">
          <Device size={22} />
        </div>
        <h2 class="confirm__title">{t("fw.replug.title")}</h2>
        <p class="confirm__text">
          {t("fw.replug.text")}
        </p>
        <p class="replug__wait">
          <span class="spinner" />
          {t("fw.replug.wait")}
        </p>
      </Modal>
    </>
  );
}
