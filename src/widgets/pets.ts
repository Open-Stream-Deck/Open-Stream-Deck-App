type Ctx = CanvasRenderingContext2D;

const PALETTE: Record<string, string> = {
  o: "#2b2340",
  w: "#ffffff",
  s: "#d3d9ee",
  c: "#fff1df",
  p: "#ffa7c0",
  e: "#1d1729",
  h: "#ffffff",
  n: "#3b2c45",
  r: "#ff5f7e",
  y: "#ffd54f",
  z: "#a6cdff",
  b: "#ff8a5c",
  a: "#ff9636",
  g: "#6fcf6a",
};

const sym = (rows: string[]) => rows.map((r) => r + [...r].reverse().join(""));

const FOX_EARS = [
  "...o..............o...",
  "..owo............owo..",
  "..opwo..........owpo..",
  "..oppwo........owppo..",
  "..opppwo......owpppo..",
  "..opppwwoooooowwpppo..",
  "..oppwwwwwwwwwwwwppo..",
];

const FOX_EARS_FLAT = [
  "......................",
  "......................",
  ".oo................oo.",
  ".opoo............oopo.",
  ".oppwoo........oowppo.",
  "..opwwwoooooooowwwpo..",
  "..oowwwwwwwwwwwwwwoo..",
];

const FOX_FACE = [
  "..owwwwwwwwwwwwwwwwo..",
  "..owwwwwwwwwwwwwwwwo..",
  ".owwwwwwwwwwwwwwwwwwo.",
  ".owwwwwwwwwwwwwwwwwwo.",
  "oowwwwwwwwwwwwwwwwwwoo",
  "owswwwwwwwwwwwwwwwwswo",
  ".ooswwwwwwwwwwwwwwsoo.",
  "...oosswwwwwwwwssoo...",
  ".....oosswwwwssoo.....",
  ".......oowwwwoo.......",
  ".........oooo.........",
];

const FOX_TAIL = [
  "....ooo.....",
  "...owwwo....",
  "..owwwwwo...",
  "..owwwwwwo..",
  "..owwwwwwo..",
  "...owwwwwso.",
  "....owwwwso.",
  "....owwwwwso",
  "...owwwwwwso",
  "..owwwwwwsso",
  ".owwwwwwsso.",
  "owwwwwwsso..",
  "owwwwssoo...",
  ".ooooo......",
];

const CAT_EARS = sym([
  "...........",
  "...........",
  "..oo.......",
  "..opo......",
  "..oppo.....",
  "..owppooooo",
  ".owwwwwwwww",
]);

const CAT_EARS_FLAT = sym([
  "...........",
  "...........",
  "...........",
  "...........",
  "oooo.......",
  ".oppooooooo",
  ".owwwwwwwww",
]);

const CAT_FACE = sym([
  ".owwwwwtwwt",
  ".owwwwwtwwt",
  "owwwwwwwwww",
  "owwwwwwwwww",
  "owwwwwwwwww",
  "owswwwwwccc",
  ".owswwwcccc",
  "..oowwwcccc",
  "....ooooooo",
  "...........",
  "...........",
]);

const CAT_TAIL = [
  "........oo..",
  ".......owwo.",
  ".......owto.",
  "........owo.",
  "........owo.",
  ".......owto.",
  "......owwo..",
  ".....owto...",
  "....owwo....",
  "...owto.....",
  "..owwo......",
  ".owto.......",
  "owwo........",
  ".oo.........",
];

const DOG_EARS = sym([
  "...........",
  "...........",
  "...........",
  "......ooooo",
  "....oowwwww",
  "..oowwwwwww",
  ".odddwwwwww",
]);

const DOG_EARS_FLAT = DOG_EARS;

const DOG_FACE = sym([
  "odddddwwwww",
  "odddddwwwww",
  "oddddowwwww",
  "oddddowwwww",
  "oddddowwwcc",
  ".oddoowwccc",
  "..oo.owcccc",
  ".....owcccc",
  "......ooooo",
  "...........",
  "...........",
]);

