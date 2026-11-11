import { t } from "../i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { getMediaBlob, isMediaRef, putMedia } from "../media";
import type { Action, Field, KeySettings } from "../types";
import { HotkeyInput } from "./HotkeyInput";
import { FALLBACK_SOUND, loadSound, playSound } from "../widgets/sounds";
import { timerOptions } from "../widgets/timer";
import { GalleryAdd, Speaker, Stop, Trash } from "./ui/icons";
import { showToast } from "./ui/Toast";
import { ColorPicker } from "./ui/ColorPicker";
import { Select } from "./ui/Select";
import { Toggle } from "./ui/Toggle";

type Props = {
  action: Action;
  settings: KeySettings;
  onChange: (patch: KeySettings) => void;
};

function visible(field: Field, fields: Field[], settings: KeySettings) {
  return Object.entries(field.when ?? {}).every(([id, values]) => {
    const other = fields.find((f) => f.id === id);
    return !other || values.includes(String(settings[id] ?? other.defaultValue ?? other.options?.[0]?.value ?? ""));
  });
}

export function PluginInspector({ action, settings, onChange }: Props) {
  const fields = action.fields?.filter((f, _, all) => visible(f, all, settings)) ?? [];
  if (!fields.length) {
    return (
      <div class="inspector__empty">
        <p>{t("inspector.noSettings")}</p>
        <span>{action.description}</span>
      </div>
    );
  }

  return (
    <div class="inspector">
      {fields.map((field, i) =>
        field.type === "sound" ? (
          <SoundField key={field.id} field={field} index={i} settings={settings} onChange={onChange} />
        ) : (
          <FieldControl
            key={field.id}
            field={field}
            index={i}
            value={settings[field.id]}
            onChange={(value) => onChange({ [field.id]: value })}
          />
        ),
      )}
    </div>
  );
}

type FieldProps = {
  field: Field;
  index: number;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
};

function FieldControl({ field, index, value, onChange }: FieldProps) {
  const style = `--i: ${index}`;

  if (field.type === "color") return <ColorField field={field} index={index} value={value} onChange={onChange} />;
  if (field.type === "image") return <ImageField field={field} index={index} value={value} onChange={onChange} />;

  if (field.type === "toggle") {
    return (
      <div class="inspector__field inspector__field--inline" style={style}>
        <span class="inspector__label">{field.label}</span>
        <Toggle checked={value === undefined ? field.defaultValue === "true" : value === true} onChange={onChange} label={field.label} />
      </div>
    );
  }

  const Wrapper = field.type === "text" || field.type === "textarea" || field.type === "number" ? "label" : "div";

  return (
    <Wrapper class="inspector__field" style={style}>
      <span class="inspector__label">{field.label}</span>
      {field.type === "text" && (
        <input
          class="input"
          type="text"
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      )}
      {field.type === "number" && (
        <input
          class="input"
          type="number"
          inputMode="decimal"
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step ?? "any"}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      )}
      {field.type === "textarea" && (
        <textarea
          class="input input--textarea"
          rows={3}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      )}
      {field.type === "select" && field.options && (
        <Select
          value={typeof value === "string" ? value : (field.defaultValue ?? field.options[0].value)}
          options={field.options}
          label={field.label}
          onChange={(v) => onChange(String(v))}
        />
      )}
      {field.type === "hotkey" && <HotkeyInput value={typeof value === "string" ? value : ""} onChange={onChange} />}
      {field.hint && <span class="inspector__hint">{field.hint}</span>}
    </Wrapper>
  );
}

const DEFAULT_COLORS = ["#ffffff", "#c7c7cc", "#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#0a84ff", "#bf5af2", "#ff375f"];

function ColorField({ field, index, value, onChange }: FieldProps) {
  const colors = field.colors ?? DEFAULT_COLORS;
  const current = typeof value === "string" && value ? value : (field.defaultValue ?? colors[0]);
  const custom = !colors.includes(current);
  return (
    <div class="inspector__field" style={`--i: ${index}`}>
      <span class="inspector__label">{field.label}</span>
      <div class="swatches">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            class={current === color ? "swatch swatch--active" : "swatch"}
            style={`--swatch: ${color}`}
            onClick={() => onChange(color)}
          />
        ))}
        <ColorPicker value={current} custom={custom} onChange={onChange} />
      </div>
      {field.hint && <span class="inspector__hint">{field.hint}</span>}
    </div>
  );
}

