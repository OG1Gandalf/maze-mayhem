import { DIRS, DIR_VEC, hasWall, type MazeData, type Point } from '../../../shared/maze';
import type { Role, Slot } from '../../../shared/protocol';

const PLAYER_COLORS: Record<Slot, string> = { 0: '#22d3ee', 1: '#fb923c' };
const ROLE_COLORS: Record<Role, string> = { MP: '#facc15', BUSINESSMAN: '#4ade80', MLA: '#e879f9', POLICE: '#60a5fa' };
/** How far down a straight corridor counts as "seen" for the fog of war. */
const SIGHT = 4;

export interface MinimapModel {
  maze: MazeData;
  you: Slot;
  /** Interpolated position in cell units. */
  me: { x: number; y: number };
  /** Camera yaw: the map rotates so that forward is always up. */
  yaw: number;
  /** Only passed while the opponent is within 5 cells. */
  opp: Point | null;
  reveal: Point[] | null;
  npcs: { x: number; y: number; role: Role }[];
}

/** Player-centred, rotating minimap with fog of war (explored cells are remembered for the whole game). */
export class Minimap {
  private readonly seen: Uint8Array;
  private readonly key: string;
  private dirty = false;
  private lastSave = 0;
  private lastCell = -1;

  constructor(private readonly canvas: HTMLCanvasElement, maze: MazeData, seed: number) {
    this.key = `mm.fog.${seed}`;
    this.seen = new Uint8Array(maze.width * maze.height);
    try {
      const saved = sessionStorage.getItem(this.key);
      if (saved && saved.length === this.seen.length) for (let i = 0; i < saved.length; i++) this.seen[i] = saved.charCodeAt(i) - 48;
    } catch {
      // Storage unavailable: fog just resets on reload.
    }
  }

  /** Marks the player's cell, its open neighbours and straight corridors in view as explored. */
  private explore(m: MazeData, cx: number, cy: number): void {
    const idx = cy * m.width + cx;
    if (idx === this.lastCell) return;
    this.lastCell = idx;
    const mark = (x: number, y: number) => {
      const i = y * m.width + x;
      if (!this.seen[i]) {
        this.seen[i] = 1;
        this.dirty = true;
      }
    };
    mark(cx, cy);
    for (const d of DIRS) {
      let x = cx;
      let y = cy;
      for (let k = 0; k < SIGHT && !hasWall(m, x, y, d); k++) {
        x += DIR_VEC[d].x;
        y += DIR_VEC[d].y;
        mark(x, y);
      }
    }
  }

  private save(now: number): void {
    if (!this.dirty || now - this.lastSave < 2000) return;
    this.dirty = false;
    this.lastSave = now;
    try {
      sessionStorage.setItem(this.key, String.fromCharCode(...[...this.seen].map((v) => v + 48)));
    } catch {
      // Ignore quota/storage errors.
    }
  }

  draw(m: MinimapModel, now: number, big: boolean): void {
    const maze = m.maze;
    this.explore(maze, Math.round(m.me.x), Math.round(m.me.y));
    this.save(now);

    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const radius = big ? 12 : 6.5;
    const cs = Math.min(w, h) / (radius * 2);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-m.yaw);
    ctx.translate(-(m.me.x + 0.5) * cs, -(m.me.y + 0.5) * cs);

    // Explored floor.
    ctx.fillStyle = '#1d2a4a';
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) if (this.seen[y * maze.width + x]) ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
    }

    // Walls of explored cells only.
    ctx.strokeStyle = '#7f93c9';
    ctx.lineWidth = Math.max(1, cs * 0.16);
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        if (!this.seen[y * maze.width + x]) continue;
        const X = x * cs;
        const Y = y * cs;
        if (hasWall(maze, x, y, 'up')) { ctx.moveTo(X, Y); ctx.lineTo(X + cs, Y); }
        if (hasWall(maze, x, y, 'down')) { ctx.moveTo(X, Y + cs); ctx.lineTo(X + cs, Y + cs); }
        if (hasWall(maze, x, y, 'left')) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + cs); }
        if (hasWall(maze, x, y, 'right')) { ctx.moveTo(X + cs, Y); ctx.lineTo(X + cs, Y + cs); }
      }
    }
    ctx.stroke();

    // MP path reveal (shown through the fog).
    if (m.reveal?.length) {
      ctx.strokeStyle = '#facc15';
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 160);
      ctx.lineWidth = Math.max(2, cs * 0.32);
      ctx.lineJoin = 'round';
      ctx.setLineDash([cs * 0.5, cs * 0.35]);
      ctx.lineDashOffset = -now / 40;
      ctx.beginPath();
      m.reveal.forEach((p, i) => (i ? ctx.lineTo((p.x + 0.5) * cs, (p.y + 0.5) * cs) : ctx.moveTo((p.x + 0.5) * cs, (p.y + 0.5) * cs)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Goal: always shown, it is the beacon you can see from anywhere.
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    const gx = (maze.goal.x + 0.5) * cs;
    const gy = (maze.goal.y + 0.5) * cs;
    ctx.fillStyle = `rgba(250,204,21,${0.25 + pulse * 0.25})`;
    ctx.beginPath();
    ctx.arc(gx, gy, cs * (1 + pulse * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(gx, gy, cs * 0.45, 0, Math.PI * 2);
    ctx.fill();

    for (const n of m.npcs) {
      ctx.fillStyle = ROLE_COLORS[n.role];
      const x = (n.x + 0.5) * cs;
      const y = (n.y + 0.5) * cs;
      const r = cs * 0.38;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
    }

    if (m.opp) {
      const oppSlot: Slot = m.you === 0 ? 1 : 0;
      ctx.fillStyle = PLAYER_COLORS[oppSlot];
      const r = cs * 0.42;
      const x = (m.opp.x + 0.5) * cs;
      const y = (m.opp.y + 0.5) * cs;
      ctx.beginPath();
      if (oppSlot === 0) ctx.arc(x, y, r, 0, Math.PI * 2);
      else ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.fill();
    }
    ctx.restore();

    // The player: an arrow at the centre, always pointing up (= forward).
    const r = Math.max(5, cs * 0.6);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = PLAYER_COLORS[m.you];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.75, r * 0.7);
    ctx.lineTo(0, r * 0.35);
    ctx.lineTo(-r * 0.75, r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North marker on the rim so the rotation stays readable.
    const nx = Math.sin(-m.yaw) * (Math.min(w, h) / 2 - 9);
    const ny = -Math.cos(-m.yaw) * (Math.min(w, h) / 2 - 9);
    ctx.fillStyle = '#8a97b8';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', w / 2 + nx, h / 2 + ny);
  }
}