const DOG_TAIL = [
  "............",
  "............",
  "............",
  "............",
  "............",
  "......oo....",
  ".....owwo...",
  ".....owwo...",
  "....owwo....",
  "...owwso....",
  "..owwso.....",
  ".owwso......",
  "owwso.......",
  ".ooo........",
];

const BUNNY_EARS = sym([
  "....oo.....",
  "...owpo....",
  "...owpo....",
  "...owpo....",
  "...owpo....",
  "...owpooooo",
  ".owwwwwwwww",
]);

const BUNNY_EARS_FLAT = sym([
  "...........",
  "...........",
  "...........",
  "....oo.....",
  "...owpo....",
  "...owpooooo",
  ".owwwwwwwww",
]);

const BUNNY_FACE = sym([
  "owwwwwwwwww",
  "owwwwwwwwww",
  "owwwwwwwwww",
  "owwwwwwwwww",
  "owwwwwwwwww",
  ".owwwwwwwcc",
  "..oowwwwccc",
  "....ooooooo",
  "...........",
  "...........",
  "...........",
]);

const BUNNY_TAIL = [
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "..ooo.......",
  ".owwwo......",
  ".owwwo......",
  "..ooo.......",
];

const BODY = [
  "..owwwwwwwwo..",
  ".owwwccccwwwo.",
  "owwwccccccwwwo",
  "owwwccccccwwwo",
  "owwwwccccwwwwo",
  "oswwwwccwwwwso",
  "oswowwoowwowso",
  "oswowwoowwowso",
  ".oooooooooooo.",
];

const STEP_A = ["oswowwooooowso", ".oooooo....oo."];
const STEP_B = ["oswooooowwowso", ".oo....oooooo."];

const LOAF = [
  "...oooooooooooooooooo...",
  "..owwwwwwwwwwwwwwwwwwo..",
  ".owwwwwwwwwwwwwwwwwwwwo.",
  "owwwwwwwwwwwwwwwwwwwwwwo",
  "owwwwwwwwwwwwwwwwwwwwwwo",
  "oswwwwwwwwwwwwwwwwwwwwso",
  ".osssssssssssssssssssso.",
  "..oooooooooooooooooooo..",
];

const PAW = ["owwwo", "ooooo"];
const LICK = [".oo.", "owwo", "owwo", "owwo"];
const CARROT = [".g.g.", "..g..", ".aaa.", ".aaa.", "..aa.", "..a..", "..a.."];

const HEART = ["rr.rr", "rrrrr", ".rrr.", "..r.."];
const ZED = ["zzzz", "..z.", ".z..", "zzzz"];
const BANG = ["yy", "yy", "yy", "..", "yy"];
const BALL = [".bb.", "bhbb", "bbbb", ".bb."];
const BUG = [
  ["yy.yy", "yyoyy", ".y.y."],
  [".....", ".yoy.", ".y.y."],
];

type Mode = "sit" | "walk" | "lie" | "sleep" | "wake" | "yawn" | "play" | "hunt" | "happy" | "groom" | "bark" | "nibble";

type Species = {
  colors: Record<string, string>;
  ears: string[];
  flat: string[];
  face: string[];
  tail: string[];
  nose: number;
  noseColor: string;
  hops?: boolean;
  likes: Partial<Record<Mode, number>>;
};

const SPECIES: Record<string, Species> = {
  fox: { colors: {}, ears: FOX_EARS, flat: FOX_EARS_FLAT, face: FOX_FACE, tail: FOX_TAIL, nose: 15, noseColor: "n", likes: { play: 1, hunt: 1 } },
  cat: {
    colors: { o: "#3a2433", w: "#ffb36b", s: "#e58a45", c: "#fff4e6", t: "#d26a2e" },
    ears: CAT_EARS,
    flat: CAT_EARS_FLAT,
    face: CAT_FACE,
    tail: CAT_TAIL,
    nose: 13,
    noseColor: "p",
    likes: { play: 0.8, hunt: 1.5, groom: 1.5 },
  },
  dog: {
    colors: { o: "#3a2a22", w: "#f2d2a2", s: "#d6aa74", c: "#fffaf0", d: "#9a6237" },
    ears: DOG_EARS,
    flat: DOG_EARS_FLAT,
    face: DOG_FACE,
    tail: DOG_TAIL,
    nose: 13,
    noseColor: "e",
    likes: { play: 2, hunt: 0.3, bark: 1 },
  },
  bunny: {
    colors: { o: "#352c45", w: "#e8e2f1", s: "#c6bdd8", c: "#ffffff" },
    ears: BUNNY_EARS,
    flat: BUNNY_EARS_FLAT,
    face: BUNNY_FACE,
    tail: BUNNY_TAIL,
    nose: 12,
    noseColor: "p",
    hops: true,
    likes: { nibble: 1.6 },
  },
};

