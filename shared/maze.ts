import type { Dir } from './protocol';

export interface Point {
  x: number;
  y: number;
}

/**
 * Grid maze. `cells[y * width + x]` is a bitmask of the walls around that cell (see WALL).
 * Walls are always stored on both sides of an edge.
 */
export interface MazeData {
  width: number;
  height: number;
  cells: number[];
  seed: number;
  goal: Point;
  starts: [Point, Point];
}

export const WALL: Record<Dir, number> = { up: 1, right: 2, down: 4, left: 8 };
export const ALL_WALLS = 15;
export const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];

export const DIR_VEC: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export const OPPOSITE: Record<Dir, Dir> = { up: 'down', right: 'left', down: 'up', left: 'right' };

export function isDir(v: unknown): v is Dir {
  return v === 'up' || v === 'down' || v === 'left' || v === 'right';
}

export function inBounds(m: Pick<MazeData, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height;
}

export function hasWall(m: MazeData, x: number, y: number, dir: Dir): boolean {
  if (!inBounds(m, x, y)) return true;
  return (m.cells[y * m.width + x] & WALL[dir]) !== 0;
}

/** Removes the wall between (x,y) and its neighbour in `dir`. Outer boundary walls are never removed. */
export function removeWall(m: MazeData, x: number, y: number, dir: Dir): boolean {
  const v = DIR_VEC[dir];
  const nx = x + v.x;
  const ny = y + v.y;
  if (!inBounds(m, x, y) || !inBounds(m, nx, ny) || !hasWall(m, x, y, dir)) return false;
  m.cells[y * m.width + x] &= ~WALL[dir];
  m.cells[ny * m.width + nx] &= ~WALL[OPPOSITE[dir]];
  return true;
}

export function openNeighbours(m: MazeData, x: number, y: number): Point[] {
  const out: Point[] = [];
  for (const d of DIRS) {
    if (!hasWall(m, x, y, d)) out.push({ x: x + DIR_VEC[d].x, y: y + DIR_VEC[d].y });
  }
  return out;
}

/** BFS step distances from `from` to every cell (-1 = unreachable). */
export function bfsDistances(m: MazeData, from: Point): Int32Array {
  const dist = new Int32Array(m.width * m.height).fill(-1);
  const queue: number[] = [from.y * m.width + from.x];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % m.width;
    const y = (i - x) / m.width;
    for (const n of openNeighbours(m, x, y)) {
      const j = n.y * m.width + n.x;
      if (dist[j] === -1) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

/** Shortest path including both endpoints, or null when unreachable. */
export function shortestPath(m: MazeData, from: Point, to: Point): Point[] | null {
  const dist = bfsDistances(m, to);
  if (dist[from.y * m.width + from.x] < 0) return null;
  const path: Point[] = [{ ...from }];
  let cur = from;
  while (cur.x !== to.x || cur.y !== to.y) {
    const d = dist[cur.y * m.width + cur.x];
    const next = openNeighbours(m, cur.x, cur.y).find((n) => dist[n.y * m.width + n.x] === d - 1);
    if (!next) return null;
    path.push(next);
    cur = next;
  }
  return path;
}

export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
