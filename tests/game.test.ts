import { describe, expect, it } from 'vitest';
import {
  BIZ_BOOST_MS,
  BOOST_MOVE_MS,
  ENCOUNTER_GRACE_MS,
  KILL_CINEMATIC_MS,
  MAX_HP,
  MOVE_MS,
  MP_FREEZE_MS,
  SHOT_COOLDOWN_MS,
  START_CASH,
} from '../shared/constants';
import { DIRS, DIR_VEC, OPPOSITE, applyRelative, hasWall, openNeighbours, relativeFor, type Point } from '../shared/maze';
import type { Dir, EncounterResult, GameOverMsg, NotifyMsg, Role, Slot } from '../shared/protocol';
import { Game } from '../server/game';

function setup(seed = 7) {
  let t = 10_000;
  const over: GameOverMsg[] = [];
  const results: [Slot, EncounterResult][] = [];
  const notes: [Slot, NotifyMsg][] = [];
  let mazeUpdates = 0;
  const g = new Game(
    { seed, names: ['Alice', 'Bob'], now: () => t },
    {
      state: () => {},
      fx: () => {},
      notify: (s, n) => notes.push([s, n]),
      npcResult: (s, r) => results.push([s, r]),
      mazeUpdate: () => mazeUpdates++,
      over: (o) => over.push(o),
    },
  );
  g.start();
  return {
    g,
    over,
    results,
    notes,
    mazeUpdates: () => mazeUpdates,
    advance: (ms: number) => {
      t += ms;
    },
    tick: (ms = 50) => {
      t += ms;
      g.tick();
    },
  };
}

/** Finds an open corridor of `len` cells running in `dir`, away from goal/NPCs/cash. */
function corridor(g: Game, len: number, dir: Dir = 'right'): Point[] {
  const avoid = new Set([
    `${g.maze.goal.x},${g.maze.goal.y}`,
    ...g.players.flatMap((p) => p.npcs.map((n) => `${n.x},${n.y}`)),
    ...g.pickups.map((c) => `${c.x},${c.y}`),
  ]);
  for (let y = 0; y < g.maze.height; y++) {
    for (let x = 0; x < g.maze.width; x++) {
      const cells: Point[] = [{ x, y }];
      while (cells.length < len) {
        const last = cells[cells.length - 1];
        if (hasWall(g.maze, last.x, last.y, dir)) break;
        cells.push({ x: last.x + DIR_VEC[dir].x, y: last.y + DIR_VEC[dir].y });
      }
      if (cells.length === len && cells.every((c) => !avoid.has(`${c.x},${c.y}`))) return cells;
    }
  }
  throw new Error('no corridor');
}

function place(g: Game, slot: Slot, p: Point, facing: Dir) {
  Object.assign(g.players[slot], { x: p.x, y: p.y, facing });
}

/** Moves the player onto their NPC of `role`, opening the encounter. */
function meetNpc(g: Game, slot: Slot, role: Role) {
  const npc = g.players[slot].npcs.find((n) => n.role === role)!;
  const from = openNeighbours(g.maze, npc.x, npc.y).find((c) => !(c.x === g.maze.goal.x && c.y === g.maze.goal.y))!;
  const dir = DIRS.find((d) => from.x + DIR_VEC[d].x === npc.x && from.y + DIR_VEC[d].y === npc.y)!;
  place(g, slot, from, OPPOSITE[dir]);
  go(g, slot, dir);
  expect(g.players[slot].encounter?.npc.id).toBe(npc.id);
  return npc;
}

/** Sends the relative command that moves the player in the absolute direction `dir`. */
function go(g: Game, slot: Slot, dir: Dir) {
  g.handleMove(slot, relativeFor(g.players[slot].facing, dir));
}

describe('relative directions', () => {
  it('maps commands against the facing', () => {
    expect(applyRelative('up', 'forward')).toBe('up');
    expect(applyRelative('up', 'left')).toBe('left');
    expect(applyRelative('up', 'right')).toBe('right');
    expect(applyRelative('up', 'back')).toBe('down');
    expect(applyRelative('right', 'left')).toBe('up');
    expect(applyRelative('left', 'right')).toBe('up');
    expect(applyRelative('down', 'left')).toBe('right');
    for (const f of DIRS) for (const d of DIRS) expect(applyRelative(f, relativeFor(f, d))).toBe(d);
  });
});

