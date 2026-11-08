import { hasWall, type MazeData, type Point } from '../../../shared/maze';
import type { Slot } from '../../../shared/protocol';
import { PLAYER_COLORS } from './pov';

export interface MinimapModel {
  maze: MazeData;
  you: Slot;
  me: Point;
  opp: Point | null;
  reveal: Point[] | null;
  /** Half-size of the POV window in cells, drawn as a rectangle. */
  viewHalf: { x: number; y: number };
}

export function drawMinimap(canvas: HTMLCanvasElement, m: MinimapModel, now: number): void {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const pad = 6;
  const cs = (size - pad * 2) / m.maze.width;
  const X = (x: number) => pad + x * cs;
  const Y = (y: number) => pad + y * cs;

  // Goal
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);
  ctx.fillStyle = `rgba(74,222,128,${0.5 + pulse * 0.5})`;
  ctx.fillRect(X(m.maze.goal.x) - cs * 0.3, Y(m.maze.goal.y) - cs * 0.3, cs * 1.6, cs * 1.6);

  // Walls
  ctx.strokeStyle = '#5b6b9a';
  ctx.lineWidth = Math.max(1, cs * 0.18);
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (let y = 0; y < m.maze.height; y++) {
    for (let x = 0; x < m.maze.width; x++) {
      if (hasWall(m.maze, x, y, 'up')) { ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + 1), Y(y)); }
      if (hasWall(m.maze, x, y, 'left')) { ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x), Y(y + 1)); }
      if (x === m.maze.width - 1 && hasWall(m.maze, x, y, 'right')) { ctx.moveTo(X(x + 1), Y(y)); ctx.lineTo(X(x + 1), Y(y + 1)); }
      if (y === m.maze.height - 1 && hasWall(m.maze, x, y, 'down')) { ctx.moveTo(X(x), Y(y + 1)); ctx.lineTo(X(x + 1), Y(y + 1)); }
    }
  }
  ctx.stroke();

  if (m.reveal?.length) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1.5, cs * 0.35);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    m.reveal.forEach((p, i) => (i ? ctx.lineTo(X(p.x + 0.5), Y(p.y + 0.5)) : ctx.moveTo(X(p.x + 0.5), Y(p.y + 0.5))));
    ctx.stroke();
  }

  // POV window
  ctx.strokeStyle = '#ffffff40';
  ctx.lineWidth = 1;
  ctx.strokeRect(X(m.me.x + 0.5 - m.viewHalf.x), Y(m.me.y + 0.5 - m.viewHalf.y), m.viewHalf.x * 2 * cs, m.viewHalf.y * 2 * cs);

  const dot = (p: Point, slot: Slot, isMe: boolean) => {
    ctx.fillStyle = PLAYER_COLORS[slot];
    ctx.beginPath();
    const r = cs * (isMe ? 0.6 : 0.5);
    if (slot === 0) ctx.arc(X(p.x + 0.5), Y(p.y + 0.5), r, 0, Math.PI * 2);
    else ctx.rect(X(p.x + 0.5) - r, Y(p.y + 0.5) - r, r * 2, r * 2);
    ctx.fill();
    if (isMe) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };
  if (m.opp) dot(m.opp, m.you === 0 ? 1 : 0, false);
  dot(m.me, m.you, true);
}