function ImageField({ field, index, value, onChange }: FieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = isMediaRef(value) ? value : null;

  useEffect(() => {
    if (!ref) {
      setPreview(null);
      return;
    }
    let url: string | null = null;
    let alive = true;
    getMediaBlob(ref).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setPreview(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ref]);

  async function load(file: File | undefined) {
    if (!file) return;
    try {
      onChange(await putMedia(file));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div class="inspector__field" style={`--i: ${index}`}>
      <span class="inspector__label">{field.label}</span>
      <div class="media-field">
        <button
          type="button"
          class={dragging ? "dropzone media-field__drop dropzone--active" : "dropzone media-field__drop"}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            load(e.dataTransfer?.files[0]);
          }}
        >
          {preview ? <img class="media-field__preview" src={preview} alt="" /> : <GalleryAdd size={20} />}
          <span class="dropzone__text">{ref ? t("inspector.replace") : t("inspector.pick")}</span>
          <span class="dropzone__hint">{field.hint ?? t("media.formats", { mb: 8 })}</span>
        </button>
        {ref && (
          <button type="button" class="icon-settings__remove" onClick={() => onChange("")}>
            <Trash size={14} />
            {t("common.remove")}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          load(e.currentTarget.files?.[0]);
          e.currentTarget.value = "";
        }}
      />
      {error && <span class="icon-settings__error">{error}</span>}
    </div>
  );
}

const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "webm"];

type SoundProps = { field: Field; index: number; settings: KeySettings; onChange: (patch: KeySettings) => void };

function SoundField({ field, index, settings, onChange }: SoundProps) {
  const [playing, setPlaying] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const options = field.options ?? [];
  const value = typeof settings.sound === "string" ? settings.sound : (field.defaultValue ?? options[0]?.value ?? "");
  const file = typeof settings.soundFile === "string" ? settings.soundFile : "";

  const halt = () => {
    stop.current?.();
    stop.current = null;
    setPlaying(false);
  };

  useEffect(() => () => stop.current?.(), []);

  useEffect(() => {
    if (value !== "file" || !file) return;
    let alive = true;
    loadSound(file).catch(() => {
      if (!alive) return;
      onChange({ sound: FALLBACK_SOUND, soundFile: "" });
      showToast(t("sound.missing"));
    });
    return () => {
      alive = false;
    };
  }, [value, file]);

  function toggle() {
    if (playing) return halt();
    const o = timerOptions(settings);
    setPlaying(true);
    stop.current = playSound(o.sound, o.volume, false, () => {
      stop.current = null;
      setPlaying(false);
    });
  }

  async function pick() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ title: t("sound.pick"), filters: [{ name: t("sound.files"), extensions: AUDIO_EXTENSIONS }] });
    if (typeof path !== "string") return;
    halt();
    onChange({ sound: "file", soundFile: path });
  }

  return (
    <div class="inspector__field" style={`--i: ${index}`}>
      <span class="inspector__label">{field.label}</span>
      <div class="sound-field">
        <Select
          value={value}
          options={options}
          label={field.label}
          onChange={(v) => {
            halt();
            onChange({ sound: String(v) });
            if (v === "file" && !file) void pick();
          }}
        />
        <button
          type="button"
          class={playing ? "icon-button sound-field__play sound-field__play--on" : "icon-button sound-field__play"}
          aria-label={t(playing ? "sound.stop" : "sound.play")}
          data-tip={t(playing ? "sound.stop" : "sound.play")}
          disabled={value === "none"}
          onClick={toggle}
        >
          <span key={String(playing)} class="sound-field__icon">
            {playing ? <Stop size={16} /> : <Speaker size={16} />}
          </span>
        </button>
      </div>
      {value === "file" && (
        <div class="sound-field__file">
          <button type="button" class="button sound-field__pick" data-tip={file || undefined} onClick={() => void pick()}>
            <span>{file ? file.split(/[\\/]/).pop() : t("sound.pick")}</span>
          </button>
          <label class="sound-field__start">
            <span>{t("sound.start")}</span>
            <input
              class="input"
              type="text"
              inputMode="numeric"
              placeholder="00:00"
              value={typeof settings.soundStart === "string" ? settings.soundStart : ""}
              onInput={(e) => onChange({ soundStart: e.currentTarget.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