type Bit = { kind: "heart" | "z" | "bang"; x: number; y: number; at: number };

type Pet = {
  kind: string;
  mode: Mode;
  from: number;
  until: number;
  x: number;
  dir: number;
  goal: number;
  look: number;
  lookAt: number;
  blink: number;
  hop: number;
  energy: number;
  joy: number;
  petted: number;
  ball: { x: number; y: number; vx: number; vy: number };
  bits: Bit[];
  emit: number;
  last: number;
};

const DURATION: Record<Mode, [number, number]> = {
  sit: [3, 9],
  walk: [3, 7],
  lie: [8, 20],
  sleep: [40, 120],
  wake: [2.6, 2.6],
  yawn: [1.8, 1.8],
  play: [7, 14],
  hunt: [4, 6],
  happy: [2.4, 2.4],
  groom: [3, 5],
  bark: [1.8, 2.6],
  nibble: [5, 8],
};

const HOP_MS = 420;
const GRAVITY = 70;

const pets = new Map<string, Pet>();

let px = 3;
let ox = 0;
let oy = 0;
let sp = SPECIES.fox;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const night = () => {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
};

function paint(ctx: Ctx, art: string[], x: number, y: number, flip = false, shear = 0) {
  const last = art.length - 1;
  art.forEach((row, j) => {
    const dx = last ? Math.round((shear * (last - j)) / last) : 0;
    for (let i = 0; i < row.length; i++) {
      const color = sp.colors[row[i]] ?? PALETTE[row[i]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + (x + dx + (flip ? row.length - 1 - i : i)) * px, oy + (y + j) * px, px, px);
    }
  });
}

function dot(ctx: Ctx, ch: string, x: number, y: number) {
  ctx.fillStyle = sp.colors[ch] ?? PALETTE[ch];
  ctx.fillRect(ox + x * px, oy + y * px, px, px);
}

type Eyes = "open" | "closed" | "happy" | "sleepy";

type Look = { eyes: Eyes; dx: number; flat?: boolean; blush?: boolean; mouth?: boolean };

function head(ctx: Ctx, x: number, y: number, look: Look) {
  paint(ctx, look.flat ? sp.flat : sp.ears, x, y);
  paint(ctx, sp.face, x, y + 7);
  const ey = y + 9;
  for (const ex of [x + 6, x + 14]) {
    const e = ex + look.dx;
    if (look.eyes === "open") {
      for (let r = 0; r < 3; r++) {
        dot(ctx, "e", e, ey + r);
        dot(ctx, "e", e + 1, ey + r);
      }
      dot(ctx, "h", e, ey);
    } else if (look.eyes === "sleepy") {
      dot(ctx, "o", e, ey + 1);
      dot(ctx, "o", e + 1, ey + 1);
      dot(ctx, "e", e, ey + 2);
      dot(ctx, "e", e + 1, ey + 2);
    } else {
      const arc = look.eyes === "happy" ? [2, 1, 1, 2] : [1, 2, 2, 1];
      arc.forEach((dy, i) => dot(ctx, "e", ex - 1 + i, ey + dy));
    }
  }
  if (look.blush) for (const bx of [4, 5, 16, 17]) dot(ctx, "p", x + bx, y + 12);
  dot(ctx, sp.noseColor, x + 10, y + sp.nose);
  dot(ctx, sp.noseColor, x + 11, y + sp.nose);
  if (look.mouth) {
    dot(ctx, "r", x + 10, y + sp.nose + 1);
    dot(ctx, "r", x + 11, y + sp.nose + 1);
  }
}

