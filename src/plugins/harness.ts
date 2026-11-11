export type ToWorker = { k: "event"; e: Record<string, unknown> } | { k: "ping"; n: number };

export type FromWorker =
  | { k: "ready" }
  | { k: "cmd"; c: Record<string, unknown> }
  | { k: "pong"; n: number }
  | { k: "fatal"; message: string };

export function realmDocument(connect: string[]) {
  const sources = connect.length ? connect.join(" ") : "'none'";
  const policy = `default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src ${sources}`;
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">
<script>
addEventListener("message", function (e) {
  if (e.source !== parent || !e.data || e.data.opensd !== "boot" || !e.ports[0]) return;
  var worker = new Worker(URL.createObjectURL(new Blob([e.data.harness], { type: "text/javascript" })), { name: e.data.name });
  worker.onerror = function (err) {
    parent.postMessage({ opensd: "error", message: String(err.message || "The plugin worker failed") }, "*");
  };
  var transfer = [e.ports[0]];
  if (e.data.wasm) transfer.push(e.data.wasm);
  worker.postMessage({ opensd: "start", kind: e.data.kind, source: e.data.source, wasm: e.data.wasm }, transfer);
});
parent.postMessage({ opensd: "realm" }, "*");
<\/script>`;
}

export const HARNESS = String.raw`"use strict";
(function () {
  var port = null;
  var outbox = [];
  var started = performance.now();
  var timers = new Map();
  var pending = new Map();
  var streams = new Set();
  var serial = 0;
  var deliverToPlugin = null;

  function now() { return Math.round(performance.now() - started); }

  function post(message) {
    if (port) port.postMessage(message);
    else outbox.push(message);
  }

  function command(c) { post({ k: "cmd", c: c }); }

  function fatal(message) { post({ k: "fatal", message: String(message) }); }

  function text(values) {
    return values.map(function (v) {
      if (v instanceof Error) return v.stack || v.message;
      if (typeof v === "string") return v;
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }).join(" ");
  }

  function log(level, values) { command({ type: "log", level: level, message: text(values).slice(0, 16384) }); }

  ["debug", "info", "warn", "error"].forEach(function (level) {
    console[level] = function () { log(level, Array.prototype.slice.call(arguments)); };
  });
  console.log = function () { log("info", Array.prototype.slice.call(arguments)); };

  self.addEventListener("error", function (event) {
    log("error", [event.error || event.message]);
    event.preventDefault();
  });
  self.addEventListener("unhandledrejection", function (event) {
    log("error", ["Unhandled rejection:", event.reason]);
    event.preventDefault();
  });

  function route(c, reply) {
    if (!c || typeof c.type !== "string") return false;
    switch (c.type) {
      case "setTimer": {
        var id = String(c.id || "");
        var ms = Math.max(16, Number(c.ms) || 0);
        if (!id || (!timers.has(id) && timers.size >= 64)) return false;
        clearTimeout(timers.get(id));
        clearInterval(timers.get(id));
        var fire = function () {
          if (!c.repeat) timers.delete(id);
          reply({ type: "timer", id: id });
        };
        timers.set(id, c.repeat ? setInterval(fire, ms) : setTimeout(fire, ms));
        return true;
      }
      case "clearTimer": {
        clearTimeout(timers.get(String(c.id)));
        clearInterval(timers.get(String(c.id)));
        timers.delete(String(c.id));
        return true;
      }
    }
    command(c);
    return true;
  }

  var state = { plugin: { id: "", version: "" }, language: "en", device: null, globals: {}, navigation: null, keys: new Map() };
  var actions = new Map();
  var listeners = new Map();

  function jsReply(event) {
    var waiter = event.id != null && pending.get(String(event.id));
    if (waiter) {
      if (!streams.has(String(event.id))) pending.delete(String(event.id));
      waiter(event);
      return;
    }
    deliverJs(event);
  }

  function makeKey(info) {
    var context = info.context;
    var key = {
      context: context,
      action: info.action,
      controller: info.controller,
      position: info.position,
      setTitle: function (title, style) { command({ type: "setTitle", context: context, title: title == null ? null : String(title), style: style }); return key; },
      setImage: function (image) { command({ type: "setImage", context: context, image: image == null ? null : String(image) }); return key; },
      setState: function (s) { command({ type: "setState", context: context, state: Number(s) }); return key; },
      flash: function (kind) { command({ type: "flash", context: context, kind: kind === "alert" ? "alert" : "ok" }); return key; },
      saveSettings: function (settings) { command({ type: "setSettings", context: context, settings: settings || {} }); return key; },
      toInspector: function (payload) { command({ type: "toInspector", context: context, payload: payload === undefined ? null : payload }); return key; },
    };
    return Object.freeze(key);
  }

  function call(fn, event) {
    try {
      var result = fn(event);
      if (result && typeof result.then === "function") result.then(null, function (e) { log("error", [e]); });
    } catch (e) { log("error", [e]); }
  }

  function deliverJs(event) {
    switch (event.type) {
      case "init":
        state.plugin = event.plugin || state.plugin;
        state.language = event.app && event.app.language || state.language;
        state.device = event.device || null;
        state.globals = event.globals || {};
        state.keys.clear();
        break;
      case "device": state.device = event.device || null; break;
      case "language": state.language = event.language; break;
      case "globals": state.globals = event.settings || {}; break;
      case "navigation": state.navigation = { profile: event.profile, page: event.page, pages: event.pages }; break;
      case "appear":
        state.keys.set(event.context, makeKey(event));
        break;
    }
    if (event.context && state.keys.has(event.context)) event.key = state.keys.get(event.context);
    else if (event.context) event.key = makeKey(event);
    var handlers = event.action && actions.get(event.action);
    if (handlers && typeof handlers[event.type] === "function") call(handlers[event.type], event);
    (listeners.get(event.type) || []).forEach(function (fn) { call(fn, event); });
    if (event.type === "disappear") state.keys.delete(event.context);
  }

  function stream(c, fn) {
    var id = c.id;
    streams.add(id);
    pending.set(id, fn);
    route(c, jsReply);
    return function () { streams.delete(id); pending.delete(id); };
  }

  function request(c) {
    var id = "js" + ++serial;
    c.id = id;
    return new Promise(function (resolve, reject) {
      pending.set(id, function (event) {
        if (event.type === "denied") reject(new Error(event.message || "Permission denied"));
        else if (event.error) reject(new Error(event.error));
        else resolve(event);
      });
      if (!route(c, jsReply)) { pending.delete(id); reject(new Error("The command was refused")); }
    });
  }

  var api = {
    action: function (id, handlers) { actions.set(String(id), handlers || {}); },
    on: function (type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    key: function (context) { return state.keys.get(context) || makeKey({ context: context }); },
    keys: function (action) {
      return Array.from(state.keys.values()).filter(function (k) { return !action || k.action === action; });
    },
    get plugin() { return state.plugin; },
    get language() { return state.language; },
    get device() { return state.device; },
    get navigation() { return state.navigation; },
    get globals() { return state.globals; },
    now: now,
    setGlobals: function (settings) { state.globals = settings || {}; command({ type: "setGlobals", settings: state.globals }); },
    toSettingsPage: function (payload) { command({ type: "toSettingsPage", payload: payload === undefined ? null : payload }); },
    http: function (url, options) {
      var c = Object.assign({ type: "http", url: String(url) }, options || {});
      return request(c).then(function (e) { return { status: e.status, headers: e.headers || {}, body: e.body || "" }; });
    },
    ws: function (url) {
      var id = "ws" + ++serial;
      var socket = { onopen: null, onmessage: null, onclose: null,
        send: function (data) { route({ type: "wsSend", id: id, data: String(data) }, jsReply); },
        close: function () { route({ type: "wsClose", id: id }, jsReply); } };
      var end = stream({ type: "wsOpen", id: id, url: String(url) }, function (event) {
        if (event.type === "wsOpen" && socket.onopen) socket.onopen();
        else if (event.type === "wsMessage" && socket.onmessage) socket.onmessage(event.data);
        else if (event.type === "wsClose" || event.type === "denied") {
          end();
          if (socket.onclose) socket.onclose(event.reason || event.message || "closed");
        }
      });
      return socket;
    },
    app: {
      status: function (app) { return request({ type: "appStatus", app: String(app) }).then(function (e) { return { installed: !!e.installed, processes: e.processes || [] }; }); },
      launch: function (app, args) { return request({ type: "appLaunch", app: String(app), args: args || [] }).then(function () {}); },
      quit: function (app) { return request({ type: "appQuit", app: String(app) }).then(function () {}); },
      watch: function (app, fn) {
        var id = "aw" + ++serial;
        var end = stream({ type: "appWatch", id: id, app: String(app) }, function (event) {
          if (event.type === "denied") { end(); log("error", ["app.watch " + app + ": " + event.message]); return; }
          call(fn, { installed: !!event.installed, processes: event.processes || [] });
        });
        return function () { end(); command({ type: "appUnwatch", id: id }); };
      },
    },
    clipboard: function (value) { return request({ type: "clipboard", text: String(value) }).then(function () {}); },
    keyboard: {
      press: function (keys) { return request({ type: "hotkey", keys: String(keys), mode: "press" }).then(function () {}); },
      down: function (keys) { return request({ type: "hotkey", keys: String(keys), mode: "down" }).then(function () {}); },
      up: function (keys) { return request({ type: "hotkey", keys: String(keys), mode: "up" }).then(function () {}); },
      type: function (text) { return request({ type: "typeText", text: String(text) }).then(function () {}); },
    },
    switchProfile: function (profile, page) { command({ type: "switchProfile", profile: String(profile), page: page == null ? null : Number(page) }); },
    switchPage: function (page) { command({ type: "switchPage", page: Number(page) }); },
    openUrl: function (url) { command({ type: "openUrl", url: String(url) }); },
    log: function () { log("info", Array.prototype.slice.call(arguments)); },
    info: function () { log("info", Array.prototype.slice.call(arguments)); },
    warn: function () { log("warn", Array.prototype.slice.call(arguments)); },
    error: function () { log("error", Array.prototype.slice.call(arguments)); },
  };
  Object.defineProperty(self, "opensd", { value: Object.freeze(api), enumerable: true });

  function startWasm(bytes) {
    var exports = null;
    var encoder = new TextEncoder();
    var decoder = new TextDecoder();
    function reply(event) { deliverWasm(event); }
    var imports = {
      opensd: {
        send: function (ptr, len) {
          if (len > 2 * 1024 * 1024) return -1;
          var c;
          try { c = JSON.parse(decoder.decode(new Uint8Array(exports.memory.buffer, ptr >>> 0, len >>> 0))); } catch (e) { return -1; }
          return route(c, reply) ? 0 : -1;
        },
      },
    };
    function deliverWasm(event) {
      if (!exports) return;
      event.now = now();
      var bytes = encoder.encode(JSON.stringify(event));
      try {
        var ptr = exports.opensd_alloc(bytes.length) >>> 0;
        new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
        exports.opensd_event(ptr, bytes.length);
        exports.opensd_free(ptr, bytes.length);
      } catch (error) {
        exports = null;
        fatal("WebAssembly trap: " + (error && error.message || error));
      }
    }
    return WebAssembly.instantiate(bytes, imports).then(function (result) {
      exports = result.instance.exports;
      if (typeof exports.opensd_abi !== "function" || exports.opensd_abi() !== 1) throw new Error("Unsupported ABI");
      deliverToPlugin = deliverWasm;
    });
  }

  self.addEventListener("message", function (message) {
    var m = message.data;
    if (port || !m || m.opensd !== "start" || !message.ports[0]) return;
    port = message.ports[0];
    port.onmessage = function (e) {
      var data = e.data || {};
      if (data.k === "ping") { port.postMessage({ k: "pong", n: data.n }); return; }
      if (data.k === "event" && deliverToPlugin) {
        var event = data.e;
        if (event.id != null && pending.has(String(event.id))) { jsReply(event); return; }
        deliverToPlugin(event);
      }
    };
    var ready = function () {
      outbox.splice(0).forEach(function (o) { port.postMessage(o); });
      port.postMessage({ k: "ready" });
    };
    if (m.kind === "wasm") {
      startWasm(m.wasm).then(ready, function (error) { fatal("WebAssembly failed to start: " + (error && error.message || error)); });
      return;
    }
    try {
      importScripts(URL.createObjectURL(new Blob([m.source], { type: "text/javascript" })));
    } catch (error) {
      fatal("The plugin script failed to load: " + (error && (error.stack || error.message) || error));
      return;
    }
    deliverToPlugin = function (event) { event.now = now(); deliverJs(event); };
    ready();
  });
})();
`;
