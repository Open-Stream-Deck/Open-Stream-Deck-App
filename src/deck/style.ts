export const deckStyle = {
  keyRadius: 0,
  sideRadius: 0,
};

export function setDeckStyle(next: Partial<typeof deckStyle>) {
  Object.assign(deckStyle, next);
}

export function styleKey() {
  return `${deckStyle.keyRadius}:${deckStyle.sideRadius}`;
}

export function roundCorners(ctx: CanvasRenderingContext2D, w: number, h: number, radius: number, corners = [true, true, true, true]) {
  if (radius <= 0) return;
  const r = Math.min(radius, w / 2, h / 2);
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.roundRect(0, 0, w, h, corners.map((c) => (c ? r : 0)));
  ctx.fill("evenodd");
  ctx.restore();
}
