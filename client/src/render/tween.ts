/** Smoothly animates a position between server-confirmed cells. */
export class Tween {
  private fx = 0;
  private fy = 0;
  private tx = 0;
  private ty = 0;
  private start = 0;
  private dur = 1;
  private ready = false;

  target(x: number, y: number, durMs: number, now: number): void {
    if (this.ready && x === this.tx && y === this.ty) return;
    const far = Math.abs(x - this.tx) + Math.abs(y - this.ty) > 1;
    if (!this.ready || far) {
      this.snap(x, y);
      return;
    }
    const cur = this.get(now);
    this.fx = cur.x;
    this.fy = cur.y;
    this.tx = x;
    this.ty = y;
    this.start = now;
    this.dur = Math.max(1, durMs);
  }

  snap(x: number, y: number): void {
    this.fx = this.tx = x;
    this.fy = this.ty = y;
    this.dur = 1;
    this.start = 0;
    this.ready = true;
  }

  reset(): void {
    this.ready = false;
  }

  get(now: number): { x: number; y: number } {
    const t = Math.min(1, Math.max(0, (now - this.start) / this.dur));
    const e = t * (2 - t);
    return { x: this.fx + (this.tx - this.fx) * e, y: this.fy + (this.ty - this.fy) * e };
  }
}
