export type GestureSpec = { long_press?: number; hold?: number; repeat?: number };

type Emit = (context: string, type: "tap" | "longPress" | "holdStart" | "holdRepeat" | "holdEnd", extra?: Record<string, number>) => void;

type Press = {
  started: number;
  fired: boolean;
  holding: boolean;
  count: number;
  timers: number[];
};

export class Gestures {
  private presses = new Map<string, Press>();

  constructor(private emit: Emit) {}

  down(context: string, spec: GestureSpec | undefined) {
    this.cancel(context);
    const press: Press = { started: performance.now(), fired: false, holding: false, count: 0, timers: [] };
    this.presses.set(context, press);
    if (spec?.long_press) {
      press.timers.push(
        window.setTimeout(() => {
          press.fired = true;
          this.emit(context, "longPress");
        }, spec.long_press),
      );
    }
    if (spec?.hold) {
      press.timers.push(
        window.setTimeout(() => {
          press.fired = true;
          press.holding = true;
          this.emit(context, "holdStart");
          if (spec.repeat) {
            press.timers.push(
              window.setInterval(() => {
                press.count += 1;
                this.emit(context, "holdRepeat", { count: press.count });
              }, Math.max(50, spec.repeat)),
            );
          }
        }, spec.hold),
      );
    }
  }

  up(context: string) {
    const press = this.end(context);
    if (!press) return;
    if (press.holding) this.emit(context, "holdEnd", { duration: Math.round(performance.now() - press.started) });
    else if (!press.fired) this.emit(context, "tap");
  }

  cancel(context: string) {
    const press = this.end(context);
    if (press?.holding) this.emit(context, "holdEnd", { duration: Math.round(performance.now() - press.started) });
  }

  cancelAll() {
    for (const context of [...this.presses.keys()]) this.cancel(context);
  }

  private end(context: string) {
    const press = this.presses.get(context);
    if (!press) return undefined;
    this.presses.delete(context);
    press.timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    return press;
  }
}
