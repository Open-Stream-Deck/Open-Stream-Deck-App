import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

type Props = { class?: string; children: ComponentChildren; onScroll?: JSX.GenericEventHandler<HTMLDivElement> };

export function ScrollArea({ class: className, children, onScroll }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setFade(top && bottom ? "both" : top ? "top" : bottom ? "bottom" : "");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    const mutations = new MutationObserver(update);
    mutations.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  return (
    <div ref={ref} class={`scroll-area ${className ?? ""}`} data-fade={fade || undefined} onScroll={onScroll}>
      {children}
    </div>
  );
}
