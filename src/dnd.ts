import type { ActionRef } from "./types";

export const ACTION_MIME = "application/x-deck-action";
export const KEY_MIME = "application/x-deck-key";
export const SIDE_MIME = "application/x-deck-side";

export type DropItem =
  | { type: "action"; ref: ActionRef }
  | { type: "key"; index: number }
  | { type: "side"; section: number };

const TYPES = [ACTION_MIME, KEY_MIME, SIDE_MIME];

export function canDrop(dt: DataTransfer | null) {
  return !!dt && TYPES.some((t) => dt.types.includes(t));
}

export function readDrop(dt: DataTransfer | null): DropItem | null {
  if (!dt) return null;
  try {
    const action = dt.getData(ACTION_MIME);
    if (action) return { type: "action", ref: JSON.parse(action) };
    const key = dt.getData(KEY_MIME);
    if (key) return { type: "key", index: Number(key) };
    const side = dt.getData(SIDE_MIME);
    if (side) return { type: "side", section: Number(side) };
  } catch {
    return null;
  }
  return null;
}

export function startDrag(e: DragEvent, mime: typeof KEY_MIME | typeof SIDE_MIME, value: number) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(mime, String(value));
  e.dataTransfer.effectAllowed = "copyMove";
}

export function dragOver(e: DragEvent) {
  if (!canDrop(e.dataTransfer)) return false;
  e.preventDefault();
  const fromSidebar = e.dataTransfer!.types.includes(ACTION_MIME);
  e.dataTransfer!.dropEffect = fromSidebar || e.ctrlKey ? "copy" : "move";
  return true;
}