describe('movement', () => {
  it('forward steps one cell; left/right/back turn then step; buffered input resolves against the new facing', () => {
    const { g, tick } = setup();
    const [a, b] = corridor(g, 2);
    place(g, 0, a, 'up');
    g.handleMove(0, 'right');
    expect(g.players[0]).toMatchObject({ x: b.x, y: b.y, facing: 'right' });
    // While the step animates, one more command is buffered (the second is dropped).
    g.handleMove(0, 'back');
    g.handleMove(0, 'left');
    expect(g.players[0]).toMatchObject({ x: b.x, y: b.y });
    tick(150);
    expect(g.players[0]).toMatchObject({ x: a.x, y: a.y, facing: 'left' });
    tick(150);
    expect(g.players[0]).toMatchObject({ x: a.x, y: a.y });
  });

  it('a command into a wall only turns', () => {
    const { g } = setup();
    const [a] = corridor(g, 2);
    const wallDir = DIRS.find((d) => hasWall(g.maze, a.x, a.y, d))!;
    place(g, 0, a, OPPOSITE[wallDir]);
    g.handleMove(0, 'back');
    expect(g.players[0]).toMatchObject({ x: a.x, y: a.y, facing: wallDir });
  });

  it('forward into an open corridor keeps going one cell per command', () => {
    const { g, tick } = setup();
    const cells = corridor(g, 4);
    place(g, 0, cells[0], 'right');
    for (let i = 1; i < 4; i++) {
      g.handleMove(0, 'forward');
      expect(g.players[0]).toMatchObject(cells[i]);
      tick(MOVE_MS);
    }
  });
});

describe('combat', () => {
  it('a shot travels along the corridor and costs the target 1 HP', () => {
    const { g, tick } = setup();
    const cells = corridor(g, 4);
    place(g, 0, cells[0], 'right');
    place(g, 1, cells[3], 'left');
    g.handleShoot(0);
    expect(g.projectiles).toHaveLength(1);
    for (let i = 0; i < 6; i++) tick();
    expect(g.players[1].hp).toBe(MAX_HP - 1);
    expect(g.projectiles).toHaveLength(0);
    expect(g.players[0].stats).toMatchObject({ shotsFired: 1, shotsHit: 1 });
  });

  it('projectiles stop at walls', () => {
    const { g, tick } = setup();
    const [a] = corridor(g, 1);
    const wallDir = DIRS.find((d) => hasWall(g.maze, a.x, a.y, d))!;
    place(g, 0, a, wallDir);
    g.handleShoot(0);
    tick();
    expect(g.projectiles).toHaveLength(0);
  });

  it('enforces the 400ms cooldown', () => {
    const { g, advance } = setup();
    const [a] = corridor(g, 2);
    place(g, 0, a, 'right');
    g.handleShoot(0);
    advance(SHOT_COOLDOWN_MS - 50);
    g.handleShoot(0);
    expect(g.players[0].stats.shotsFired).toBe(1);
    advance(60);
    g.handleShoot(0);
    expect(g.players[0].stats.shotsFired).toBe(2);
  });

  it('players can share a cell, and a shot there hits immediately', () => {
    const { g } = setup();
    const [a] = corridor(g, 1);
    place(g, 0, a, 'right');
    place(g, 1, a, 'left');
    g.handleShoot(1);
    expect(g.players[0].hp).toBe(MAX_HP - 1);
  });

  it('0 HP ends the game: the shooter wins', () => {
    const { g, over } = setup();
    const [a] = corridor(g, 1);
    place(g, 0, a, 'right');
    place(g, 1, a, 'left');
    g.players[0].hp = 1;
    g.handleShoot(1);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ winner: 1, reason: 'died' });
  });
});

