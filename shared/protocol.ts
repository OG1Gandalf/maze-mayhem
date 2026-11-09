/**
 * Socket.IO message protocol shared by client and server.
 * The server is authoritative: clients only ever send intents (inputs, choices, offers).
 */
import type { MazeData, Point } from './maze';

/** Absolute grid direction. */
export type Dir = 'up' | 'down' | 'left' | 'right';
/** Character-relative command: forward, turn-and-step left/right, turn around and step. */
export type RelDir = 'forward' | 'back' | 'left' | 'right';
export type Slot = 0 | 1;
export type Role = 'MP' | 'BUSINESSMAN' | 'MLA' | 'POLICE';
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'over';
export type WinReason = 'center' | 'died' | 'arrested' | 'forfeit';
export type NpcStatus = 'active' | 'bribed' | 'failed' | 'killed' | 'skipped';
export type NpcMode = 'patrol' | 'chase' | 'engaged' | 'gone';
export type NpcAction = 'negotiate' | 'kill' | 'walk';
export type NpcReply = 'accept' | 'not_enough' | 'too_much_to_ask';

// ---------------------------------------------------------------- lobby

export interface LobbyPlayer {
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface LobbyState {
  code: string;
  you: Slot;
  phase: RoomPhase;
  players: [LobbyPlayer | null, LobbyPlayer | null];
  rematch: [boolean, boolean];
}

export type JoinResult =
  | { ok: true; code: string; slot: Slot; token: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------- game

export interface GameInit {
  maze: MazeData;
  you: Slot;
  names: [string, string];
  /** Game seed (maze, NPCs, pickups, prices). Fresh and crypto-random for every game. */
  seed: number;
}

export interface SelfView {
  x: number;
  y: number;
  facing: Dir;
  hp: number;
  cash: number;
  moveMs: number;
  frozenMs: number;
  boostMs: number;
  /** Remaining input lock while the kill cinematic plays. */
  cinematicMs: number;
  shotCooldownMs: number;
  killed: Record<Role, boolean>;
}

export interface OpponentView {
  name: string;
  hp: number;
  connected: boolean;
  /** Rendered in 3D: nearby or in a straight unobstructed line of sight. Position only sent when true. */
  visible: boolean;
  /** Within OPPONENT_VISIBLE_RADIUS cells: also shown on the minimap. */
  near: boolean;
  x?: number;
  y?: number;
  facing?: Dir;
  moveMs: number;
}

export interface ProjectileView {
  id: number;
  owner: Slot;
  /** Cell the projectile is currently in. */
  x: number;
  y: number;
  dir: Dir;
  /** 0..1 distance travelled from the cell centre towards the next cell. */
  progress: number;
}

export interface CashPickupView {
  id: number;
  x: number;
  y: number;
  value: number;
}

export interface NpcView {
  id: number;
  role: Role;
  x: number;
  y: number;
  facing: Dir;
  status: NpcStatus;
  mode: NpcMode;
  /** Duration of the current cell-to-cell step, for interpolation. */
  moveMs: number;
}

export interface EncounterView {
  /** Increments every time the encounter changes, so clients can re-render only on change. */
  rev: number;
  npcId: number;
  role: Role;
  phase: 'choose' | 'negotiate';
  step: number;
  maxSteps: number;
  flavor: string;
  reply: NpcReply | null;
  farTooLow: boolean;
  canWalk: boolean;
  canKill: boolean;
  killCost: number;
  walkCost: number;
  cash: number;
  quick: { low: number; medium: number; high: number };
}

export interface StateMsg {
  t: number;
  phase: RoomPhase;
  me: SelfView;
  opp: OpponentView;
  projectiles: ProjectileView[];
  pickups: CashPickupView[];
  /** Only your own NPCs. */
  npcs: NpcView[];
  reveal: { path: Point[]; ms: number } | null;
  encounter: EncounterView | null;
}

export type FxKind = 'shot' | 'hit' | 'cash' | 'kill' | 'bribe_ok' | 'bribe_fail' | 'encounter';

export interface FxMsg {
  kind: FxKind;
  /** The player the effect belongs to (shooter, victim, collector...). */
  slot: Slot;
  /** For 'kill': the NPC that was shot. */
  npcId?: number;
}

export interface NotifyMsg {
  text: string;
  tone: 'info' | 'good' | 'bad' | 'warn';
}

export interface EncounterResult {
  npcId: number;
  role: Role;
  outcome: 'bribed' | 'failed' | 'killed' | 'skipped';
  text: string;
}

export interface PlayerStats {
  cash: number;
  hp: number;
  shotsFired: number;
  shotsHit: number;
  cashCollected: number;
  bribed: number;
  failedBribes: number;
  killed: number;
  walkedAway: number;
}

export interface GameOverMsg {
  winner: Slot;
  reason: WinReason;
  detail: string;
  names: [string, string];
  stats: [PlayerStats, PlayerStats];
  seed: number;
}

// ---------------------------------------------------------------- events

export interface ClientToServerEvents {
  'room:create': (p: { name: string }, ack: (r: JoinResult) => void) => void;
  'room:join': (p: { name: string; code: string }, ack: (r: JoinResult) => void) => void;
  'room:resume': (p: { token: string }, ack: (r: { ok: boolean }) => void) => void;
  'room:leave': () => void;
  'lobby:ready': (ready: boolean) => void;
  'input:move': (dir: RelDir) => void;
  'input:shoot': () => void;
  'npc:action': (action: NpcAction) => void;
  'npc:offer': (amount: number) => void;
  'game:rematch': () => void;
}

export interface ServerToClientEvents {
  'lobby:state': (s: LobbyState) => void;
  'game:init': (g: GameInit) => void;
  /** 3, 2, 1, then 0 meaning GO. */
  'game:countdown': (n: number) => void;
  'game:state': (s: StateMsg) => void;
  'maze:update': (cells: number[]) => void;
  'game:fx': (f: FxMsg) => void;
  'game:notify': (n: NotifyMsg) => void;
  'npc:result': (r: EncounterResult) => void;
  'game:over': (o: GameOverMsg) => void;
}
