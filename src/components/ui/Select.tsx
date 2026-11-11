import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { usePresence } from "../../hooks";
import { ChevronDown } from "./icons";

type Option = { value: string | number; label: string; css?: string; hint?: string };

type Props = {
  value: string | number;
  options: Option[];
  onChange: (value: string | number) => void;
  label?: string;
};

const GAP = 6;
const MARGIN = 12;
const ITEM = 32;

type Place = { left: number; vertical: string; width: number; maxHeight: number; up: boolean };

export function Select({ value, options, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const mounted = usePresence(open, 160);
  const current = options.find((o) => o.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const r = root.current.getBoundingClientRect();
    const wanted = options.length * ITEM + 8;
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < wanted && above > below;
    setPlace({
      left: r.left,
      vertical: up ? `top: auto; bottom: ${window.innerHeight - r.top + GAP}px` : `top: ${r.bottom + GAP}px`,
      width: r.width,
      maxHeight: Math.max(120, up ? above : below),
      up,
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    const scroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
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

  return (
    <div class="select" ref={root}>
      <button
        type="button"
        class={open ? "select__trigger select__trigger--open" : "select__trigger"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={current.css ? `font-family: ${current.css}` : undefined}>{current.label}</span>
        <ChevronDown class="select__chevron" size={14} />
      </button>
      {mounted &&
        place &&
        createPortal(
          <div
            ref={menu}
            class={`popover select__menu select__menu--portal ${place.up ? "select__menu--up" : ""} ${open ? "popover--open" : "popover--closing"}`}
            style={`left: ${place.left}px; ${place.vertical}; min-width: ${place.width}px; max-height: ${place.maxHeight}px`}
          >
            <ul role="listbox" class="menu">
              {options.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    class={option.value === value ? "menu__item menu__item--active" : "menu__item"}
                    style={option.css ? `font-family: ${option.css}` : undefined}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                    {option.hint && <span class="menu__hint">{option.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
