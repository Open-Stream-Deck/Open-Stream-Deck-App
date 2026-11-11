import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "../../i18n";
import { usePresence } from "../../hooks";

type Hsv = [number, number, number];

type Props = {
  value: string;
  custom: boolean;
  onChange: (value: string) => void;
};

type Place = { left: number; vertical: string; up: boolean };

const WIDTH = 208;
const HEIGHT = 232;
const GAP = 8;
const MARGIN = 12;
const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

function toHex([h, s, v]: Hsv) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[5, 3, 1].map((n) => channel(n).toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const sector = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [sector * 60, max === 0 ? 0 : d / max, max];
}

function drag(move: (x: number, y: number) => void) {
  const apply = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    move(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      apply(e);
    },
    onPointerMove: (e: PointerEvent) => {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) apply(e);
    },
  };
}

export function ColorPicker({ value, custom, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [hsv, setHsv] = useState<Hsv>(() => (HEX.test(value) ? fromHex(value) : [0, 0, 1]));
  const [text, setText] = useState(value);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const mounted = usePresence(open, 160);
  const [h, s, v] = hsv;

  useEffect(() => {
    if (!HEX.test(value) || value.toLowerCase() === toHex(hsv)) return;
    setHsv(fromHex(value));
    setText(value);
  }, [value]);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom - GAP - MARGIN < HEIGHT && r.top > window.innerHeight - r.bottom;
    setPlace({
      left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - WIDTH - MARGIN)),
      vertical: up ? `top: auto; bottom: ${window.innerHeight - r.top + GAP}px` : `top: ${r.bottom + GAP}px`,
      up,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, [open]);

  function update(next: Hsv) {
    const hex = toHex(next);
    setHsv(next);
    setText(hex);
    onChange(hex);
  }

  function commit() {
    const hex = text.startsWith("#") ? text : `#${text}`;
    if (HEX.test(hex)) update(fromHex(hex));
    else setText(toHex(hsv));
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("common.customColor")}
        data-tip={t("common.customColor")}
        class={custom ? "swatch swatch--custom swatch--active" : "swatch swatch--custom"}
        style={custom ? `--swatch: ${value}` : undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {mounted &&
        place &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={t("common.customColor")}
            class={`popover picker ${place.up ? "picker--up" : ""} ${open ? "popover--open" : "popover--closing"}`}
            style={`left: ${place.left}px; ${place.vertical}; --hue: ${Math.round(h)}`}
          >
            <div
              class="picker__area"
              {...drag((x, y) => update([h, x, 1 - y]))}
            >
              <span class="picker__thumb" style={`left: ${s * 100}%; top: ${(1 - v) * 100}%; background: ${toHex(hsv)}`} />
            </div>
            <div class="picker__hue" {...drag((x) => update([x * 360, s, v]))}>
              <span class="picker__thumb" style={`left: ${(h / 360) * 100}%; top: 50%; background: hsl(${Math.round(h)}, 100%, 50%)`} />
            </div>
            <input
              class="input picker__hex"
              type="text"
              spellcheck={false}
              maxLength={7}
              value={text}
              aria-label="HEX"
              onInput={(e) => setText(e.currentTarget.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
