import {
  BIZ_BOOST_MS,
  BIZ_REFUND_MULTIPLIER,
  BIZ_SCAM_FRACTION,
  BOOST_MOVE_MS,
  CASH_PICKUP_MAX,
  CASH_PICKUP_MIN,
  CASH_PICKUP_PAIRS,
  ENCOUNTER_GRACE_MS,
  KILL_CINEMATIC_MS,
  KILL_HP_COST,
  KILL_POLICE_HP_COST,
  MAX_HP,
  MLA_FINE_FRACTION,
  MLA_SHORTCUT_WALLS,
  MOVE_MS,
  MP_BONUS_CASH,
  MP_FREEZE_MS,
  MP_REVEAL_MS,
  NEGOTIATION_STEPS,
  NPC_CHASE_STEP_MS,
  NPC_PATROL_FACTOR,
  NPC_SPAWN_CLEARANCE,
  OPPONENT_SIGHT_RANGE,
  OPPONENT_VISIBLE_RADIUS,
  POLICE_HP_REWARD,
  ROLES,
  ROLE_LABEL,
  SHOT_COOLDOWN_MS,
  SHOT_MAX_MS,
  SHOT_SPEED,
  START_CASH,
  WALK_AWAY_HP_COST,
  formatCash as cash,
} from '../shared/constants';
import {
  DIR_VEC,
  applyRelative,
  chebyshev,
  hasWall,
  lineOfSight,
  removeWall,
  shortestPath,
  type MazeData,
  type Point,
} from '../shared/maze';
import type {
  CashPickupView,
  Dir,
  EncounterResult,
  EncounterView,
  FxMsg,
  GameOverMsg,
  NotifyMsg,
  NpcAction,
  NpcMode,
  NpcStatus,
  PlayerStats,
  RelDir,
  Role,
  Slot,
  StateMsg,
  WinReason,
} from '../shared/protocol';
import { generateMaze } from './maze';
import { createNegotiation, makeOffer, quickOffers, rollPrice, type Negotiation } from './negotiation';
import { decide } from './npcAi';
import { introLine, replyLine, stepOneLine } from './npcText';
import { createRng, type Rng } from './rng';

export interface GameHooks {
  state(slot: Slot, s: StateMsg): void;
  fx(f: FxMsg): void;
  notify(slot: Slot, n: NotifyMsg): void;
  npcResult(slot: Slot, r: EncounterResult): void;
  mazeUpdate(cells: number[]): void;
  over(o: GameOverMsg): void;
}

export interface GameOptions {
  seed: number;
  names: [string, string];
  now?: () => number;
}

export interface Npc {
  id: number;
  role: Role;
  x: number;
  y: number;
  facing: Dir;
  home: Point;
  price: number;
  status: NpcStatus;
  mode: NpcMode;
  patrolTarget: Point | null;
  nextMoveAt: number;
  stepMs: number;
}

interface Encounter {
  npc: Npc;
  phase: 'choose' | 'negotiate';
  neg: Negotiation | null;
  flavor: string;
  rev: number;
}

interface Player {
  slot: Slot;
  name: string;
  x: number;
  y: number;
  facing: Dir;
  hp: number;
  cash: number;
  connected: boolean;
  moveUntil: number;
  buffered: RelDir | null;
  lastShot: number;
  frozenUntil: number;
  boostUntil: number;
  cinematicUntil: number;
  encounterGraceUntil: number;
  reveal: { path: Point[]; until: number } | null;
  killed: Record<Role, boolean>;
  npcs: Npc[];
  encounter: Encounter | null;
  stats: Omit<PlayerStats, 'cash' | 'hp'>;
}

interface Projectile {
  id: number;
  owner: Slot;
  x: number;
  y: number;
  dir: Dir;
  progress: number;
  passedEdge: boolean;
  born: number;
}

const other = (s: Slot): Slot => (s === 0 ? 1 : 0);

export class Game {
  readonly seed: number;
  readonly maze: MazeData;
  readonly players: [Player, Player];
  phase: 'countdown' | 'playing' | 'over' = 'countdown';
  pickups: CashPickupView[] = [];
  projectiles: Projectile[] = [];
  result: GameOverMsg | null = null;

