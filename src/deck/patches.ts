export type Patch = { x: number; y: number; w: number; h: number; pixels: Uint8Array };

const BAND_GAP = 6;
const FULL_SHARE = 0.6;

export function patches(prev: Uint8Array | undefined, next: Uint8Array, width: number, height: number): Patch[] {
  const full = [{ x: 0, y: 0, w: width, h: height, pixels: next }];
  if (!prev || prev.length !== next.length) return full;
  const a = new Uint16Array(prev.buffer, prev.byteOffset, width * height);
  const b = new Uint16Array(next.buffer, next.byteOffset, width * height);
  const bands: { top: number; bottom: number; left: number; right: number }[] = [];
  for (let row = 0; row < height; row++) {
    const base = row * width;
    let left = 0;
    while (left < width && a[base + left] === b[base + left]) left++;
    if (left === width) continue;
    let right = width - 1;
    while (a[base + right] === b[base + right]) right--;
    const band = bands[bands.length - 1];
    if (band && row - band.bottom <= BAND_GAP) {
      band.bottom = row;
      band.left = Math.min(band.left, left);
      band.right = Math.max(band.right, right);
    } else bands.push({ top: row, bottom: row, left, right });
  }
  const area = bands.reduce((sum, s) => sum + (s.bottom - s.top + 1) * (s.right - s.left + 1), 0);
  if (area > width * height * FULL_SHARE) return full;
  return bands.map(({ top, bottom, left, right }) => {
    const w = right - left + 1;
    const h = bottom - top + 1;
    const pixels = new Uint8Array(w * h * 2);
    for (let row = 0; row < h; row++) {
      const from = ((top + row) * width + left) * 2;
      pixels.set(next.subarray(from, from + w * 2), row * w * 2);
    }
    return { x: left, y: top, w, h, pixels };
  });
}
