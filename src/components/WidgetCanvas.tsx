import { useEffect, useRef } from "preact/hooks";

const subscribers = new Set<() => void>();
let frame = 0;
let last = 0;

function tick(now: number) {
  frame = subscribers.size ? requestAnimationFrame(tick) : 0;
  if (now - last < 32) return;
  last = now;
  subscribers.forEach((fn) => fn());
}

export function useTicker(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const run = () => ref.current();
    subscribers.add(run);
    run();
    if (!frame) frame = requestAnimationFrame(tick);
    return () => void subscribers.delete(run);
  }, []);
}

type Props = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
  class?: string;
};

export function WidgetCanvas({ width, height, draw, class: className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useTicker(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.save();
    draw(ctx);
    ctx.restore();
  });
  return <canvas ref={ref} width={width} height={height} class={className} />;
}
