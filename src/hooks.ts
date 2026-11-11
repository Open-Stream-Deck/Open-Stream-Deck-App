import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export function usePresence(open: boolean, duration = 200) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);

  return open || mounted;
}

export function useDismiss(ref: RefObject<HTMLElement>, active: boolean, onDismiss: () => void) {
  const callback = useRef(onDismiss);
  callback.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest?.(".context-menu, .select__menu--portal")) return;
      if (ref.current && !ref.current.contains(target)) callback.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        callback.current();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [active, ref]);
}
