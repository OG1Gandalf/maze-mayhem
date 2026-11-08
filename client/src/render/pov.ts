import { ROLE_BADGE, VIEW_CELLS } from '../../../shared/constants';
import { DIR_VEC, hasWall, type MazeData, type Point } from '../../../shared/maze';
import type { CoinView, Dir, NpcView, Slot } from '../../../shared/protocol';

export const PLAYER_COLORS = ['#22d3ee', '#fb923c'] as const;

export interface Avatar {
  x: number;
  y: number;
  facing: Dir;
  slot: Slot;
  isMe: boolean;
  frozen?: boolean;
  boosted?: boolean;
  name: string;
}

export interface PovModel {
  maze: MazeData;
  me: Avatar;
  opp: Avatar | null;
  /** Projectile centres in fractional cell coordinates. */
  projectiles: { owner: Slot; x: number; y: number }[];
  coins: CoinView[];
  npcs: NpcView[];
  reveal: Point[] | null;
}

const WALL_COLOR = '#7385bd';
const FLOOR = '#0d1424';
const FLOOR_ALT = '#0f172b';
const NPC_RESOLVED_MARK: Record<string, string> = { bribed: '✓', failed: '!', killed: '✕', skipped: '→' };

export function cellSizeFor(w: number, h: number): number {
  return Math.max(24, Math.floor(Math.min(w, h) / VIEW_CELLS));
}

export function drawPov(ctx: CanvasRenderingContext2D, w: number, h: number, m: PovModel, now: number): void {
  const { maze } = m;
  const cs = cellSizeFor(w, h);
  const camX = m.me.x + 0.5;
  const camY = m.me.y + 0.5;
  const sx = (x: number) => (x - camX) * cs + w / 2;
  const sy = (y: number) => (y - camY) * cs + h / 2;

  ctx.fillStyle = '#04070d';
  ctx.fillRect(0, 0, w, h);

  const x0 = Math.max(0, Math.floor(camX - w / 2 / cs) - 1);
  const x1 = Math.min(maze.width - 1, Math.ceil(camX + w / 2 / cs) + 1);
  const y0 = Math.max(0, Math.floor(camY - h / 2 / cs) - 1);
  const y1 = Math.min(maze.height - 1, Math.ceil(camY + h / 2 / cs) + 1);

  // Floor
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      ctx.fillStyle = (x + y) % 2 ? FLOOR : FLOOR_ALT;
      ctx.fillRect(sx(x), sy(y), cs + 1, cs + 1);
    }
  }

  // Start pads
  maze.starts.forEach((s, i) => {
    ctx.fillStyle = PLAYER_COLORS[i] + '1f';
    ctx.fillRect(sx(s.x) + 3, sy(s.y) + 3, cs - 6, cs - 6);
  });

  drawGoal(ctx, sx(maze.goal.x), sy(maze.goal.y), cs, now);

  if (m.reveal?.length) drawPath(ctx, m.reveal, sx, sy, cs, now);

  for (const c of m.coins) drawCoin(ctx, sx(c.x) + cs / 2, sy(c.y) + cs / 2, cs, c.value, now);
  for (const n of m.npcs) drawNpc(ctx, sx(n.x) + cs / 2, sy(n.y) + cs / 2, cs, n, now);

  // Walls
  ctx.strokeStyle = WALL_COLOR;
  ctx.lineWidth = Math.max(3, cs * 0.1);
  ctx.lineCap = 'round';
  ctx.shadowColor = '#7385bd88';
  ctx.shadowBlur = cs * 0.15;
  ctx.beginPath();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = sx(x);
      const py = sy(y);
      if (hasWall(maze, x, y, 'up')) { ctx.moveTo(px, py); ctx.lineTo(px + cs, py); }
      if (hasWall(maze, x, y, 'left')) { ctx.moveTo(px, py); ctx.lineTo(px, py + cs); }
      if (x === maze.width - 1 && hasWall(maze, x, y, 'right')) { ctx.moveTo(px + cs, py); ctx.lineTo(px + cs, py + cs); }
      if (y === maze.height - 1 && hasWall(maze, x, y, 'down')) { ctx.moveTo(px, py + cs); ctx.lineTo(px + cs, py + cs); }
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Projectiles
  for (const p of m.projectiles) {
    const px = sx(p.x);
    const py = sy(p.y);
    ctx.fillStyle = PLAYER_COLORS[p.owner];
    ctx.shadowColor = PLAYER_COLORS[p.owner];
    ctx.shadowBlur = cs * 0.4;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(3, cs * 0.09), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.5, cs * 0.04), 0, Math.PI * 2);
    ctx.fill();
  }

  if (m.opp) drawAvatar(ctx, sx(m.opp.x) + cs / 2, sy(m.opp.y) + cs / 2, cs, m.opp, now);
  drawAvatar(ctx, sx(m.me.x) + cs / 2, sy(m.me.y) + cs / 2, cs, m.me, now);

  // POV vignette
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawGoal(ctx: CanvasRenderingContext2D, x: number, y: number, cs: number, now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);
  ctx.fillStyle = `rgba(74, 222, 128, ${0.18 + pulse * 0.2})`;
  ctx.fillRect(x + 2, y + 2, cs - 4, cs - 4);
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  ctx.setLineDash([cs * 0.12, cs * 0.08]);
  ctx.strokeRect(x + cs * 0.12, y + cs * 0.12, cs * 0.76, cs * 0.76);
  ctx.setLineDash([]);
  ctx.fillStyle = '#bbf7d0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(cs * 0.42)}px system-ui, sans-serif`;
  ctx.fillText('★', x + cs / 2, y + cs * 0.44);
  ctx.font = `800 ${Math.max(8, Math.round(cs * 0.16))}px system-ui, sans-serif`;
  ctx.fillText('GOAL', x + cs / 2, y + cs * 0.8);
}

