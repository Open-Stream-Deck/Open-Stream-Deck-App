export class Commands {
  private buf = new Uint8Array(4096);
  private n = 0;

  get length() {
    return this.n;
  }

  bytes() {
    return this.buf.subarray(0, this.n);
  }

  private room(extra: number) {
    if (this.n + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }

  private u8(v: number) {
    this.buf[this.n++] = v & 0xff;
  }

  private u16(v: number) {
    this.buf[this.n++] = v & 0xff;
    this.buf[this.n++] = (v >> 8) & 0xff;
  }

  private u32(v: number) {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }

  canvas(address: number) {
    this.room(5);
    this.u8(0x01);
    this.u32(address);
    return this;
  }

  blit(x: number, y: number, w: number, h: number, pixels: Uint8Array) {
    this.room(9 + pixels.length);
    this.u8(0x02);
    this.u16(x);
    this.u16(y);
    this.u16(w);
    this.u16(h);
    this.buf.set(pixels, this.n);
    this.n += pixels.length;
    return this;
  }

  fill(x: number, y: number, w: number, h: number, color: number) {
    this.room(11);
    this.u8(0x03);
    [x, y, w, h, color].forEach((v) => this.u16(v));
    return this;
  }

  copy(src: number, sx: number, sy: number, dst: number, dx: number, dy: number, w: number, h: number) {
    this.room(21);
    this.u8(0x07);
    this.u32(src);
    this.u16(sx);
    this.u16(sy);
    this.u32(dst);
    [dx, dy, w, h].forEach((v) => this.u16(v));
    return this;
  }

  transition(next: number, effect: number, duration: number, ox: number, oy: number) {
    this.room(12);
    this.u8(0x0e);
    this.u32(next);
    this.u8(effect);
    [duration, ox, oy].forEach((v) => this.u16(v));
    return this;
  }

  vsync() {
    this.room(1);
    this.u8(0x0c);
    return this;
  }

  brightness(percent: number) {
    this.room(2);
    this.u8(0x08);
    this.u8(Math.max(0, Math.min(100, Math.round(percent))));
    return this;
  }
}
