import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";
import { usePresence } from "../../hooks";

const stack: object[] = [];

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  class?: string;
  children: ComponentChildren;
};

export function Modal({ open, onClose, label, class: className, children }: Props) {
  const mounted = usePresence(open, 220);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = {};
    stack.push(token);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stack[stack.length - 1] === token && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(token), 1);
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <div class={open ? "modal-layer" : "modal-layer modal-layer--closing"}>
      <div class="modal-backdrop" onClick={onClose} />
      <div class={className ? `modal ${className}` : "modal"} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
