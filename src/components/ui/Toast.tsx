import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";

type ToastItem = { id: number; text: string; leaving?: boolean };

let push: ((text: string) => void) | null = null;

export function showToast(text: string) {
  push?.(text);
}

const VISIBLE_FOR = 2600;
const LEAVE_DURATION = 200;

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    push = (text) => {
      const id = Date.now() + Math.random();
      setItems((list) => [...list.slice(-2), { id, text }]);
      window.setTimeout(() => {
        setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
        window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), LEAVE_DURATION);
      }, VISIBLE_FOR);
    };
    return () => {
      push = null;
    };
  }, []);

  return createPortal(
    <div class="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} class={t.leaving ? "toast toast--leaving" : "toast"}>
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