describe('NPC encounters', () => {
  it('each player gets exactly one NPC of each role', () => {
    const { g } = setup();
    for (const p of g.players) expect(p.npcs.map((n) => n.role).sort()).toEqual(['BUSINESSMAN', 'MLA', 'MP', 'POLICE']);
  });

  it('stepping on an NPC pauses movement until resolved; walking away costs 1 HP', () => {
    const { g, tick, results } = setup();
    const npc = meetNpc(g, 0, 'MLA');
    tick(200);
    const before = { x: g.players[0].x, y: g.players[0].y };
    g.handleMove(0, 'forward');
    g.handleMove(0, 'back');
    expect(g.players[0]).toMatchObject(before);
    g.handleNpcAction(0, 'walk');
    expect(g.players[0].hp).toBe(MAX_HP - 1);
    expect(npc.status).toBe('skipped');
    expect(results.at(-1)?.[1].outcome).toBe('skipped');
  });

  it('cannot walk away from the police; killing a cop costs 3 HP and notifies the opponent', () => {
    const { g, notes } = setup();
    meetNpc(g, 0, 'POLICE');
    g.handleNpcAction(0, 'walk');
    expect(g.players[0].encounter).not.toBeNull();
    g.handleNpcAction(0, 'kill');
    expect(g.players[0].hp).toBe(MAX_HP - 3);
    expect(g.players[0].killed.POLICE).toBe(true);
    expect(notes.some(([slot, n]) => slot === 1 && /Policeman/.test(n.text))).toBe(true);
  });

  it('killing a non-police NPC costs 2 HP with no reward', () => {
    const { g } = setup();
    meetNpc(g, 0, 'BUSINESSMAN');
    g.handleNpcAction(0, 'kill');
    expect(g.players[0]).toMatchObject({ hp: MAX_HP - 2, cash: START_CASH });
    expect(g.players[0].killed.BUSINESSMAN).toBe(true);
  });

  it('failed police bribe = arrested, opponent wins instantly', () => {
    const { g, over } = setup();
    meetNpc(g, 0, 'POLICE');
    g.handleNpcAction(0, 'negotiate');
    g.handleOffer(0, 0);
    g.handleOffer(0, 0);
    expect(over[0]).toMatchObject({ winner: 1, reason: 'arrested' });
  });

  it('successful police bribe deducts the offer and heals +1 HP', () => {
    const { g } = setup();
    g.players[0].hp = 5;
    const npc = meetNpc(g, 0, 'POLICE');
    g.handleNpcAction(0, 'negotiate');
    const offer = Math.ceil(npc.price * 1.1);
    g.handleOffer(0, offer);
    expect(g.players[0]).toMatchObject({ hp: 6, cash: START_CASH - offer, encounter: null });
    expect(npc.status).toBe('bribed');
  });

  it('MP success reveals the path and adds 50 cash; MP failure freezes for 5s', () => {
    const a = setup();
    const npc = meetNpc(a.g, 0, 'MP');
    a.g.handleNpcAction(0, 'negotiate');
    const offer = Math.ceil(npc.price * 1.1);
    a.g.handleOffer(0, offer);
    const p = a.g.players[0];
    expect(p.cash).toBe(START_CASH - offer + 50);
    expect(p.reveal?.path.at(-1)).toEqual(a.g.maze.goal);
    expect(a.g.viewFor(0).reveal?.ms).toBe(12_000);

    const b = setup();
    meetNpc(b.g, 0, 'MP');
    b.g.handleNpcAction(0, 'negotiate');
    b.g.handleOffer(0, 0);
    b.g.handleOffer(0, 0);
    const q = b.g.players[0];
    expect(b.g.viewFor(0).me.frozenMs).toBe(MP_FREEZE_MS);
    const pos = { x: q.x, y: q.y };
    for (const d of DIRS) go(b.g, 0, d);
    expect(q).toMatchObject(pos);
  });

  it('Businessman success gives a 2x speed boost and 1.5x cash back; failure scams 30%', () => {
    const a = setup();
    const npc = meetNpc(a.g, 0, 'BUSINESSMAN');
    a.g.handleNpcAction(0, 'negotiate');
    const offer = Math.ceil(npc.price * 1.1);
    a.g.handleOffer(0, offer);
    expect(a.g.players[0].cash).toBe(START_CASH - offer + Math.round(offer * 1.5));
    expect(a.g.viewFor(0).me).toMatchObject({ boostMs: BIZ_BOOST_MS, moveMs: BOOST_MOVE_MS });

    const b = setup();
    meetNpc(b.g, 0, 'BUSINESSMAN');
    b.g.handleNpcAction(0, 'negotiate');
    b.g.handleOffer(0, 0);
    b.g.handleOffer(0, 0);
    expect(b.g.players[0].cash).toBe(START_CASH - Math.floor(START_CASH * 0.3));
  });

  it('MLA success removes 3-4 walls towards the centre; failure fines 25%', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const slot of [0, 1] as const) {
        const a = setup(seed);
        const npc = meetNpc(a.g, slot, 'MLA');
        const before = [...a.g.maze.cells];
        a.g.handleNpcAction(slot, 'negotiate');
        a.g.handleOffer(slot, Math.ceil(npc.price * 1.1));
        let removedEdges = 0;
        before.forEach((c, i) => (removedEdges += popcount(c & ~a.g.maze.cells[i])));
        expect(removedEdges / 2).toBeGreaterThanOrEqual(3);
        expect(removedEdges / 2).toBeLessThanOrEqual(4);
        expect(a.mazeUpdates()).toBe(1);
      }
    }

    const b = setup();
    meetNpc(b.g, 0, 'MLA');
    b.g.handleNpcAction(0, 'negotiate');
    b.g.handleOffer(0, 0);
    b.g.handleOffer(0, 0);
    expect(b.g.players[0].cash).toBe(START_CASH - 25);
  });

  it('failed non-police bribes keep the offered cash', () => {
    const { g } = setup();
    const npc = meetNpc(g, 0, 'MLA');
    g.handleNpcAction(0, 'negotiate');
    const low = Math.floor(npc.price * 0.8);
    g.handleOffer(0, low);
    g.handleOffer(0, low);
    g.handleOffer(0, low);
    expect(npc.status).toBe('failed');
    expect(g.players[0].cash).toBe(START_CASH - Math.floor(START_CASH * 0.25));
  });

  it('NPCs are private: views only include your own NPCs', () => {
    const { g } = setup();
    const mine = g.viewFor(0).npcs.map((n) => n.id);
    const theirs = g.viewFor(1).npcs.map((n) => n.id);
    expect(mine).toHaveLength(4);
    expect(mine.filter((id) => theirs.includes(id))).toHaveLength(0);
  });
});