  private readonly rng: Rng;
  private readonly now: () => number;
  private nextId = 1;
  private lastTick: number;
  private encounterRev = 1;

  constructor(opts: GameOptions, private readonly hooks: GameHooks) {
    this.seed = opts.seed >>> 0;
    this.now = opts.now ?? Date.now;
    this.rng = createRng(this.seed ^ 0x5bd1e995);
    this.maze = generateMaze(this.seed);
    this.players = [this.makePlayer(0, opts.names[0]), this.makePlayer(1, opts.names[1])];
    this.placeNpcs();
    this.placePickups();
    this.lastTick = this.now();
  }

  // ------------------------------------------------------------ setup

  private makePlayer(slot: Slot, name: string): Player {
    const start = this.maze.starts[slot];
    return {
      slot,
      name,
      x: start.x,
      y: start.y,
      facing: slot === 0 ? 'right' : 'left',
      hp: MAX_HP,
      cash: START_CASH,
      connected: true,
      moveUntil: 0,
      buffered: null,
      lastShot: -Infinity,
      frozenUntil: 0,
      boostUntil: 0,
      cinematicUntil: 0,
      encounterGraceUntil: 0,
      reveal: null,
      killed: { MP: false, BUSINESSMAN: false, MLA: false, POLICE: false },
      npcs: [],
      encounter: null,
      stats: { shotsFired: 0, shotsHit: 0, cashCollected: 0, bribed: 0, failedBribes: 0, killed: 0, walkedAway: 0 },
    };
  }

  /** True if an NPC may spawn here: away from both starts and the goal. */
  private spawnable(c: Point): boolean {
    const g = this.maze.goal;
    return this.maze.starts.every((s) => chebyshev(s, c) > NPC_SPAWN_CLEARANCE) && chebyshev(g, c) >= 2;
  }

  /**
   * One NPC of each role per player, spawned along that player's shortest route to the centre (more than
   * NPC_SPAWN_CLEARANCE cells from both starts), so they guard the likely route.
   */
  private placeNpcs(): void {
    const taken = new Set<string>();
    const key = (c: Point) => `${c.x},${c.y}`;
    for (const p of this.players) {
      const path = shortestPath(this.maze, this.maze.starts[p.slot], this.maze.goal)!;
      let eligible = path.filter((c) => this.spawnable(c) && !taken.has(key(c)));
      if (eligible.length < ROLES.length) {
        const all: Point[] = [];
        for (let y = 0; y < this.maze.height; y++) {
          for (let x = 0; x < this.maze.width; x++) if (this.spawnable({ x, y }) && !taken.has(`${x},${y}`)) all.push({ x, y });
        }
        eligible = [...eligible, ...this.rng.shuffle(all)];
      }
      const roles = this.rng.shuffle([...ROLES]);
      const fractions = [0.15, 0.4, 0.65, 0.9];
      roles.forEach((role, i) => {
        let idx = Math.min(eligible.length - 1, Math.floor(eligible.length * fractions[i]));
        while (taken.has(key(eligible[idx]))) idx = (idx + 1) % eligible.length;
        const cell = eligible[idx];
        taken.add(key(cell));
        p.npcs.push({
          id: this.nextId++,
          role,
          x: cell.x,
          y: cell.y,
          facing: 'down',
          home: { ...cell },
          price: rollPrice(role, this.rng),
          status: 'active',
          mode: 'patrol',
          patrolTarget: null,
          nextMoveAt: 0,
          stepMs: Math.round(NPC_CHASE_STEP_MS[role] * NPC_PATROL_FACTOR),
        });
      });
    }
  }

