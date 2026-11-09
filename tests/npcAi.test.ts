import { describe, expect, it } from 'vitest';
import { NPC_CHASE_RADIUS, NPC_CHASE_STEP_MS, NPC_PATROL_FACTOR, NPC_PATROL_RADIUS } from '../shared/constants';
import { bfsDistances, openNeighbours, shortestPath, type Point } from '../shared/maze';
import { generateMaze } from '../server/maze';
import { NPC_HOLD_DISTANCE, bfsAvoidingGoal, decide, type AiNpc } from '../server/npcAi';
import { createRng } from '../server/rng';

const maze = generateMaze(77);
const idx = (p: Point) => p.y * maze.width + p.x;

function npcAt(p: Point, role: AiNpc['role'] = 'MP'): AiNpc {
  return { role, x: p.x, y: p.y, home: { ...p }, mode: 'patrol', patrolTarget: null };
}

/** A player standing still (their "route" is just their own cell). */
function world(player: Point) {
  return { maze, player, playerPath: [player], playerMoveMs: 150 };
}

describe('NPC AI', () => {
  it('chases a player within range and every chase step gets closer', () => {
    const rng = createRng(1);
    const player = { x: 0, y: 0 };
    const path = shortestPath(maze, player, { x: 20, y: 0 })!;
    const npc = npcAt(path[Math.min(NPC_CHASE_RADIUS, path.length - 1)], 'POLICE');
    for (let i = 0; i < 20 && (npc.x !== player.x || npc.y !== player.y); i++) {
      const before = bfsAvoidingGoal(maze, npc).dist[idx(player)];
      const d = decide(npc, world(player), rng);
      expect(d.mode).toBe('chase');
      expect(d.stepMs).toBe(NPC_CHASE_STEP_MS.POLICE);
      Object.assign(npc, d.next, { mode: d.mode });
      expect(bfsAvoidingGoal(maze, npc).dist[idx(player)]).toBe(before - 1);
    }
    expect(npc).toMatchObject(player);
  });

  it('patrols slowly near home when the player is far away', () => {
    const rng = createRng(2);
    const home = { x: 20, y: 0 };
    const npc = npcAt(home, 'BUSINESSMAN');
    const homeDist = bfsDistances(maze, home);
    for (let i = 0; i < 200; i++) {
      const d = decide(npc, world({ x: 0, y: 20 }), rng);
      expect(d.mode).toBe('patrol');
      expect(d.stepMs).toBe(Math.round(NPC_CHASE_STEP_MS.BUSINESSMAN * NPC_PATROL_FACTOR));
      if (d.next) {
        expect(openNeighbours(maze, npc.x, npc.y)).toContainEqual(d.next);
        Object.assign(npc, d.next);
      }
      npc.patrolTarget = d.patrolTarget;
      expect(homeDist[idx(npc)]).toBeLessThanOrEqual(NPC_PATROL_RADIUS * 3);
    }
  });

  it('holds back while the player is busy and never steps onto another NPC', () => {
    const rng = createRng(4);
    const player = { x: 0, y: 0 };
    const path = shortestPath(maze, player, { x: 20, y: 0 })!;
    const npc = npcAt(path[NPC_HOLD_DISTANCE], 'POLICE');
    const busy = decide(npc, { ...world(player), playerBusy: true }, rng);
    expect(busy).toMatchObject({ mode: 'chase', next: null });
    const free = decide(npc, world(player), rng);
    expect(free.next).toEqual(path[NPC_HOLD_DISTANCE - 1]);
    const blocked = decide(npc, { ...world(player), occupied: new Set([idx(path[NPC_HOLD_DISTANCE - 1])]) }, rng);
    expect(blocked.next).toBeNull();
  });

  it('BFS for NPCs never passes through the goal', () => {
    const bfs = bfsAvoidingGoal(maze, { x: 0, y: 0 });
    expect(bfs.dist[idx(maze.goal)]).toBe(-1);
  });

  it('reaches a moving player who walks their route towards the centre', () => {
    const rng = createRng(3);
    const route = shortestPath(maze, { x: 0, y: 0 }, maze.goal)!;
    const npc = npcAt(route[8], 'POLICE');
    let k = 0;
    let caught = false;
    // Player moves every 150ms but hesitates (only 1 in 3 ticks); NPC steps every 600ms.
    for (let t = 0; t < 12_000 && k < route.length - 1; t += 150) {
      if (t % 450 === 0) k++;
      const player = route[k];
      if (npc.x === player.x && npc.y === player.y) {
        caught = true;
        break;
      }
      if (t % 600 === 0) {
        const d = decide(npc, { maze, player, playerPath: route.slice(k), playerMoveMs: 450 }, rng);
        if (d.next) Object.assign(npc, d.next, { mode: d.mode });
      }
    }
    expect(caught).toBe(true);
  });
});
