import { invoke } from "@tauri-apps/api/core";

type Note = { freq: number; at: number; len: number; type?: OscillatorType; gain?: number };

export type SoundSpec = { name: string; file: string; offset: number };

export const FALLBACK_SOUND = "chime";

const SOUNDS: Record<string, Note[]> = {
  chime: [
    { freq: 1318.5, at: 0, len: 1.2 },
    { freq: 1046.5, at: 0.18, len: 1.5 },
  ],
  bell: [
    { freq: 880, at: 0, len: 2.2, type: "triangle" },
    { freq: 1760, at: 0, len: 1.2, gain: 0.4 },
    { freq: 2640, at: 0, len: 0.6, gain: 0.15 },
  ],
  beep: [0, 0.22, 0.44].map((at) => ({ freq: 1000, at, len: 0.14, type: "square" as const, gain: 0.35 })),
  soft: [523.25, 659.25, 783.99].map((freq, i) => ({ freq, at: i * 0.16, len: 1 })),
};

const LEVEL = 0.5;
const REPEAT_MS = 2200;
const REPEAT_LIMIT_MS = 60_000;

let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

const AudioCtor: typeof AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;

function audio() {
  context ??= new AudioCtor();
  if (context.state !== "running") context.resume().catch(() => undefined);
  return context;
}

for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, audio, { once: true, capture: true });

export function loadSound(path: string) {
  let buffer = buffers.get(path);
  if (!buffer) {
    buffer = invoke<ArrayBuffer>("read_audio", { path }).then((bytes) => audio().decodeAudioData(bytes));
    buffer.catch(() => buffers.delete(path));
    buffers.set(path, buffer);
  }
  return buffer;
}

export function parseOffset(text: unknown) {
  const m = String(text ?? "").trim().match(/^(?:(\d+):)?(\d+)$/);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : 0;
}

function playNotes(notes: Note[], volume: number) {
  const c = audio();
  for (const n of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const start = c.currentTime + 0.02 + n.at;
    osc.type = n.type ?? "sine";
    osc.frequency.value = n.freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(LEVEL * volume * (n.gain ?? 1), start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.len);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + n.len + 0.05);
  }
  return Math.max(...notes.map((n) => n.at + n.len)) * 1000;
}

function playSynth(notes: Note[], volume: number, repeat: boolean, onEnd: () => void) {
  const length = playNotes(notes, volume);
  const started = Date.now();
  const timer = repeat
    ? window.setInterval(() => {
        if (Date.now() - started < REPEAT_LIMIT_MS) playNotes(notes, volume);
        else {
          clearInterval(timer);
          onEnd();
        }
      }, REPEAT_MS)
    : window.setTimeout(onEnd, length);
  return () => clearTimeout(timer);
}

function playFile(spec: SoundSpec, volume: number, repeat: boolean, onEnd: () => void) {
  let stopped = false;
  let stop: () => void = () => undefined;
  loadSound(spec.file).then(
    (buffer) => {
      if (stopped) return;
      const c = audio();
      const source = c.createBufferSource();
      const gain = c.createGain();
      const offset = spec.offset < buffer.duration ? spec.offset : 0;
      source.buffer = buffer;
      source.loop = repeat;
      source.loopStart = offset;
      source.loopEnd = buffer.duration;
      gain.gain.value = volume;
      source.connect(gain).connect(c.destination);
      source.onended = () => !stopped && onEnd();
      source.start(0, offset);
      if (repeat) source.stop(c.currentTime + REPEAT_LIMIT_MS / 1000);
      stop = () => source.stop();
    },
    () => {
      if (!stopped) stop = playSynth(SOUNDS[FALLBACK_SOUND], volume, repeat, onEnd);
    },
  );
  return () => {
    stopped = true;
    stop();
  };
}

export function playSound(spec: SoundSpec, volume: number, repeat: boolean, onEnd: () => void = () => undefined) {
  if (volume <= 0 || spec.name === "none") return () => undefined;
  if (spec.name === "file" && spec.file) return playFile(spec, volume, repeat, onEnd);
  return playSynth(SOUNDS[spec.name] ?? SOUNDS[FALLBACK_SOUND], volume, repeat, onEnd);
}