describe('win conditions and visibility', () => {
  it('reaching the centre wins', () => {
    const { g, over } = setup();
    const goal = g.maze.goal;
    const from = openNeighbours(g.maze, goal.x, goal.y)[0];
    const dir = DIRS.find((d) => from.x + DIR_VEC[d].x === goal.x && from.y + DIR_VEC[d].y === goal.y)!;
    place(g, 1, from, dir);
    go(g, 1, dir);
    expect(over[0]).toMatchObject({ winner: 1, reason: 'center' });
    expect(over[0].stats).toHaveLength(2);
  });

  it('forfeit gives the win to the other player', () => {
    const { g, over } = setup();
    g.forfeit(0);
    expect(over[0]).toMatchObject({ winner: 1, reason: 'forfeit' });
  });

  it('the opponent position is only sent within 5 cells or in a clear line of sight', () => {
    const { g } = setup();
    expect(g.viewFor(0).opp.visible).toBe(false);
    expect(g.viewFor(0).opp.x).toBeUndefined();
    place(g, 1, { x: 5, y: 3 }, 'up');
    place(g, 0, { x: 0, y: 0 }, 'up');
    expect(g.viewFor(0).opp).toMatchObject({ visible: true, near: true, x: 5, y: 3 });
    place(g, 1, { x: 6, y: 1 }, 'up');
    expect(g.viewFor(0).opp).toMatchObject({ visible: false, near: false });

    let cells: Point[];
    try {
      cells = corridor(g, 7, 'right');
    } catch {
      cells = corridor(g, 7, 'down');
    }
    place(g, 0, cells[0], 'up');
    place(g, 1, cells[6], 'up');
    expect(g.viewFor(0).opp).toMatchObject({ visible: true, near: false, x: cells[6].x, y: cells[6].y });
  });

  it('the result carries the game seed', () => {
    const { g, over } = setup(424242);
    g.forfeit(1);
    expect(over[0].seed).toBe(424242);
    expect(g.seed).toBe(424242);
  });
});

