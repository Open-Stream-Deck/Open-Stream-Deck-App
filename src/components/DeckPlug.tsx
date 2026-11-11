import { useEffect, useRef } from "preact/hooks";

const CURVE = "C40.5 20 48 42 40.5 47.5C34 52 27 49 20.3 46.4C13 43.5 6 42.5 2.55 47.5C-1 54 2.55 68 2.55 75.5";
const CONNECTOR = "M-11 27.5V2.5a5 5 0 0 1 5-5h12a5 5 0 0 1 5 5v25Z";
const OFFSCREEN = 40;
const PLUG_MS = 1000;
const UNPLUG_MS = 700;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;

export function DeckPlug({ connected }: { connected: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const cable = useRef<SVGPathElement>(null);
  const connector = useRef<SVGPathElement>(null);
  const motion = useRef({ progress: 0, frame: 0 });

  const draw = () => {
    const path = cable.current!;
    const top = svg.current!.getBoundingClientRect().top;
    path.setAttribute("d", `M40.5 ${-(Math.max(top, 0) + OFFSCREEN)}V0${CURVE}`);
    const total = path.getTotalLength();
    const length = total * motion.current.progress;
    path.style.strokeDasharray = `${length} ${total}`;
    const head = path.getPointAtLength(length);
    const behind = path.getPointAtLength(Math.max(length - 1, 0));
    const angle = (Math.atan2(head.y - behind.y, head.x - behind.x) * 180) / Math.PI - 90;
    connector.current!.setAttribute("transform", `translate(${head.x} ${head.y}) rotate(${angle})`);
  };

  useEffect(() => {
    const m = motion.current;
    const target = connected ? 1 : 0;
    const from = m.progress;
    const duration = (connected ? PLUG_MS : UNPLUG_MS) * Math.abs(target - from);
    const ease = connected ? easeOut : easeIn;
    const start = performance.now();
    cancelAnimationFrame(m.frame);
    const tick = (now: number) => {
      const t = duration ? Math.min((now - start) / duration, 1) : 1;
      m.progress = from + (target - from) * ease(t);
      draw();
      m.frame = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    m.frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(m.frame);
  }, [connected]);

  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  return (
    <svg ref={svg} class="deck__cable" width="50" height="76" viewBox="0 0 50 76" fill="none" aria-hidden="true">
      <path ref={cable} stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path ref={connector} d={CONNECTOR} fill="currentColor" />
    </svg>
  );
}
