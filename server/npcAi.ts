/**
 * Grid AI for NPCs. Pure functions over the maze so they are easy to test:
 * NPCs only ever step between open neighbouring cells and never enter the goal.
 * NPCs do not block movement (contact opens an encounter instead), so they can never trap a player.
 */
import {
  NPC_CHASE_RADIUS,
  NPC_CHASE_STEP_MS,
  NPC_LOSE_RADIUS,
  NPC_PATROL_FACTOR,
  NPC_PATROL_RADIUS,
} from '../shared/constants';
import { DIRS, DIR_VEC, hasWall, type MazeData, type Point } from '../shared/maze';
import type { Dir, Role } from '../shared/protocol';
import type { Rng } from './rng';

export interface AiNpc {
  role: Role;
  x: number;
  y: number;
  home: Point;
  mode: string;
  patrolTarget: Point | null;
}

export interface AiWorld {
  maze: MazeData;
  player: Point;
  /** The player's current shortest path to the goal (including both ends). */
  playerPath: Point[];
  playerMoveMs: number;
  /** The player is in an encounter / cinematic / grace period: chasers wait a couple of steps away. */
  playerBusy?: boolean;
  /** Cells taken by the player's other NPCs; an NPC waits rather than stepping onto one. */
  occupied?: Set<number>;
}

/** While the player is busy, chasers keep at least this many steps away. */
export const NPC_HOLD_DISTANCE = 3;

export interface AiDecision {
  mode: 'patrol' | 'chase';
  next: Point | null;
  facing: Dir | null;
  stepMs: number;
  patrolTarget: Point | null;
}

interface Bfs {
  dist: Int32Array;
  prev: Int32Array;
}

/** BFS from `start` that never enters the goal cell. */
export function bfsAvoidingGoal(m: MazeData, start: Point): Bfs {
  const n = m.width * m.height;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const goalIdx = m.goal.y * m.width + m.goal.x;
  const s = start.y * m.width + start.x;
  dist[s] = 0;
  const queue = [s];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % m.width;
    const y = (i - x) / m.width;
    for (const d of DIRS) {
      if (hasWall(m, x, y, d)) continue;
      const j = (y + DIR_VEC[d].y) * m.width + (x + DIR_VEC[d].x);
      if (j === goalIdx || dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      prev[j] = i;
      queue.push(j);
    }
  }
  return { dist, prev };
}

/** First step on the BFS path from the search origin towards `target`, or null if unreachable / already there. */
function firstStep(m: MazeData, bfs: Bfs, target: Point): Point | null {
  let i = target.y * m.width + target.x;
  if (bfs.dist[i] <= 0) return null;
  while (bfs.dist[i] > 1) i = bfs.prev[i];
  return { x: i % m.width, y: Math.floor(i / m.width) };
}

function dirBetween(a: Point, b: Point): Dir | null {
  return DIRS.find((d) => a.x + DIR_VEC[d].x === b.x && a.y + DIR_VEC[d].y === b.y) ?? null;
}

function pickPatrolTarget(m: MazeData, home: Point, rng: Rng): Point {
  const bfs = bfsAvoidingGoal(m, home);
  const options: Point[] = [];
  for (let i = 0; i < bfs.dist.length; i++) {
    if (bfs.dist[i] > 0 && bfs.dist[i] <= NPC_PATROL_RADIUS) options.push({ x: i % m.width, y: Math.floor(i / m.width) });
  }
  return options.length ? rng.pick(options) : { ...home };
}

/**
 * Decides an NPC's next step.
 * Chase: when the player is within NPC_CHASE_RADIUS steps (keeps chasing until NPC_LOSE_RADIUS). Up close it heads
 * straight for the player; further out it aims for the earliest cell on the player's route to the centre that it can
 * reach first, to cut them off. Otherwise it patrols around its home cell.
 */
export function decide(npc: AiNpc, world: AiWorld, rng: Rng): AiDecision {
  const m = world.maze;
  const bfs = bfsAvoidingGoal(m, npc);
  const chaseMs = NPC_CHASE_STEP_MS[npc.role];
  const dPlayer = bfs.dist[world.player.y * m.width + world.player.x];
  const chasing = dPlayer >= 0 && (dPlayer <= NPC_CHASE_RADIUS || (npc.mode === 'chase' && dPlayer <= NPC_LOSE_RADIUS));

  if (chasing) {
    let target: Point = world.player;
    if (dPlayer > 2) {
      for (let i = 1; i < world.playerPath.length - 1; i++) {
        const c = world.playerPath[i];
        const d = bfs.dist[c.y * m.width + c.x];
        if (d >= 0 && d * chaseMs <= i * world.playerMoveMs) {
          target = c;
          break;
        }
      }
    }
    // Once standing on the cut-off cell, close in on the player instead of waiting forever.
    let next = firstStep(m, bfs, target) ?? firstStep(m, bfs, world.player);
    const facing = next ? dirBetween(npc, next) : null;
    if (world.playerBusy && dPlayer <= NPC_HOLD_DISTANCE) next = null;
    if (next && world.occupied?.has(next.y * m.width + next.x)) next = null;
    return { mode: 'chase', next, facing, stepMs: chaseMs, patrolTarget: null };
  }

  let patrolTarget = npc.patrolTarget;
  if (!patrolTarget || (patrolTarget.x === npc.x && patrolTarget.y === npc.y) || bfs.dist[patrolTarget.y * m.width + patrolTarget.x] < 0) {
    patrolTarget = pickPatrolTarget(m, npc.home, rng);
  }
  let next = firstStep(m, bfs, patrolTarget);
  if (next && world.occupied?.has(next.y * m.width + next.x)) {
    next = null;
    patrolTarget = null;
  }
  return {
    mode: 'patrol',
    next,
    facing: next ? dirBetween(npc, next) : null,
    stepMs: Math.round(chaseMs * NPC_PATROL_FACTOR),
    patrolTarget,
  };
}
