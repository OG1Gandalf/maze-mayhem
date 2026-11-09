import type { Role } from './protocol';

export const MAZE_SIZE = 21;
export const LOOP_FRACTION = 0.08;
export const FAIRNESS_TOLERANCE = 0.1;

/** The opponent is shown on the minimap only within this many cells (Chebyshev distance). */
export const OPPONENT_VISIBLE_RADIUS = 5;
/** ...and in the 3D view when nearby or in a straight, unobstructed corridor up to this far. */
export const OPPONENT_SIGHT_RANGE = 10;

export const MAX_HP = 10;

/** Currency symbol used everywhere in the UI. Change it here. */
export const CURRENCY = '\u20B9';
export const formatCash = (n: number): string => `${CURRENCY}${n}`;
/** Value of one banknote bundle drawn in the bribe panel and the maze. */
export const CASH_BUNDLE_VALUE = 10;
export const START_CASH = 100;

export const MOVE_MS = 150;
export const BOOST_MOVE_MS = 75;

export const SHOT_COOLDOWN_MS = 400;
/** Projectile speed in cells per second. */
export const SHOT_SPEED = 14;
export const SHOT_MAX_MS = 3000;

export const TICK_MS = 50;
export const COUNTDOWN_SECONDS = 3;
export const RECONNECT_GRACE_MS = 10_000;

export const NAME_MAX = 16;
export const ROOM_CODE_LENGTH = 4;

export const CASH_PICKUP_PAIRS = 8;
export const CASH_PICKUP_MIN = 5;
export const CASH_PICKUP_MAX = 20;

export const ROLES: readonly Role[] = ['MP', 'BUSINESSMAN', 'MLA', 'POLICE'];

export const ROLE_LABEL: Record<Role, string> = {
  MP: 'MP',
  BUSINESSMAN: 'Businessman',
  MLA: 'MLA',
  POLICE: 'Policeman',
};

/** Short badge text, so roles never depend on color alone. */
export const ROLE_BADGE: Record<Role, string> = {
  MP: 'MP',
  BUSINESSMAN: 'BIZ',
  MLA: 'MLA',
  POLICE: 'COP',
};

/** Hidden asking-price ranges (inclusive). MP asks the most, Policeman the least. */
export const PRICE_RANGES: Record<Role, readonly [number, number]> = {
  MP: [55, 85],
  BUSINESSMAN: [40, 65],
  MLA: [28, 45],
  POLICE: [12, 25],
};

export const NEGOTIATION_STEPS = 3;
/** The NPC's acceptance threshold wobbles by up to this fraction of the hidden price. */
export const NEGOTIATION_NOISE = 0.05;
/** Offers below this fraction of the price are "far too low" and cost an extra step. */
export const FAR_TOO_LOW_FRACTION = 0.4;
/** Offers at or above this fraction (but under the price) get "Not enough"; below it, "Too much to ask". */
export const CLOSE_FRACTION = 0.75;

export const QUICK_OFFER_FRACTIONS = { low: 0.25, medium: 0.5, high: 0.8 } as const;

export const KILL_HP_COST = 2;
export const KILL_POLICE_HP_COST = 3;
export const WALK_AWAY_HP_COST = 1;
/** Input lock while the client plays the gunfire kill cinematic. */
export const KILL_CINEMATIC_MS = 2600;
/** After an encounter ends, other NPCs cannot start a new one for this long. */
export const ENCOUNTER_GRACE_MS = 2000;

export const MP_REVEAL_MS = 12_000;
export const MP_BONUS_CASH = 50;
export const MP_FREEZE_MS = 5_000;
export const BIZ_BOOST_MS = 30_000;
export const BIZ_REFUND_MULTIPLIER = 1.5;
export const BIZ_SCAM_FRACTION = 0.3;
export const MLA_FINE_FRACTION = 0.25;
export const MLA_SHORTCUT_WALLS: readonly [number, number] = [3, 4];
export const POLICE_HP_REWARD = 1;

// ---------------------------------------------------------------- NPC AI

/** Milliseconds per cell while chasing (the player moves a cell every 150ms). */
export const NPC_CHASE_STEP_MS: Record<Role, number> = {
  POLICE: 600,
  MP: 700,
  MLA: 750,
  BUSINESSMAN: 800,
};
/** Patrolling is slower than chasing by this factor. */
export const NPC_PATROL_FACTOR = 1.5;
/** Start chasing when the player is this many steps away (BFS path length)... */
export const NPC_CHASE_RADIUS = 6;
/** ...and give up when they get further than this. */
export const NPC_LOSE_RADIUS = 9;
/** Patrol targets stay within this many steps of the NPC's home cell. */
export const NPC_PATROL_RADIUS = 4;
/** NPCs never spawn within this many cells (Chebyshev) of either start. */
export const NPC_SPAWN_CLEARANCE = 6;

// ---------------------------------------------------------------- rate limiting

/** Token bucket per socket: sustained events per second and burst size. */
export const RATE_LIMIT_PER_SEC = 25;
export const RATE_LIMIT_BURST = 40;