function shadow(ctx: Ctx, x: number, y: number, half: number) {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(ox + (x - half) * px, oy + y * px, half * 2 * px, px);
}

type Sit = Look & { lift: number; sway: number; tail: number; step?: number; headDy?: number };

function sitting(ctx: Ctx, cx: number, ground: number, o: Sit) {
  const x = Math.round(cx);
  const bx = x - 7;
  const by = ground - 9 - o.lift;
  shadow(ctx, x, ground, Math.max(4, 9 - o.lift));
  if (o.tail >= 0) paint(ctx, sp.tail, bx + 11, by - 5, false, o.sway);
  else paint(ctx, sp.tail, bx - 9, by - 5, true, -o.sway);
  paint(ctx, BODY, bx, by);
  if (o.step) paint(ctx, o.step > 0 ? STEP_A : STEP_B, bx, by + 7);
  const hy = by - 14 + (o.headDy ?? 0);
  head(ctx, x - 11, hy, o);
  return hy;
}

function lying(ctx: Ctx, cx: number, ground: number, look: Look, dir: number, dip: number) {
  const x = Math.round(cx);
  const by = ground - 8;
  shadow(ctx, x, ground, 12);
  if (dir > 0) paint(ctx, sp.tail, x - 18, by - 7, true, 1);
  else paint(ctx, sp.tail, x + 6, by - 7, false, -1);
  paint(ctx, LOAF, x - 12, by);
  head(ctx, x - 11, by - 12 + dip, look);
  paint(ctx, PAW, x - 7, ground - 2);
  paint(ctx, PAW, x + 2, ground - 2);
}

function crouching(ctx: Ctx, cx: number, ground: number, look: Look, dir: number, sway: number) {
  const x = Math.round(cx);
  const by = ground - 8;
  shadow(ctx, x, ground, 12);
  if (dir > 0) paint(ctx, sp.tail, x - 18, by - 10, true, -sway);
  else paint(ctx, sp.tail, x + 6, by - 10, false, sway);
  paint(ctx, LOAF, x - 12, by);
  head(ctx, x - 11, by - 13, look);
  paint(ctx, PAW, x - 7, ground - 2);
  paint(ctx, PAW, x + 2, ground - 2);
}

function enter(f: Pet, mode: Mode, t: number) {
  const [a, b] = DURATION[mode];
  f.mode = mode;
  f.from = t;
  f.until = t + rand(a, b) * 1000;
  if (mode === "sleep") f.until = t + Math.max(a, (1 - f.energy) * 240) * 1000;
  if (mode === "play") f.ball = { x: f.x + f.dir * 9, y: 4, vx: -f.dir * rand(4, 9), vy: 0 };
}

function next(f: Pet, t: number, w: number) {
  const likes = SPECIES[f.kind].likes;
  if (f.mode === "sleep") return night() && Math.random() < 0.6 ? enter(f, "sleep", t) : enter(f, "wake", t);
  if (f.mode === "wake") return enter(f, t - f.petted < 5000 ? "happy" : "sit", t);
  if (f.mode === "lie" && f.energy < 0.5 && Math.random() < 0.7) return enter(f, "sleep", t);
  if (f.mode === "happy" && likes.play && f.joy > 0.6 && f.energy > 0.3 && Math.random() < 0.4) return enter(f, "play", t);
  const tired = 1 - f.energy;
  const weights: [Mode, number][] = [
    ["sit", 3],
    ["walk", 3],
    ["lie", 1 + tired * 5 + (night() ? 3 : 0)],
    ["yawn", tired * 1.5],
    ["play", f.energy * (0.6 + f.joy * 2) * (likes.play ?? 0)],
    ["hunt", f.energy * 0.8 * (likes.hunt ?? 0)],
    ["groom", likes.groom ?? 0],
    ["bark", f.energy * (likes.bark ?? 0)],
    ["nibble", likes.nibble ?? 0],
  ];
  let roll = Math.random() * weights.reduce((s, [, v]) => s + v, 0);
  const mode = weights.find(([, v]) => (roll -= v) < 0)?.[0] ?? "sit";
  enter(f, mode, t);
  if (mode === "walk") {
    f.goal = Math.round(rand(10, w - 10));
    f.dir = f.goal >= f.x ? 1 : -1;
  }
  if (mode === "hunt") f.goal = Math.round(rand(10, w - 10));
}

