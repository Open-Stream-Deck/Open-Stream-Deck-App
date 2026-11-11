export const PANEL_WIDTH = 480;
export const PANEL_HEIGHT = 854;

export const KEY_SIZE = 103;

export const SIDE_WIDTH = 85;
export const SIDE_HEIGHT = 406;

export type Rect = { x: number; y: number; w: number; h: number };

export function keyRect(index: number): Rect {
  const row = Math.floor(index / 5);
  const col = index % 5;
  return { x: 38 + row * 149, y: 730 - col * 148, w: KEY_SIZE, h: KEY_SIZE };
}

export const SIDE_RECT: Rect = { x: 35, y: 10, w: SIDE_HEIGHT, h: SIDE_WIDTH };

export const SCREEN = 0;
export const STAGE = 0xb00000;
export const TRANSITION_NEXT = 0xc00000;
const CACHE_BASE = 0x100000;
const PAGE_STRIDE = PANEL_WIDTH * 2 * 512;
export const CACHE_PAGES = Math.floor((STAGE - CACHE_BASE) / PAGE_STRIDE);

export function cacheCanvas(slot: number) {
  return CACHE_BASE + slot * PAGE_STRIDE;
}

export function keyTile(index: number) {
  return { x: (index % 4) * KEY_SIZE, y: Math.floor(index / 4) * KEY_SIZE };
}

export const SIDE_SECTIONS = [
  { v: 3, h: KEY_SIZE },
  { v: 152, h: KEY_SIZE },
  { v: 301, h: KEY_SIZE },
];

export function sideSectionRect(i: number): Rect {
  const s = SIDE_SECTIONS[i];
  return { x: SIDE_RECT.x + s.v, y: SIDE_RECT.y, w: s.h, h: SIDE_WIDTH };
}
