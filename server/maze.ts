import { FAIRNESS_TOLERANCE, LOOP_FRACTION, MAZE_SIZE } from '../shared/constants';
import { ALL_WALLS, DIRS, DIR_VEC, bfsDistances, hasWall, inBounds, removeWall, type MazeData } from '../shared/maze';
import { createRng, type Rng } from './rng';

export interface MazeOptions {
  size?: number;
  loopFraction?: number;
  fairness?: number;
  maxAttempts?: number;
}

function emptyMaze(size: number, seed: number): MazeData {
  const c = Math.floor(size / 2);
  return {
    width: size,
    height: size,
    cells: new Array(size * size).fill(ALL_WALLS),
    seed,
    goal: { x: c, y: c },
    starts: [
      { x: 0, y: 0 },
      { x: size - 1, y: size - 1 },
    ],
  };
}

/** Iterative recursive backtracker: produces a perfect maze (exactly one path between any two cells). */
function carve(m: MazeData, rng: Rng): void {
  const visited = new Uint8Array(m.width * m.height);
  const stack = [{ x: rng.int(0, m.width - 1), y: rng.int(0, m.height - 1) }];
  visited[stack[0].y * m.width + stack[0].x] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = DIRS.filter((d) => {
      const nx = cur.x + DIR_VEC[d].x;
      const ny = cur.y + DIR_VEC[d].y;
      return inBounds(m, nx, ny) && !visited[ny * m.width + nx];
    });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const d = rng.pick(options);
    removeWall(m, cur.x, cur.y, d);
    const next = { x: cur.x + DIR_VEC[d].x, y: cur.y + DIR_VEC[d].y };
    visited[next.y * m.width + next.x] = 1;
    stack.push(next);
  }
}

/** Removes `fraction` of the remaining internal walls to create loops. Returns how many were removed. */
function addLoops(m: MazeData, rng: Rng, fraction: number): number {
  const walls: { x: number; y: number; d: 'right' | 'down' }[] = [];
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (x < m.width - 1 && hasWall(m, x, y, 'right')) walls.push({ x, y, d: 'right' });
      if (y < m.height - 1 && hasWall(m, x, y, 'down')) walls.push({ x, y, d: 'down' });
    }
  }
  const count = Math.round(walls.length * fraction);
  rng.shuffle(walls);
  for (let i = 0; i < count; i++) removeWall(m, walls[i].x, walls[i].y, walls[i].d);
  return count;
}

export function startDistances(m: MazeData): [number, number] {
  const d = bfsDistances(m, m.goal);
  const at = (p: { x: number; y: number }) => d[p.y * m.width + p.x];
  return [at(m.starts[0]), at(m.starts[1])];
}

/** True when both starts reach the goal and their shortest paths differ by at most `tolerance`. */
export function isFair(m: MazeData, tolerance = FAIRNESS_TOLERANCE): boolean {
  const [a, b] = startDistances(m);
  if (a < 0 || b < 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

/** Generates a fair, loopy maze. Deterministic for a given seed; `maze.seed` is the attempt seed that succeeded. */
export function generateMaze(seed: number, opts: MazeOptions = {}): MazeData {
  const size = opts.size ?? MAZE_SIZE;
  const fraction = opts.loopFraction ?? LOOP_FRACTION;
  const tolerance = opts.fairness ?? FAIRNESS_TOLERANCE;
  const maxAttempts = opts.maxAttempts ?? 500;
  const seeds = createRng(seed);
  let last: MazeData | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = attempt === 0 ? seed >>> 0 : Math.floor(seeds.next() * 0xffffffff);
    const rng = createRng(attemptSeed);
    const m = emptyMaze(size, attemptSeed);
    carve(m, rng);
    addLoops(m, rng, fraction);
    if (isFair(m, tolerance)) return m;
    last = m;
  }
  throw new Error(`Could not generate a fair maze after ${maxAttempts} attempts (last seed ${last?.seed})`);
}