function advance(f: Pet, t: number, w: number, ground: number) {
  const dt = Math.min(0.1, Math.max(0, (t - f.last) / 1000));
  f.last = t;
  const busy = f.mode === "play" || f.mode === "hunt";
  if (f.mode === "sleep") f.energy = Math.min(1, f.energy + dt / 240);
  else f.energy = Math.max(0, f.energy - (dt / (busy ? 300 : 900)) * (night() ? 2 : 1));
  f.joy = Math.max(0, f.joy - dt / 1800);
  if (t >= f.until) next(f, t, w);
  if (t > f.blink + 140) f.blink = t + rand(1800, 5200);
  if (t > f.lookAt) {
    f.look = [-1, 0, 0, 1][Math.floor(Math.random() * 4)];
    f.lookAt = t + rand(1200, 4000);
  }
  if (f.mode === "walk") {
    const d = f.goal - f.x;
    if (Math.abs(d) < 0.5) f.until = Math.min(f.until, t);
    else f.x += Math.sign(d) * Math.min(Math.abs(d), dt * 7);
  }
  if (f.mode === "play") play(f, t, dt, w, ground);
  if (f.mode === "hunt" && f.until - t < 900) {
    const bug = bugAt(f, t, ground);
    f.x += (bug.x - f.x) * Math.min(1, dt * 3);
    f.dir = bug.x >= f.x ? 1 : -1;
  }
  if (f.mode === "sleep" && t > f.emit) {
    f.bits.push({ kind: "z", x: Math.min(f.x + 6, w - 11), y: ground - 18, at: t });
    f.emit = t + 1700;
  }
  if (f.mode === "happy" && t > f.emit) {
    f.bits.push({ kind: "heart", x: f.x + rand(-6, 3), y: ground - 26, at: t });
    f.emit = t + 650;
  }
  if (f.mode === "bark" && t > f.emit) {
    f.bits.push({ kind: "bang", x: f.dir > 0 ? Math.min(f.x + 10, w - 3) : Math.max(f.x - 11, 1), y: ground - 24, at: t });
    f.emit = t + 600;
  }
  f.x = Math.max(10, Math.min(w - 10, f.x));
  f.bits = f.bits.filter((b) => t - b.at < (b.kind === "bang" ? 500 : 1800));
}

function play(f: Pet, t: number, dt: number, w: number, ground: number) {
  const b = f.ball;
  const floor = ground - 2;
  b.vy += GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.vx *= 1 - dt * 0.6;
  if (b.y > floor) {
    b.y = floor;
    b.vy = Math.abs(b.vy) > 6 ? -Math.abs(b.vy) * 0.55 : 0;
  }
  if (b.x < 2 || b.x > w - 2) {
    b.x = Math.max(2, Math.min(w - 2, b.x));
    b.vx = -b.vx * 0.8;
  }
  const d = b.x - f.x;
  f.dir = d >= 0 ? 1 : -1;
  if (Math.abs(d) > 4) f.x += Math.sign(d) * dt * 9;
  else if (b.y > floor - 5 && t - f.hop > HOP_MS + 150) {
    f.hop = t;
    b.vx = (d >= 0 ? 1 : -1) * rand(10, 22);
    b.vy = -rand(22, 38);
  }
}

function bugAt(f: Pet, t: number, ground: number) {
  const s = (t - f.from) / 1000;
  const flee = Math.max(0, 900 - (f.until - t)) / 40;
  return { x: f.goal + Math.sin(s * 1.6) * 6, y: ground - 22 + Math.round(Math.sin(s * 5.5)) - flee };
}

