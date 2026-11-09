import { describe, expect, it } from 'vitest';
import { FAIRNESS_TOLERANCE, MAZE_SIZE } from '../shared/constants';
import { DIRS, bfsDistances, hasWall, lineOfSight, shortestPath } from '../shared/maze';
import { generateMaze, isFair, startDistances } from '../server/maze';
import { randomSeed } from '../server/rng';

const SEEDS = Array.from({ length: 100 }, (_, i) => i * 7919 + 1);

describe('maze generation', () => {
  it('produces a 21x21 grid with the goal in the centre and starts in opposite corners', () => {
    const m = generateMaze(1);
    expect(m.width).toBe(MAZE_SIZE);
    expect(m.height).toBe(MAZE_SIZE);
    expect(m.cells).toHaveLength(MAZE_SIZE * MAZE_SIZE);
    expect(m.goal).toEqual({ x: 10, y: 10 });
    expect(m.starts).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
  });

  it('is deterministic for a given seed', () => {
    expect(generateMaze(1234).cells).toEqual(generateMaze(1234).cells);
    expect(generateMaze(1234).cells).not.toEqual(generateMaze(4321).cells);
  });

  it.each(SEEDS)('seed %i: every cell is reachable (solvable from both starts)', (seed) => {
    const m = generateMaze(seed);
    const dist = bfsDistances(m, m.goal);
    expect([...dist].every((d) => d >= 0)).toBe(true);
    for (const s of m.starts) expect(shortestPath(m, s, m.goal)).not.toBeNull();
  });

  it.each(SEEDS)('seed %i: start-to-centre distances differ by at most 10%%', (seed) => {
    const m = generateMaze(seed);
    const [a, b] = startDistances(m);
    expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThanOrEqual(FAIRNESS_TOLERANCE);
    expect(isFair(m)).toBe(true);
  });

  it('keeps walls consistent on both sides and the outer boundary closed', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const m = generateMaze(seed);
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if (x < m.width - 1) expect(hasWall(m, x, y, 'right')).toBe(hasWall(m, x + 1, y, 'left'));
          if (y < m.height - 1) expect(hasWall(m, x, y, 'down')).toBe(hasWall(m, x, y + 1, 'up'));
          if (x === 0) expect(hasWall(m, x, y, 'left')).toBe(true);
          if (y === 0) expect(hasWall(m, x, y, 'up')).toBe(true);
          if (x === m.width - 1) expect(hasWall(m, x, y, 'right')).toBe(true);
          if (y === m.height - 1) expect(hasWall(m, x, y, 'down')).toBe(true);
        }
      }
    }
  });

  it('removes ~8% of internal walls so the maze has loops', () => {
    const m = generateMaze(99);
    let passages = 0;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        for (const d of DIRS) if (!hasWall(m, x, y, d)) passages++;
      }
    }
    passages /= 2;
    const cells = m.width * m.height;
    const perfectPassages = cells - 1;
    const internalWallsInPerfectMaze = 2 * m.width * (m.width - 1) - perfectPassages;
    const extra = passages - perfectPassages;
    expect(extra).toBe(Math.round(internalWallsInPerfectMaze * 0.08));
  });

  it('rejects unfair mazes (regenerates until fair)', () => {
    let regenerated = 0;
    for (const seed of SEEDS) if (generateMaze(seed).seed !== seed >>> 0) regenerated++;
    expect(regenerated).toBeGreaterThan(0);
  });
});

describe('random seed per session', () => {
  it('randomSeed is a crypto-random 32-bit integer that does not repeat', () => {
    const seeds = Array.from({ length: 200 }, randomSeed);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('two consecutive games get different mazes', () => {
    const a = generateMaze(randomSeed());
    const b = generateMaze(randomSeed());
    expect(a.cells).not.toEqual(b.cells);
  });

  it('150 random-seed mazes are all solvable and fair', () => {
    for (let i = 0; i < 150; i++) {
      const m = generateMaze(randomSeed());
      expect([...bfsDistances(m, m.goal)].every((d) => d >= 0)).toBe(true);
      expect(isFair(m)).toBe(true);
    }
  });
});

describe('line of sight', () => {
  it('only along an unobstructed row or column within range', () => {
    const m = generateMaze(5);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x + 1 < m.width; x++) {
        expect(lineOfSight(m, { x, y }, { x: x + 1, y }, 10)).toBe(!hasWall(m, x, y, 'right'));
      }
    }
    expect(lineOfSight(m, { x: 0, y: 0 }, { x: 1, y: 1 }, 10)).toBe(false);
    expect(lineOfSight(m, { x: 3, y: 3 }, { x: 3, y: 3 }, 10)).toBe(true);
  });
});
