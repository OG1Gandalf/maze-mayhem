/**
 * Socket.IO message protocol shared by client and server.
 * The server is authoritative: clients only ever send intents (inputs, choices, offers).
 */
import type { MazeData, Point } from './maze';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Slot = 0 | 1;
export type Role = 'MP' | 'BUSINESSMAN' | 'MLA' | 'POLICE';
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'over';
export type WinReason = 'center' | 'died' | 'arrested' | 'forfeit';
export type NpcStatus = 'active' | 'bribed' | 'failed' | 'killed' | 'skipped';
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
}

export interface SelfView {
  x: number;
  y: number;
  facing: Dir;
  hp: number;
  coins: number;
  moveMs: number;
  frozenMs: number;
  boostMs: number;
  shotCooldownMs: number;
  killed: Record<Role, boolean>;
}

export interface OpponentView {
  name: string;
  hp: number;
  connected: boolean;
  /** Position is only sent while the opponent is within OPPONENT_VISIBLE_RADIUS cells. */
  visible: boolean;
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

export interface CoinView {
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
  status: NpcStatus;
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
  coins: number;
  quick: { low: number; medium: number; high: number };
}

export interface StateMsg {
  t: number;
  phase: RoomPhase;
  me: SelfView;
  opp: OpponentView;
  projectiles: ProjectileView[];
  coins: CoinView[];
  npcs: NpcView[];
  reveal: { path: Point[]; ms: number } | null;
  encounter: EncounterView | null;
}

export type FxKind = 'shot' | 'hit' | 'coin' | 'kill' | 'bribe_ok' | 'bribe_fail' | 'encounter';

export interface FxMsg {
  kind: FxKind;
  /** The player the effect belongs to (shooter, victim, collector...). */
  slot: Slot;
}

export interface NotifyMsg {
  text: string;
  tone: 'info' | 'good' | 'bad' | 'warn';
}

export interface EncounterResult {
  role: Role;
  outcome: 'bribed' | 'failed' | 'killed' | 'skipped';
  text: string;
}

export interface PlayerStats {
  coins: number;
  hp: number;
  shotsFired: number;
  shotsHit: number;
  coinsCollected: number;
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
}

// ---------------------------------------------------------------- events

export interface ClientToServerEvents {
  'room:create': (p: { name: string }, ack: (r: JoinResult) => void) => void;
  'room:join': (p: { name: string; code: string }, ack: (r: JoinResult) => void) => void;
  'room:resume': (p: { token: string }, ack: (r: { ok: boolean }) => void) => void;
  'room:leave': () => void;
  'lobby:ready': (ready: boolean) => void;
  'input:move': (dir: Dir) => void;
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
