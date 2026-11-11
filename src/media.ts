import { t } from "./i18n";

const DB = "open-stream-deck-media";
const STORE = "files";
const PREFIX = "media:";
const MAX_EDGE = 206;
const MAX_FRAMES = 300;
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

let db: Promise<IDBDatabase> | null = null;

function open() {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
      }),
  );
}

export function isMediaRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export async function putMedia(file: Blob) {
  if (!file.type.startsWith("image/")) throw new Error(t("media.notImage"));
  if (file.size > MAX_MEDIA_BYTES) throw new Error(t("media.tooBig", { mb: 8 }));
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await request("readwrite", (s) => s.put(file, id));
  return `${PREFIX}${id}`;
}

export async function pruneMedia(used: string) {
  const keys = await request<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  for (const key of keys) if (!used.includes(`${PREFIX}${String(key)}`)) await request("readwrite", (s) => s.delete(key));
}

export function getMediaBlob(ref: string) {
  return request<Blob | undefined>("readonly", (s) => s.get(ref.slice(PREFIX.length)));
}

export type MediaFile = { id: string; kind: string; data: string };

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportMedia(): Promise<MediaFile[]> {
  const keys = await request<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  const blobs = await request<Blob[]>("readonly", (s) => s.getAll());
  return Promise.all(blobs.map(async (blob, i) => ({ id: String(keys[i]), kind: blob.type, data: await toBase64(blob) })));
}

export async function importMedia(files: MediaFile[]) {
  await request("readwrite", (s) => s.clear());
  for (const f of files) {
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    await request("readwrite", (s) => s.put(new Blob([bytes], { type: f.kind }), f.id));
  }
  for (const ref of [...frames.keys()]) drop(ref);
}

export type Frames = { images: ImageBitmap[]; ends: number[]; total: number };

type Decoded = { status: "loading" | "ready" | "error"; frames?: Frames; used: number };
const frames = new Map<string, Decoded>();
const IDLE_MS = 30_000;
let swept = 0;

function drop(ref: string) {
  frames.get(ref)?.frames?.images.forEach((image) => image.close());
  frames.delete(ref);
}

function sweep(now: number) {
  if (now - swept < IDLE_MS) return;
  swept = now;
  for (const [ref, d] of frames) if (d.status !== "loading" && now - d.used > IDLE_MS) drop(ref);
}

type DecoderFrame = { image: VideoFrame & { duration: number | null } };
type Decoder = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<DecoderFrame>;
  close(): void;
};
type DecoderCtor = {
  new (init: { data: ReadableStream | BufferSource; type: string }): Decoder;
  isTypeSupported(type: string): Promise<boolean>;
};

function fit(w: number, h: number) {
  const k = Math.min(1, MAX_EDGE / Math.min(w, h));
  return { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)) };
}

async function decode(ref: string): Promise<Frames> {
  const blob = await getMediaBlob(ref);
  if (!blob) throw new Error("missing");
  const Ctor = (window as unknown as { ImageDecoder?: DecoderCtor }).ImageDecoder;
  const animated = blob.type === "image/gif" || blob.type === "image/webp" || blob.type === "image/png";
  if (Ctor && animated && (await Ctor.isTypeSupported(blob.type))) {
    const decoder = new Ctor({ data: await blob.arrayBuffer(), type: blob.type });
    try {
      await decoder.tracks.ready;
      const count = Math.min(MAX_FRAMES, decoder.tracks.selectedTrack?.frameCount ?? 1);
      const images: ImageBitmap[] = [];
      const ends: number[] = [];
      let t = 0;
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        images.push(await createImageBitmap(image, { ...fit(image.displayWidth, image.displayHeight), resizeQuality: "high" }));
        const ms = (image.duration ?? 0) / 1000;
        t += ms >= 20 ? ms : 100;
        ends.push(t);
        image.close();
      }
      return { images, ends, total: t };
    } finally {
      decoder.close();
    }
  }
  const bitmap = await createImageBitmap(blob);
  const scaled = await createImageBitmap(bitmap, { ...fit(bitmap.width, bitmap.height), resizeQuality: "high" });
  bitmap.close();
  return { images: [scaled], ends: [0], total: 0 };
}

export function mediaFrames(ref: string): Frames | null {
  const now = performance.now();
  sweep(now);
  let d = frames.get(ref);
  if (!d) {
    d = { status: "loading", used: now };
    frames.set(ref, d);
    const entry = d;
    decode(ref).then(
      (f) => {
        entry.status = "ready";
        entry.frames = f;
      },
      () => (entry.status = "error"),
    );
  }
  d.used = now;
  return d.status === "ready" ? d.frames! : null;
}

export function frameAt(f: Frames, t: number) {
  if (f.images.length === 1 || f.total <= 0) return f.images[0];
  const at = t % f.total;
  let i = 0;
  while (i < f.ends.length - 1 && f.ends[i] <= at) i++;
  return f.images[i];
}