  /** Cash pickups in point-symmetric pairs so neither start is favoured. */
  private placePickups(): void {
    const { width: w, height: h } = this.maze;
    const blocked = new Set<string>([...this.maze.starts.map((s) => `${s.x},${s.y}`), `${this.maze.goal.x},${this.maze.goal.y}`]);
    let guard = 0;
    while (this.pickups.length < CASH_PICKUP_PAIRS * 2 && guard++ < 1000) {
      const x = this.rng.int(0, w - 1);
      const y = this.rng.int(0, h - 1);
      const mx = w - 1 - x;
      const my = h - 1 - y;
      if ((x === mx && y === my) || blocked.has(`${x},${y}`) || blocked.has(`${mx},${my}`)) continue;
      const value = this.rng.int(CASH_PICKUP_MIN, CASH_PICKUP_MAX);
      blocked.add(`${x},${y}`).add(`${mx},${my}`);
      this.pickups.push({ id: this.nextId++, x, y, value }, { id: this.nextId++, x: mx, y: my, value });
    }
  }

  // ------------------------------------------------------------ lifecycle

  start(): void {
    if (this.phase !== 'countdown') return;
    this.phase = 'playing';
    this.lastTick = this.now();
    for (const p of this.players) for (const n of p.npcs) n.nextMoveAt = this.lastTick + 1000;
    this.broadcastState();
  }

  tick(): void {
    const now = this.now();
    const dt = Math.min(200, now - this.lastTick);
    this.lastTick = now;
    if (this.phase === 'playing') {
      for (const p of this.players) {
        if (p.buffered && now >= p.moveUntil && this.canAct(p, now)) {
          const rel = p.buffered;
          p.buffered = null;
          this.doMove(p, applyRelative(p.facing, rel), now);
          if (this.phase !== 'playing') return;
        }
        if (p.reveal && now >= p.reveal.until) p.reveal = null;
      }
      this.advanceProjectiles(dt, now);
      if (this.phase === 'playing') this.advanceNpcs(now);
    }
    this.broadcastState();
  }

  setConnected(slot: Slot, connected: boolean): void {
    this.players[slot].connected = connected;
  }

  forfeit(loser: Slot): void {
    if (this.phase === 'over') return;
    this.end(other(loser), 'forfeit', `${this.players[loser].name} left the game`);
  }

  // ------------------------------------------------------------ inputs

  /** Relative command: the grid direction is resolved against the facing at the moment the move runs. */
  handleMove(slot: Slot, rel: RelDir): void {
    const p = this.players[slot];
    const now = this.now();
    if (this.phase !== 'playing' || !this.canAct(p, now)) return;
    if (now < p.moveUntil) {
      p.buffered ??= rel;
      return;
    }
    this.doMove(p, applyRelative(p.facing, rel), now);
  }

  handleShoot(slot: Slot): void {
    const p = this.players[slot];
    const now = this.now();
    if (this.phase !== 'playing' || !this.canAct(p, now)) return;
    if (now - p.lastShot < SHOT_COOLDOWN_MS) return;
    p.lastShot = now;
    p.stats.shotsFired++;
    const proj: Projectile = { id: this.nextId++, owner: slot, x: p.x, y: p.y, dir: p.facing, progress: 0, passedEdge: false, born: now };
    this.projectiles.push(proj);
    this.hooks.fx({ kind: 'shot', slot });
    if (this.checkHit(proj)) this.projectiles = this.projectiles.filter((q) => q !== proj);
    this.broadcastState();
  }