function drawPath(ctx: CanvasRenderingContext2D, path: Point[], sx: (x: number) => number, sy: (y: number) => number, cs: number, now: number): void {
  ctx.save();
  ctx.strokeStyle = '#facc15';
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(3, cs * 0.12);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([cs * 0.2, cs * 0.18]);
  ctx.lineDashOffset = -now / 25;
  ctx.shadowColor = '#facc15';
  ctx.shadowBlur = cs * 0.3;
  ctx.beginPath();
  path.forEach((p, i) => {
    const px = sx(p.x) + cs / 2;
    const py = sy(p.y) + cs / 2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.restore();
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, cs: number, value: number, now: number): void {
  const r = cs * (0.14 + value / 400);
  const bob = Math.sin(now / 250 + x) * cs * 0.03;
  ctx.fillStyle = '#b45309';
  ctx.beginPath();
  ctx.arc(x, y + bob + 1.5, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(x, y + bob, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#78350f';
  ctx.font = `800 ${Math.round(r * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), x, y + bob + 0.5);
}

function drawNpc(ctx: CanvasRenderingContext2D, x: number, y: number, cs: number, n: NpcView, now: number): void {
  const label = ROLE_BADGE[n.role];
  if (n.status !== 'active') {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#64748b';
    ctx.font = `700 ${Math.round(cs * 0.2)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${label} ${NPC_RESOLVED_MARK[n.status] ?? ''}`, x, y);
    ctx.globalAlpha = 1;
    return;
  }
  const bob = Math.sin(now / 400 + n.id) * cs * 0.04;
  const bw = cs * 0.72;
  const bh = cs * 0.46;
  ctx.fillStyle = n.role === 'POLICE' ? '#1d4ed8' : '#a16207';
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2 + bob, bw, bh, cs * 0.1);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(cs * 0.22)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + bob + 1);
  ctx.fillStyle = '#fde68a';
  ctx.font = `700 ${Math.round(cs * 0.22)}px system-ui, sans-serif`;
  ctx.fillText('?', x, y - bh / 2 - cs * 0.12 + bob);
}

function drawAvatar(ctx: CanvasRenderingContext2D, x: number, y: number, cs: number, a: Avatar, now: number): void {
  const color = PLAYER_COLORS[a.slot];
  const r = cs * 0.3;
  const v = DIR_VEC[a.facing];

  if (a.boosted) {
    ctx.fillStyle = color + '33';
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(x - v.x * r * 0.6 * i, y - v.y * r * 0.6 * i, r * (1 - i * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.shadowColor = color;
  ctx.shadowBlur = cs * 0.35;
  ctx.fillStyle = color;
  ctx.beginPath();
  // P1 is a circle, P2 a rounded square, so players are distinguishable without color.
  if (a.slot === 0) ctx.arc(x, y, r, 0, Math.PI * 2);
  else ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.35);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (a.isMe) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Facing indicator: a white arrowhead just outside the body.
  const tipX = x + v.x * r * 1.65;
  const tipY = y + v.y * r * 1.65;
  const baseX = x + v.x * r * 1.05;
  const baseY = y + v.y * r * 1.05;
  const px = -v.y * r * 0.45;
  const py = v.x * r * 0.45;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px, baseY + py);
  ctx.lineTo(baseX - px, baseY - py);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#04121a';
  ctx.font = `800 ${Math.round(r * 0.95)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(a.slot + 1), x, y + 1);

  if (a.frozen) {
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = now / 40;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#e6ecff';
  ctx.font = `600 ${Math.max(10, Math.round(cs * 0.17))}px system-ui, sans-serif`;
  ctx.fillText(a.isMe ? 'YOU' : a.name, x, y - r - cs * 0.16);
}