function hopLift(t: number, at: number, height: number) {
  const p = (t - at) / HOP_MS;
  return p >= 0 && p < 1 ? Math.round(Math.sin(p * Math.PI) * height) : 0;
}

function pet(id: string, kind: string, t: number, w: number) {
  let f = pets.get(id);
  if (!f || f.kind !== kind) {
    f = {
      kind,
      mode: "sit",
      from: t,
      until: t + 3000,
      x: w / 2,
      dir: 1,
      goal: w / 2,
      look: 0,
      lookAt: t,
      blink: t + 2000,
      hop: -Infinity,
      energy: night() ? 0.3 : 0.8,
      joy: 0.3,
      petted: -Infinity,
      ball: { x: 0, y: 0, vx: 0, vy: 0 },
      bits: [],
      emit: 0,
      last: t,
    };
    pets.set(id, f);
  }
  return f;
}

export function prunePets(live: Set<string>) {
  for (const id of pets.keys()) if (!live.has(id)) pets.delete(id);
}

export function petPress(id: string, down: boolean) {
  const f = pets.get(id);
  if (!f || !down) return;
  const t = performance.now();
  f.petted = t;
  f.joy = Math.min(1, f.joy + 0.12);
  if (f.mode === "sleep") enter(f, "wake", t);
  else if (f.mode !== "wake") {
    enter(f, "happy", t);
    f.emit = t;
  }
}

const PORTRAIT_SIZE = 96;

function portrait(ctx: Ctx, kind: string, left: number, top: number, cell: number) {
  sp = SPECIES[kind] ?? SPECIES.fox;
  const art = [...sp.ears, ...sp.face];
  const filled = art.map((row) => /[^.]/.test(row));
  const first = filled.indexOf(true);
  const last = filled.lastIndexOf(true);
  px = Math.floor(cell / (art[0].length + 2));
  ox = left + Math.round((cell - art[0].length * px) / 2);
  oy = top + Math.round((cell - (last - first + 1) * px) / 2) - first * px;
  head(ctx, 0, 0, { eyes: "open", dx: 0 });
}

export function petPortrait(kinds: string[]) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PORTRAIT_SIZE;
  const ctx = canvas.getContext("2d")!;
  const n = Math.ceil(Math.sqrt(kinds.length));
  const cell = PORTRAIT_SIZE / n;
  kinds.forEach((kind, i) => portrait(ctx, kind, (i % n) * cell, Math.floor(i / n) * cell, cell));
  return canvas.toDataURL();
}

function particles(ctx: Ctx, f: Pet, t: number) {
  for (const b of f.bits) {
    const age = (t - b.at) / 1000;
    ctx.globalAlpha = age > 1.3 ? 0.5 : 1;
    if (b.kind === "heart") paint(ctx, HEART, Math.round(b.x + Math.sin(age * 5) * 1.5), Math.round(b.y - age * 7));
    else if (b.kind === "z") paint(ctx, ZED, Math.round(b.x + age * 4), Math.round(b.y - age * 6));
    else paint(ctx, BANG, Math.round(b.x), Math.round(b.y - age * 6));
  }
  ctx.globalAlpha = 1;
}