  handleNpcAction(slot: Slot, action: NpcAction): void {
    const p = this.players[slot];
    const enc = p.encounter;
    if (this.phase !== 'playing' || !enc || enc.phase !== 'choose') return;
    const role = enc.npc.role;

    if (action === 'negotiate') {
      enc.phase = 'negotiate';
      enc.neg = createNegotiation(role, enc.npc.price);
      enc.flavor = stepOneLine(role);
      enc.rev = this.encounterRev++;
    } else if (action === 'kill') {
      if (p.killed[role]) return;
      const cost = role === 'POLICE' ? KILL_POLICE_HP_COST : KILL_HP_COST;
      const now = this.now();
      p.killed[role] = true;
      p.stats.killed++;
      p.cinematicUntil = now + KILL_CINEMATIC_MS;
      p.buffered = null;
      this.hooks.fx({ kind: 'kill', slot, npcId: enc.npc.id });
      this.resolve(p, 'killed', `You gunned down the ${ROLE_LABEL[role]}. It cost you ${cost} HP.`);
      p.encounterGraceUntil = p.cinematicUntil + ENCOUNTER_GRACE_MS;
      if (role === 'POLICE') {
        this.hooks.notify(other(slot), { text: `${p.name} killed a Policeman!`, tone: 'warn' });
      }
      this.damage(p, cost, other(slot), 'died', `${p.name} died during a fight with a ${ROLE_LABEL[role]}`);
    } else if (action === 'walk') {
      if (role === 'POLICE') return;
      p.stats.walkedAway++;
      this.resolve(p, 'skipped', `You walked away from the ${ROLE_LABEL[role]} and lost ${WALK_AWAY_HP_COST} HP.`);
      this.damage(p, WALK_AWAY_HP_COST, other(slot), 'died', `${p.name} collapsed walking away from a ${ROLE_LABEL[role]}`);
    }
    this.broadcastState();
  }

