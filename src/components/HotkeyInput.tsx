import { t } from "../i18n";
import { useState } from "preact/hooks";
import { OS } from "../data";

const MODIFIERS = ["Control", "Shift", "Alt", "AltGraph", "Meta", "Super", "OS"];

const META = { macos: "Cmd", windows: "Win", linux: "Super" }[OS];

const KEY_NAMES: Record<string, string> = {
  Control: "Ctrl",
  Meta: META,
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
};

function keyName(e: KeyboardEvent) {
  const physical = /^(?:Key|Digit)(\w)$/.exec(e.code);
  if (physical) return physical[1];
  return KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
}

function formatCombo(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push(META);
  if (!MODIFIERS.includes(e.key)) parts.push(keyName(e));
  return parts;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function HotkeyInput({ value, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const keys = recording && preview.length ? preview : value ? value.split(" + ") : [];

  return (
    <button
      type="button"
      class={recording ? "hotkey hotkey--recording" : "hotkey"}
      onFocus={() => setRecording(true)}
      onBlur={() => {
        setRecording(false);
        setPreview([]);
      }}
      onKeyDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Backspace" && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
          onChange("");
          setPreview([]);
          return;
        }
        const parts = formatCombo(e);
        setPreview(parts);
        if (!MODIFIERS.includes(e.key)) {
          onChange(parts.join(" + "));
          e.currentTarget.blur();
        }
      }}
    >
      {keys.length ? (
        keys.map((key, i) => (
          <kbd key={`${key}-${i}`} class="hotkey__key">
            {key}
          </kbd>
        ))
      ) : (
        <span class="hotkey__placeholder">{recording ? t("hotkey.recording") : t("hotkey.empty")}</span>
      )}
    </button>
  );
}
