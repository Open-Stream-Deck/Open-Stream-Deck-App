import { useLayoutEffect, useRef, useState } from "preact/hooks";

const SPEED = 30;
const MOVING_SHARE = 0.6;

export function Marquee({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    const content = inner.current;
    if (!el || !content) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const available = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setShift(Math.max(0, Math.ceil(content.scrollWidth - available)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const moving = shift > 0;
  const duration = Math.max(6, (shift * 2) / SPEED / MOVING_SHARE);

  return (
    <div
      ref={box}
      class={moving ? "marquee marquee--moving" : "marquee"}
      style={moving ? `--marquee-shift: -${shift}px; --marquee-duration: ${duration}s` : undefined}
      data-tip={moving ? text : undefined}
    >
      <span ref={inner} class="marquee__text">
        {text}
      </span>
    </div>
  );
}
