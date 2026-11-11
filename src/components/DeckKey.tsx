import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { fontCss, OS, titleColor } from "../data";
import { WidgetCanvas } from "./WidgetCanvas";
import { actionGlyph } from "./ui/pluginIcons";
import { dragOver, KEY_MIME, readDrop, startDrag, type DropItem } from "../dnd";
import { loadImage, pictureSize } from "../deck/render";
import type { ActionRef, KeyConfig, TitleStyle } from "../types";

type Props = {
  config: KeyConfig;
  selected?: boolean;
  pressed?: boolean;
  widgetDraw?: (ctx: CanvasRenderingContext2D) => void;
  onSelect?: () => void;
  dragIndex?: number;
  onDropItem?: (item: DropItem, copy: boolean) => void;
  onContextMenu?: (e: MouseEvent) => void;
  preview?: boolean;
  style?: string;
  side?: boolean;
  lost?: boolean;
};

export { ACTION_MIME } from "../dnd";

const GHOST_DURATION = 280;

type Ghost<T> = { id: number; value: T };

function useGhost<T>(key: string | null, snapshot: T | null) {
  const [ghost, setGhost] = useState<Ghost<T> | null>(null);
  const last = useRef<{ key: string | null; value: T | null }>({ key, value: snapshot });
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const previous = last.current;
    last.current = { key, value: snapshot };
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (previous.key === key) return;
    if (previous.value === null) {
      setGhost(null);
      return;
    }
    setGhost({ id: Date.now(), value: previous.value });
    const timer = window.setTimeout(() => setGhost(null), GHOST_DURATION);
    return () => clearTimeout(timer);
  }, [key]);

  useLayoutEffect(() => {
    if (last.current.key === key) last.current.value = snapshot;
  });

  return ghost;
}

function actionKey(ref: ActionRef | null) {
  return ref ? `${ref.pluginId}:${ref.actionId}` : null;
}

function titleCss(ts: TitleStyle) {
  return `font-size: ${ts.size}px; color: ${titleColor(ts.color)}; font-family: ${fontCss(ts.font)}; font-weight: ${ts.bold ? 700 : 400}; font-style: ${ts.italic ? "italic" : "normal"}`;
}

function KeyIcon({ action, state, out }: { action: ActionRef; state?: number; out?: boolean }) {
  const glyph = actionGlyph(action.pluginId, action.actionId, state);
  const className = ["deck-key__icon", glyph && "deck-key__icon--glyph", out && "deck-key__icon--out"].filter(Boolean).join(" ");
  return <span class={className}>{glyph}</span>;
}

function PluginImage({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let current = true;
    loadImage(src, true)
      .then((img) => {
        const c = ref.current;
        if (!current || !c) return;
        const size = pictureSize(img);
        const k = (c.clientWidth * devicePixelRatio) / size.w || 1;
        const w = Math.round(size.w * k);
        const h = Math.round(size.h * k);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const ctx = c.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
      })
      .catch(() => undefined);
    return () => void (current = false);
  }, [src]);
  return <canvas ref={ref} class="deck-key__image" />;
}

type LabelSnapshot = { title: string; style: TitleStyle };

export function DeckKey({
  config,
  selected,
  pressed,
  widgetDraw,
  onSelect,
  dragIndex,
  onDropItem,
  onContextMenu,
  preview,
  style,
  side,
  lost,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const current = actionKey(config.action);
  const [flash, setFlash] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (current) setFlash((f) => f + 1);
  }, [current]);

  const { titleStyle: ts } = config;
  const hasTitle = ts.visible && config.title.trim() !== "";
  const labelKey = hasTitle ? `label:${current ?? "none"}` : null;

  const live = !!config.ext;
  const showIcon = current && !config.image && !live;
  const iconGhost = useGhost(showIcon ? current : null, showIcon ? { action: config.action!, state: config.state } : null);
  const imageId = config.image ? (live ? `plugin:${config.action?.actionId}` : config.image.slice(-48)) : null;
  const imageGhost = useGhost(imageId, config.image);
  const labelGhost = useGhost<LabelSnapshot>(labelKey, hasTitle ? { title: config.title, style: ts } : null);

  const className = [
    "deck-key",
    side && "side-tile",
    selected && "deck-key--selected",
    pressed && "deck-key--pressed",
    dragging && "deck-key--dragging",
    preview && "deck-key--preview",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {!widgetDraw && !lost && config.backdrop && <img key={config.backdrop.slice(-48)} class="deck-key__image" src={config.backdrop} alt="" draggable={false} />}
      {widgetDraw ? (
        <WidgetCanvas width={side ? 85 : 103} height={103} class="deck-key__widget" draw={widgetDraw} />
      ) : lost ? (
        <svg class="deck-key__lost" viewBox="0 0 74 74" aria-label="404">
          <text x="20" y="38">4</text>
          <circle cx="37" cy="37" r="8" />
          <path d="M44.6 29.4 29.4 44.6" />
          <text x="54" y="38">4</text>
        </svg>
      ) : config.image && live ? (
        <PluginImage key={imageId!} src={config.image} />
      ) : config.image ? (
        <img key={imageId!} class="deck-key__image" src={config.image} alt="" draggable={false} />
      ) : (
        current && !live && <KeyIcon key={current} action={config.action!} state={config.state} />
      )}
      {!widgetDraw && iconGhost && <KeyIcon key={`icon-${iconGhost.id}`} action={iconGhost.value.action} state={iconGhost.value.state} out />}
      {!widgetDraw && imageGhost && (
        <img
          key={`image-${imageGhost.id}`}
          class="deck-key__image deck-key__image--out"
          src={imageGhost.value}
          alt=""
          draggable={false}
        />
      )}
      {labelGhost && (
        <span
          key={`label-${labelGhost.id}`}
          class={`deck-key__label deck-key__label--${labelGhost.value.style.position} deck-key__label--out`}
        >
          <span class="deck-key__title" style={titleCss(labelGhost.value.style)}>
            {labelGhost.value.title}
          </span>
        </span>
      )}
      {hasTitle && (
        <span key={labelKey} class={`deck-key__label deck-key__label--${ts.position}`}>
          <span class="deck-key__title" style={titleCss(ts)}>
            {config.title}
          </span>
        </span>
      )}
      {config.badge && <span class={`deck-key__badge deck-key__badge--${config.badge}`} />}
      {flash > 0 && <span key={flash} class="deck-key__ring" />}
    </>
  );

  if (preview) {
    return (
      <div class={className} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      class={className}
      style={style}
      aria-pressed={selected}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      draggable={dragIndex !== undefined}
      onDragStart={(e) => {
        if (dragIndex === undefined) return;
        startDrag(e, KEY_MIME, dragIndex);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => {
        if (dragging || !dragOver(e)) return;
        e.currentTarget.classList.add("deck-key--drop");
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove("deck-key--drop")}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("deck-key--drop");
        const item = readDrop(e.dataTransfer);
        if (item) onDropItem?.(item, OS === "macos" ? e.altKey : e.ctrlKey);
      }}
    >
      {content}
    </button>
  );
}