describe('moving NPCs', () => {
  it('spawn more than 6 cells from both starts, never on the goal', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { g } = setup(seed);
      for (const p of g.players) {
        for (const n of p.npcs) {
          for (const s of g.maze.starts) expect(Math.max(Math.abs(n.x - s.x), Math.abs(n.y - s.y))).toBeGreaterThan(6);
          expect(n.x === g.maze.goal.x && n.y === g.maze.goal.y).toBe(false);
        }
      }
    }
  });

  it('only ever step between open neighbouring cells and never enter the goal', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { g, tick } = setup(seed);
      const last = new Map(g.players.flatMap((p) => p.npcs.map((n) => [n.id, { x: n.x, y: n.y }] as const)));
      for (let i = 0; i < 400 && g.phase === 'playing'; i++) {
        // Keep the players wandering so NPCs alternate between patrol and chase.
        if (i % 3 === 0) for (const slot of [0, 1] as const) g.handleMove(slot, (['forward', 'left', 'right', 'forward'] as const)[i % 4]);
        for (const slot of [0, 1] as const) {
          if (g.players[slot].encounter) g.handleNpcAction(slot, g.players[slot].encounter!.npc.role === 'POLICE' ? 'kill' : 'walk');
        }
        tick(50);
        for (const p of g.players) {
          for (const n of p.npcs) {
            const prev = last.get(n.id)!;
            const dist = Math.abs(prev.x - n.x) + Math.abs(prev.y - n.y);
            expect(dist).toBeLessThanOrEqual(1);
            if (dist === 1) {
              const open = openNeighbours(g.maze, prev.x, prev.y).some((c) => c.x === n.x && c.y === n.y);
              expect(open).toBe(true);
            }
            expect(n.x === g.maze.goal.x && n.y === g.maze.goal.y).toBe(false);
            last.set(n.id, { x: n.x, y: n.y });
          }
        }
      }
    }
  });

  it('chase a nearby player and open the encounter on contact', () => {
    const { g, tick } = setup();
    const p = g.players[0];
    const npc = p.npcs.find((n) => n.role === 'POLICE')!;
    // Put the player 3 steps away along an open path.
    let cell: Point = { x: npc.x, y: npc.y };
    const seen = new Set([`${cell.x},${cell.y}`]);
    for (let i = 0; i < 3; i++) {
      const next = openNeighbours(g.maze, cell.x, cell.y).find(
        (c) => !seen.has(`${c.x},${c.y}`) && !(c.x === g.maze.goal.x && c.y === g.maze.goal.y),
      );
      if (!next) break;
      seen.add(`${next.x},${next.y}`);
      cell = next;
    }
    place(g, 0, cell, 'up');
    for (let i = 0; i < 100 && !p.encounter; i++) tick(50);
    expect(p.encounter?.npc.id).toBe(npc.id);
    expect(npc).toMatchObject({ x: p.x, y: p.y, mode: 'engaged' });
    // Encounter locks movement.
    const pos = { x: p.x, y: p.y };
    for (const d of DIRS) go(g, 0, d);
    expect(p).toMatchObject(pos);
  });

  it('resolved NPCs stop moving; a new encounter waits for the grace period', () => {
    const { g, tick } = setup();
    const npc = meetNpc(g, 0, 'MLA');
    g.handleNpcAction(0, 'walk');
    const at = { x: npc.x, y: npc.y };
    for (let i = 0; i < 40; i++) tick(50);
    expect(npc).toMatchObject({ ...at, status: 'skipped', mode: 'gone' });

    const other = g.players[0].npcs.find((n) => n.role === 'MP')!;
    Object.assign(other, { x: g.players[0].x, y: g.players[0].y, nextMoveAt: Infinity });
    const p = g.players[0];
    p.encounterGraceUntil = Infinity;
    tick(50);
    expect(p.encounter).toBeNull();
    p.encounterGraceUntil = 0;
    tick(50);
    expect(p.encounter?.npc.id).toBe(other.id);
  });

  it('killing an NPC locks input for the cinematic', () => {
    const { g, tick } = setup();
    meetNpc(g, 0, 'BUSINESSMAN');
    g.handleNpcAction(0, 'kill');
    const p = g.players[0];
    expect(g.viewFor(0).me.cinematicMs).toBe(KILL_CINEMATIC_MS);
    const pos = { x: p.x, y: p.y };
    for (const d of DIRS) go(g, 0, d);
    g.handleShoot(0);
    expect(p).toMatchObject(pos);
    expect(p.stats.shotsFired).toBe(0);
    tick(KILL_CINEMATIC_MS + 10);
    expect(g.viewFor(0).me.cinematicMs).toBe(0);
    expect(p.encounterGraceUntil).toBeGreaterThan(10_000 + KILL_CINEMATIC_MS);
    expect(ENCOUNTER_GRACE_MS).toBeGreaterThan(0);
  });
});

function popcount(n: number): number {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
}
