import { HARNESS, realmDocument, type FromWorker } from "./harness";

export type RealmState = "starting" | "running" | "restarting" | "crashed" | "stopped";

export type RealmSpec = {
  id: string;
  kind: "wasm" | "js";
  code: string;
  connect: string[];
};

type Handlers = {
  ready(session: number): void;
  command(command: Record<string, unknown>, session: number): void;
  state(state: RealmState, message?: string): void;
  ended(session: number): void;
};

const BOOT_MS = 15000;
const PING_MS = 5000;
const HANG_MS = 10000;
const STABLE_MS = 60000;
const DELAYS = [1000, 2000, 5000, 10000, 30000];
const BURST = 600;
const RATE = 300;

let container: HTMLDivElement | null = null;
let sessions = 0;

function host() {
  if (!container) {
    container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
    document.body.appendChild(container);
  }
  return container;
}

export class Realm {
  private frame: HTMLIFrameElement | null = null;
  private port: MessagePort | null = null;
  private session = 0;
  private pinger = 0;
  private lastPong = 0;
  private started = 0;
  private failures = 0;
  private retry = 0;
  private boot = 0;
  private tokens = BURST;
  private refilled = 0;
  private warned = false;
  private stopped = false;
  private onWindowMessage = (e: MessageEvent) => this.frameMessage(e);
  state: RealmState = "stopped";

  constructor(
    private spec: RealmSpec,
    private handlers: Handlers,
  ) {}

  start() {
    this.stopped = false;
    this.failures = 0;
    this.launch();
  }

  send(event: Record<string, unknown>) {
    if (this.state === "running") this.port?.postMessage({ k: "event", e: event });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.teardown();
    this.setState("stopped");
  }

  private setState(state: RealmState, message?: string) {
    this.state = state;
    this.handlers.state(state, message);
  }

  private launch() {
    if (this.stopped) return;
    this.teardown();
    this.setState(this.failures ? "restarting" : "starting");
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", this.spec.id);
    frame.srcdoc = realmDocument(this.spec.connect);
    this.frame = frame;
    window.addEventListener("message", this.onWindowMessage);
    host().appendChild(frame);
    this.boot = window.setTimeout(() => this.fail("The plugin did not start in time"), BOOT_MS);
  }

  private async frameMessage(e: MessageEvent) {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const m = e.data as { opensd?: string; message?: string };
    if (m?.opensd === "error") return this.fail(m.message ?? "The plugin worker failed");
    if (m?.opensd !== "realm" || this.port) return;
    const frame = this.frame;
    try {
      const response = await fetch(this.spec.code, { cache: "no-store" });
      if (!response.ok) throw new Error(`${this.spec.code}: ${response.status}`);
      const source = this.spec.kind === "js" ? await response.text() : undefined;
      const wasm = this.spec.kind === "wasm" ? await response.arrayBuffer() : undefined;
      if (frame !== this.frame || this.stopped) return;
      const channel = new MessageChannel();
      this.port = channel.port1;
      this.session = ++sessions;
      const session = this.session;
      this.port.onmessage = (event) => this.workerMessage(event.data as FromWorker, session);
      const transfer: Transferable[] = [channel.port2];
      if (wasm) transfer.push(wasm);
      frame.contentWindow?.postMessage({ opensd: "boot", name: this.spec.id, kind: this.spec.kind, harness: HARNESS, source, wasm }, "*", transfer);
    } catch (error) {
      this.fail(String(error));
    }
  }

  private workerMessage(m: FromWorker, session: number) {
    if (session !== this.session || !m) return;
    switch (m.k) {
      case "ready":
        clearTimeout(this.boot);
        this.started = performance.now();
        this.lastPong = this.started;
        this.setState("running");
        this.watch();
        this.handlers.ready(session);
        return;
      case "pong":
        this.lastPong = performance.now();
        return;
      case "fatal":
        this.fail(String(m.message));
        return;
      case "cmd":
        if (m.c && typeof m.c === "object" && this.spend()) this.handlers.command(m.c, session);
        return;
    }
  }

  private spend() {
    const now = performance.now();
    this.tokens = Math.min(BURST, this.tokens + ((now - this.refilled) / 1000) * RATE);
    this.refilled = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.warned = false;
      return true;
    }
    if (!this.warned) {
      this.warned = true;
      this.handlers.command({ type: "log", level: "warn", message: "Command rate limit reached; commands are dropped" }, this.session);
    }
    return false;
  }

  private watch() {
    clearInterval(this.pinger);
    let n = 0;
    this.pinger = window.setInterval(() => {
      if (performance.now() - this.lastPong > HANG_MS) {
        this.fail("The plugin stopped responding");
        return;
      }
      this.port?.postMessage({ k: "ping", n: ++n });
    }, PING_MS);
  }

  private fail(message: string) {
    if (this.stopped) return;
    const ranLong = this.started && performance.now() - this.started > STABLE_MS;
    this.failures = ranLong ? 1 : this.failures + 1;
    this.teardown();
    if (this.failures > DELAYS.length) {
      this.setState("crashed", message);
      return;
    }
    this.setState("restarting", message);
    this.retry = window.setTimeout(() => this.launch(), DELAYS[this.failures - 1]);
  }

  private teardown() {
    clearTimeout(this.boot);
    clearInterval(this.pinger);
    window.removeEventListener("message", this.onWindowMessage);
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
      this.port = null;
    }
    if (this.session) {
      this.handlers.ended(this.session);
      this.session = 0;
    }
    this.started = 0;
    this.frame?.remove();
    this.frame = null;
  }
}