  handleOffer(slot: Slot, rawAmount: number): void {
    const p = this.players[slot];
    const enc = p.encounter;
    if (this.phase !== 'playing' || !enc || enc.phase !== 'negotiate' || !enc.neg) return;
    if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount)) return;
    const amount = Math.max(0, Math.min(p.cash, Math.floor(rawAmount)));
    const role = enc.npc.role;
    const res = makeOffer(enc.neg, amount, this.rng);

    if (res.kind === 'counter') {
      enc.flavor = replyLine(role, res.reply, res.farTooLow, res.step === NEGOTIATION_STEPS);
      enc.rev = this.encounterRev++;
    } else if (res.kind === 'success') {
      p.cash -= res.paid;
      p.stats.bribed++;
      this.hooks.fx({ kind: 'bribe_ok', slot });
      this.resolve(p, 'bribed', this.applyReward(p, role, res.paid));
    } else {
      p.stats.failedBribes++;
      this.hooks.fx({ kind: 'bribe_fail', slot });
      const lead = res.farTooLow ? 'That offer was an insult. ' : '';
      this.resolve(p, 'failed', lead + this.applyPenalty(p, role));
      if (role === 'POLICE') this.end(other(slot), 'arrested', `${p.name} was arrested for attempted bribery`);
    }
    this.broadcastState();
  }

  // ------------------------------------------------------------ rules

  private canAct(p: Player, now: number): boolean {
    return !p.encounter && now >= p.frozenUntil && now >= p.cinematicUntil;
  }

  private canEncounter(p: Player, now: number): boolean {
    return this.phase === 'playing' && !p.encounter && now >= p.cinematicUntil && now >= p.encounterGraceUntil;
  }

  private moveMs(p: Player, now = this.now()): number {
    return now < p.boostUntil ? BOOST_MOVE_MS : MOVE_MS;
  }

  private doMove(p: Player, dir: Dir, now: number): void {
    p.facing = dir;
    if (hasWall(this.maze, p.x, p.y, dir)) {
      this.broadcastState();
      return;
    }
    p.x += DIR_VEC[dir].x;
    p.y += DIR_VEC[dir].y;
    p.moveUntil = now + this.moveMs(p, now);
    this.onEnterCell(p, now);
    if (this.phase === 'playing') {
      for (const proj of [...this.projectiles]) {
        if (this.checkHit(proj)) this.projectiles = this.projectiles.filter((q) => q !== proj);
        if (this.phase !== 'playing') return;
      }
    }
    this.broadcastState();
  }

  private onEnterCell(p: Player, now: number): void {
    const pickup = this.pickups.find((c) => c.x === p.x && c.y === p.y);
    if (pickup) {
      this.pickups = this.pickups.filter((c) => c !== pickup);
      p.cash += pickup.value;
      p.stats.cashCollected += pickup.value;
      this.hooks.fx({ kind: 'cash', slot: p.slot });
      this.hooks.notify(p.slot, { text: `+${cash(pickup.value)} cash`, tone: 'good' });
    }
    if (p.x === this.maze.goal.x && p.y === this.maze.goal.y) {
      this.end(p.slot, 'center', `${p.name} got there first`);
      return;
    }
    this.checkContact(p, now);
  }

  /** Opens an encounter if one of the player's active NPCs shares their cell. */
  private checkContact(p: Player, now: number): void {
    if (!this.canEncounter(p, now)) return;
    const npc = p.npcs.find((n) => n.status === 'active' && n.x === p.x && n.y === p.y);
    if (!npc) return;
    p.buffered = null;
    npc.mode = 'engaged';
    p.encounter = { npc, phase: 'choose', neg: null, flavor: introLine(npc.role), rev: this.encounterRev++ };
    this.hooks.fx({ kind: 'encounter', slot: p.slot });
  }

  private advanceNpcs(now: number): void {
    for (const p of this.players) {
      let playerPath: Point[] | null = null;
      const playerBusy = !this.canEncounter(p, now);
      for (const npc of p.npcs) {
        if (npc.status !== 'active' || p.encounter?.npc === npc || now < npc.nextMoveAt) continue;
        playerPath ??= shortestPath(this.maze, p, this.maze.goal) ?? [{ x: p.x, y: p.y }];
        const occupied = new Set(
          p.npcs.filter((n) => n !== npc && n.status === 'active').map((n) => n.y * this.maze.width + n.x),
        );
        const d = decide(
          npc,
          { maze: this.maze, player: p, playerPath, playerMoveMs: this.moveMs(p, now), playerBusy, occupied },
          this.rng,
        );
        npc.mode = d.mode;
        npc.patrolTarget = d.patrolTarget;
        npc.stepMs = d.stepMs;
        npc.nextMoveAt = now + d.stepMs;
        if (d.next) {
          npc.x = d.next.x;
          npc.y = d.next.y;
        }
        if (d.facing) npc.facing = d.facing;
      }
      this.checkContact(p, now);
    }
  }

  private advanceProjectiles(dt: number, now: number): void {
    const step = (SHOT_SPEED * dt) / 1000;
    const survivors: Projectile[] = [];
    for (const proj of this.projectiles) {
      if (this.phase !== 'playing') return;
      let alive = now - proj.born < SHOT_MAX_MS;
      proj.progress += step;
      while (alive) {
        if (proj.progress >= 0.5 && !proj.passedEdge) {
          if (hasWall(this.maze, proj.x, proj.y, proj.dir)) {
            alive = false;
            break;
          }
          proj.passedEdge = true;
        }
        if (proj.progress < 1) break;
        proj.x += DIR_VEC[proj.dir].x;
        proj.y += DIR_VEC[proj.dir].y;
        proj.progress -= 1;
        proj.passedEdge = false;
        if (this.checkHit(proj)) alive = false;
      }
      if (alive && this.checkHit(proj)) alive = false;
      if (alive) survivors.push(proj);
    }
    if (this.phase === 'playing') this.projectiles = survivors;
  }

  /** Applies damage if the projectile shares a cell with the opponent. Returns true when it hit. */
  private checkHit(proj: Projectile): boolean {
    const target = this.players[other(proj.owner)];
    if (target.x !== proj.x || target.y !== proj.y) return false;
    const shooter = this.players[proj.owner];
    shooter.stats.shotsHit++;
    this.hooks.fx({ kind: 'hit', slot: target.slot });
    this.damage(target, 1, shooter.slot, 'died', `${shooter.name} shot ${target.name} down`);
    return true;
  }

  private damage(p: Player, amount: number, winner: Slot, reason: WinReason, detail: string): void {
    p.hp = Math.max(0, p.hp - amount);
    if (p.hp === 0) this.end(winner, reason, detail);
  }

  private resolve(p: Player, outcome: EncounterResult['outcome'], text: string): void {
    const enc = p.encounter;
    if (!enc) return;
    enc.npc.status = outcome;
    enc.npc.mode = 'gone';
    p.encounter = null;
    p.encounterGraceUntil = this.now() + ENCOUNTER_GRACE_MS;
    this.hooks.npcResult(p.slot, { npcId: enc.npc.id, role: enc.npc.role, outcome, text });
  }

  private applyReward(p: Player, role: Role, paid: number): string {
    const now = this.now();
    switch (role) {
      case 'MP': {
        const path = shortestPath(this.maze, p, this.maze.goal) ?? [];
        p.reveal = { path, until: now + MP_REVEAL_MS };
        p.cash += MP_BONUS_CASH;
        return `The MP takes ${cash(paid)} and leaks the route: the shortest path is revealed for ${MP_REVEAL_MS / 1000}s, plus a ${cash(MP_BONUS_CASH)} bonus.`;
      }
      case 'BUSINESSMAN': {
        const refund = Math.round(paid * BIZ_REFUND_MULTIPLIER);
        p.boostUntil = now + BIZ_BOOST_MS;
        p.cash += refund;
        return `Deal! ${BIZ_BOOST_MS / 1000}s speed boost and ${cash(refund)} back on your ${cash(paid)} investment.`;
      }
      case 'MLA': {
        const removed = this.openShortcut(p);
        return `The MLA pockets ${cash(paid)} and bulldozes ${removed} walls towards the centre.`;
      }
      case 'POLICE': {
        const before = p.hp;
        p.hp = Math.min(MAX_HP, p.hp + POLICE_HP_REWARD);
        const healed = p.hp - before;
        return healed
          ? `The policeman waves you through for ${cash(paid)} and patches you up (+${healed} HP).`
          : `The policeman waves you through for ${cash(paid)}. You are already at full health.`;
      }
    }
  }

  private applyPenalty(p: Player, role: Role): string {
    const now = this.now();
    switch (role) {
      case 'MP':
        p.frozenUntil = now + MP_FREEZE_MS;
        p.buffered = null;
        return `The MP's goons hold you: frozen for ${MP_FREEZE_MS / 1000}s.`;
      case 'BUSINESSMAN': {
        const lost = Math.floor(p.cash * BIZ_SCAM_FRACTION);
        p.cash -= lost;
        return `Scammed! The businessman walks off with ${cash(lost)} of your cash.`;
      }
      case 'MLA': {
        const lost = Math.floor(p.cash * MLA_FINE_FRACTION);
        p.cash -= lost;
        return `The MLA fines you ${cash(lost)} for "wasting government time".`;
      }
      case 'POLICE':
        return 'Bribing an officer? You are under arrest!';
    }
  }

  /**
   * Removes 3-4 walls along a straight-ish line from the player to the goal, nearest first.
   * Every cell on the line contributes its walls that face the goal. Returns how many were removed.
   */
  private openShortcut(p: Player): number {
    const target = this.rng.int(MLA_SHORTCUT_WALLS[0], MLA_SHORTCUT_WALLS[1]);
    const g = this.maze.goal;
    const towardGoal = (x: number, y: number): Dir[] => {
      const dx = g.x - x;
      const dy = g.y - y;
      const horiz: Dir | null = dx > 0 ? 'right' : dx < 0 ? 'left' : null;
      const vert: Dir | null = dy > 0 ? 'down' : dy < 0 ? 'up' : null;
      return (Math.abs(dx) >= Math.abs(dy) ? [horiz, vert] : [vert, horiz]).filter((d): d is Dir => d !== null);
    };
    const line: Point[] = [{ x: p.x, y: p.y }];
    while (line[line.length - 1].x !== g.x || line[line.length - 1].y !== g.y) {
      const cur = line[line.length - 1];
      const d = towardGoal(cur.x, cur.y)[0];
      line.push({ x: cur.x + DIR_VEC[d].x, y: cur.y + DIR_VEC[d].y });
    }
    const all: Dir[] = ['up', 'right', 'down', 'left'];
    const candidates: { x: number; y: number; d: Dir }[] = [];
    const add = (c: Point, dirs: Dir[]) => {
      for (const d of dirs) if (hasWall(this.maze, c.x, c.y, d)) candidates.push({ x: c.x, y: c.y, d });
    };
    // Preference order: goal-facing walls on the line, then any wall on the line, then goal-facing walls beside it.
    for (const c of line) add(c, c.x === g.x && c.y === g.y ? all : towardGoal(c.x, c.y));
    for (const c of line) add(c, all);
    for (const c of line) {
      for (const d of all) {
        const n = { x: c.x + DIR_VEC[d].x, y: c.y + DIR_VEC[d].y };
        if (n.x >= 0 && n.y >= 0 && n.x < this.maze.width && n.y < this.maze.height) add(n, towardGoal(n.x, n.y));
      }
    }
    let removed = 0;
    for (const c of candidates) {
      if (removed >= target) break;
      if (removeWall(this.maze, c.x, c.y, c.d)) removed++;
    }
    if (removed) this.hooks.mazeUpdate([...this.maze.cells]);
    return removed;
  }

  private end(winner: Slot, reason: WinReason, detail: string): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.projectiles = [];
    for (const p of this.players) {
      p.encounter = null;
      p.buffered = null;
    }
    this.result = {
      winner,
      reason,
      detail,
      names: [this.players[0].name, this.players[1].name],
      stats: [this.statsOf(this.players[0]), this.statsOf(this.players[1])],
      seed: this.seed,
    };
    this.broadcastState();
    this.hooks.over(this.result);
  }

  private statsOf(p: Player): PlayerStats {
    return { cash: p.cash, hp: p.hp, ...p.stats };
  }

  // ------------------------------------------------------------ views

  broadcastState(): void {
    this.hooks.state(0, this.viewFor(0));
    this.hooks.state(1, this.viewFor(1));
  }

  viewFor(slot: Slot): StateMsg {
    const now = this.now();
    const me = this.players[slot];
    const opp = this.players[other(slot)];
    const near = chebyshev(me, opp) <= OPPONENT_VISIBLE_RADIUS;
    const visible = near || lineOfSight(this.maze, me, opp, OPPONENT_SIGHT_RANGE);
    return {
      t: now,
      phase: this.phase,
      me: {
        x: me.x,
        y: me.y,
        facing: me.facing,
        hp: me.hp,
        cash: me.cash,
        moveMs: this.moveMs(me, now),
        frozenMs: Math.max(0, me.frozenUntil - now),
        boostMs: Math.max(0, me.boostUntil - now),
        cinematicMs: Math.max(0, me.cinematicUntil - now),
        shotCooldownMs: Math.max(0, SHOT_COOLDOWN_MS - (now - me.lastShot)),
        killed: { ...me.killed },
      },
      opp: {
        name: opp.name,
        hp: opp.hp,
        connected: opp.connected,
        visible,
        near,
        moveMs: this.moveMs(opp, now),
        ...(visible ? { x: opp.x, y: opp.y, facing: opp.facing } : {}),
      },
      projectiles: this.projectiles.map(({ id, owner, x, y, dir, progress }) => ({ id, owner, x, y, dir, progress })),
      pickups: this.pickups.map((c) => ({ ...c })),
      npcs: me.npcs.map(({ id, role, x, y, facing, status, mode, stepMs }) => ({ id, role, x, y, facing, status, mode, moveMs: stepMs })),
      reveal: me.reveal ? { path: me.reveal.path, ms: Math.max(0, me.reveal.until - now) } : null,
      encounter: me.encounter ? this.encounterView(me) : null,
    };
  }

  private encounterView(p: Player): EncounterView {
    const enc = p.encounter!;
    const role = enc.npc.role;
    return {
      rev: enc.rev,
      npcId: enc.npc.id,
      role,
      phase: enc.phase,
      step: enc.neg?.step ?? 1,
      maxSteps: NEGOTIATION_STEPS,
      flavor: enc.flavor,
      reply: enc.neg?.lastReply ?? null,
      farTooLow: enc.neg?.lastFarTooLow ?? false,
      canWalk: role !== 'POLICE',
      canKill: !p.killed[role],
      killCost: role === 'POLICE' ? KILL_POLICE_HP_COST : KILL_HP_COST,
      walkCost: WALK_AWAY_HP_COST,
      cash: p.cash,
      quick: quickOffers(p.cash),
    };
  }
}