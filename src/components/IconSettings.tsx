import { t } from "../i18n";
import { useRef, useState } from "preact/hooks";
import { GalleryAdd, Trash } from "./ui/icons";
import { KEY_SIZE } from "../deck/layout";

const MAX_SIZE = 2 * 1024 * 1024;
const ICON_EDGE = KEY_SIZE * 2;
const KEEP_BYTES = 128 * 1024;

type Props = {
  image: string | null;
  onChange: (image: string | null) => void;
};

async function shrink(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || ICON_EDGE;
    const h = img.naturalHeight || ICON_EDGE;
    const scale = Math.min(ICON_EDGE / w, ICON_EDGE / h, file.type === "image/svg+xml" ? Infinity : 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(t("media.notImage"));
  if (file.size > MAX_SIZE) throw new Error(t("media.tooBig", { mb: 2 }));
  if (file.type !== "image/gif" && file.size > KEEP_BYTES) return shrink(file).catch(() => readRaw(file));
  return readRaw(file);
}

function readRaw(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t("media.readFailed")));
    reader.readAsDataURL(file);
  });
}

export function IconSettings({ image, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(file: File | undefined) {
    if (!file) return;
    try {
      onChange(await readImage(file));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div class="icon-settings">
      <span class="icon-settings__title">{t("icon.title")}</span>
      <button
        type="button"
        class={dragging ? "dropzone dropzone--active" : "dropzone"}
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
        {image ? (
          <img key={image.slice(-32)} class="dropzone__preview" src={image} alt="" />
        ) : (
          <GalleryAdd size={22} />
        )}
        <span class="dropzone__text">{image ? t("icon.replace") : t("icon.pick")}</span>
        <span class="dropzone__hint">{t("media.formats", { mb: 2 })}</span>
      </button>
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
      {error && (
        <p key={error} class="icon-settings__error">
          {error}
        </p>
      )}
      {image && (
        <button
          type="button"
          class="icon-settings__remove"
          onClick={() => {
            onChange(null);
            setError(null);
          }}
        >
          <Trash size={14} />
          {t("menu.removeImage")}
        </button>
      )}
    </div>
  );
}
