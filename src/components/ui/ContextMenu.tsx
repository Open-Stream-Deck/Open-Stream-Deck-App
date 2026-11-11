import type { ComponentType } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export type MenuItem =
  | {
      label: string;
      icon?: ComponentType<{ size?: number }>;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | "separator";

type MenuState = { id: number; x: number; y: number; items: MenuItem[] };

let listener: ((state: MenuState | null) => void) | null = null;

export function openContextMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  listener?.({ id: Date.now(), x: e.clientX, y: e.clientY, items });
}

export function closeContextMenu() {
  listener?.(null);
}

const EDGE = 8;

export function ContextMenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [closing, setClosing] = useState<MenuState | null>(null);
  const current = useRef<MenuState | null>(null);

  useEffect(() => {
    listener = (next) => {
      if (current.current) setClosing(current.current);
      current.current = next;
      setMenu(next);
    };
    const onNativeMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest?.("input, textarea, [contenteditable='true']")) e.preventDefault();
    };
    document.addEventListener("contextmenu", onNativeMenu);
    return () => {
      listener = null;
      document.removeEventListener("contextmenu", onNativeMenu);
    };
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(null), 140);
    return () => clearTimeout(timer);
  }, [closing]);

  useLayoutEffect(() => {
    if (!menu) return;
    const close = () => closeContextMenu();
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".context-menu")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  return createPortal(
    <>
      {[closing, menu].map(
        (item) => item && <MenuView key={item.id} state={item} closing={item === closing && item !== menu} />,
      )}
    </>,
    document.body,
  );
}

function MenuView({ state, closing }: { state: MenuState; closing?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const flipX = state.x + width + EDGE > window.innerWidth;
    const flipY = state.y + height + EDGE > window.innerHeight;
    setPosition({
      x: Math.max(EDGE, flipX ? state.x - width : state.x),
      y: Math.max(EDGE, flipY ? state.y - height : state.y),
      origin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}`,
    });
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      class={closing ? "context-menu context-menu--closing" : "context-menu"}
      style={
        position
          ? `left: ${position.x}px; top: ${position.y}px; transform-origin: ${position.origin}`
          : `left: ${state.x}px; top: ${state.y}px; visibility: hidden; animation: none`
      }
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} class="context-menu__separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            class={item.danger ? "context-menu__item context-menu__item--danger" : "context-menu__item"}
            onClick={() => {
              closeContextMenu();
              item.onSelect();
            }}
          >
            <span class="context-menu__icon">{item.icon && <item.icon size={15} />}</span>
            <span class="context-menu__label">{item.label}</span>
            {item.shortcut && <span class="context-menu__shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
