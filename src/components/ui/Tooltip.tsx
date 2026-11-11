import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

const DELAY = 450;
const GAP = 8;
const EDGE = 8;

type Tip = { text: string; rect: DOMRect };

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: Element | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setVisible(false);
    };
    const over = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      if (el === current) return;
      hide();
      const text = el?.getAttribute("data-tip");
      if (!el || !text) return;
      current = el;
      timer = window.setTimeout(() => {
        setTip({ text, rect: el.getBoundingClientRect() });
        requestAnimationFrame(() => current === el && setVisible(true));
      }, DELAY);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const width = el.offsetWidth;
    const center = tip.rect.left + tip.rect.width / 2;
    el.style.left = `${Math.min(Math.max(center - width / 2, EDGE), window.innerWidth - width - EDGE)}px`;
  }, [tip]);

  if (!tip) return null;
  const below = tip.rect.bottom + GAP + 40 < window.innerHeight;
  const vertical = below ? `top: ${tip.rect.bottom + GAP}px` : `bottom: ${window.innerHeight - tip.rect.top + GAP}px`;
  const className = ["tooltip", below ? "tooltip--below" : "tooltip--above", visible && "tooltip--visible"].filter(Boolean).join(" ");

  return createPortal(
    <div ref={ref} class={className} style={vertical} role="tooltip">
      {tip.text}
    </div>,
    document.body,
  );
}