export function drawPet(ctx: Ctx, w: number, h: number, id: string, t: number, kind: string) {
  sp = SPECIES[kind] ?? SPECIES.fox;
  px = Math.max(2, Math.floor(Math.min(w, h) / 28));
  const cols = Math.floor(w / px);
  const rows = Math.floor(h / px);
  ox = Math.floor((w - cols * px) / 2);
  oy = Math.floor((h - rows * px) / 2);
  const ground = rows - 3;
  const f = pet(id, kind, t, cols);
  advance(f, t, cols, ground);
  const frame = Math.floor(t / 125);
  const blink = t >= f.blink && t < f.blink + 140;
  const open: Eyes = blink ? "closed" : "open";
  const idle = Math.round(Math.sin(t / 650) * 1.5);
  const wag = [-2, 0, 2, 0][frame % 4];
  const p = (t - f.from) / (f.until - f.from);
  const tail = -f.dir;
  const x = Math.round(f.x);

  if (f.mode === "sleep") lying(ctx, f.x, ground, { eyes: "closed", dx: 0 }, f.dir, 2 + (Math.floor(t / 1400) % 2));
  else if (f.mode === "lie") lying(ctx, f.x, ground, { eyes: open, dx: f.look }, f.dir, 0);
  else if (f.mode === "wake") lying(ctx, f.x, ground, { eyes: p > 0.3 && p < 0.75 ? "closed" : "sleepy", dx: 0, mouth: p > 0.3 && p < 0.75 }, f.dir, p < 0.3 ? 1 : 0);
  else if (f.mode === "hunt" && f.until - t > 900) crouching(ctx, f.x, ground, { eyes: open, dx: Math.sign(bugAt(f, t, ground).x - f.x) }, f.dir, Math.round(Math.sin(t / 90) * 2));
  else if (f.mode === "hunt") sitting(ctx, f.x, ground, { eyes: "open", dx: f.dir, lift: Math.round(Math.sin((1 - (f.until - t) / 900) * Math.PI) * 8), sway: 2, tail });
  else if (f.mode === "walk" && sp.hops) sitting(ctx, f.x, ground, { eyes: open, dx: f.dir, lift: Math.round(Math.abs(Math.sin(t / 170)) * 3), sway: 0, tail });
  else if (f.mode === "walk") sitting(ctx, f.x, ground, { eyes: open, dx: f.dir, lift: frame % 4 === 1 ? 1 : 0, sway: idle, tail, step: frame % 4 < 2 ? 1 : -1 });
  else if (f.mode === "play") sitting(ctx, f.x, ground, { eyes: open, dx: f.dir, lift: hopLift(t, f.hop, 5), sway: wag, tail, step: Math.abs(f.ball.x - f.x) > 4 ? (frame % 4 < 2 ? 1 : -1) : 0 });
  else if (f.mode === "happy") sitting(ctx, f.x, ground, { eyes: "happy", dx: 0, flat: true, blush: true, mouth: kind === "dog", lift: sp.hops ? Math.round(Math.abs(Math.sin(t / 150)) * 4) : frame % 4 < 2 ? 1 : 0, sway: wag, tail });
  else if (f.mode === "yawn") sitting(ctx, f.x, ground, { eyes: "closed", dx: 0, mouth: p > 0.15 && p < 0.85, flat: p > 0.15 && p < 0.85, lift: 0, sway: idle, tail, headDy: p > 0.15 && p < 0.85 ? -1 : 0 });
  else if (f.mode === "groom") {
    const lick = frame % 4 < 2;
    const hy = sitting(ctx, f.x, ground, { eyes: "closed", dx: 0, mouth: lick, lift: 0, sway: idle, tail, headDy: lick ? 1 : 0 });
    paint(ctx, LICK, x + 6, hy + sp.nose + (lick ? 0 : 1));
  } else if (f.mode === "bark") {
    const woof = frame % 4 < 2;
    sitting(ctx, f.x, ground, { eyes: woof ? "closed" : "open", dx: f.dir, mouth: woof, lift: woof ? 1 : 0, sway: wag, tail, headDy: woof ? -1 : 0 });
  } else if (f.mode === "nibble") {
    const chew = frame % 2 === 0;
    const hy = sitting(ctx, f.x, ground, { eyes: open, dx: 0, mouth: chew, lift: 0, sway: 0, tail, headDy: chew ? 1 : 0 });
    const bite = Math.min(4, Math.floor(p * 5));
    paint(ctx, CARROT.slice(bite), x - 3, hy + sp.nose + 2 + bite);
  } else sitting(ctx, f.x, ground, { eyes: open, dx: f.look, lift: 0, sway: idle, tail });

  if (f.mode === "play") paint(ctx, BALL, Math.round(f.ball.x) - 2, Math.round(f.ball.y) - 2);
  if (f.mode === "hunt") {
    const bug = bugAt(f, t, ground);
    paint(ctx, BUG[frame % 2], Math.round(bug.x) - 2, Math.round(bug.y));
  }
  particles(ctx, f, t);
}
