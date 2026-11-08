import type { Role } from './protocol';

export const MAZE_SIZE = 21;
export const LOOP_FRACTION = 0.08;
export const FAIRNESS_TOLERANCE = 0.1;

/** Cells visible across the shorter screen axis in the POV view. */
export const VIEW_CELLS = 9;
export const OPPONENT_VISIBLE_RADIUS = 5;

export const MAX_HP = 10;
export const START_COINS = 100;

export const MOVE_MS = 120;
export const BOOST_MOVE_MS = 60;

export const SHOT_COOLDOWN_MS = 400;
/** Projectile speed in cells per second. */
export const SHOT_SPEED = 14;
export const SHOT_MAX_MS = 3000;

export const TICK_MS = 50;
export const COUNTDOWN_SECONDS = 3;
export const RECONNECT_GRACE_MS = 10_000;

export const NAME_MAX = 16;
export const ROOM_CODE_LENGTH = 4;

export const COIN_PICKUP_PAIRS = 8;
export const COIN_PICKUP_MIN = 5;
export const COIN_PICKUP_MAX = 20;

export const ROLES: readonly Role[] = ['MP', 'BUSINESSMAN', 'MLA', 'POLICE'];

export const ROLE_LABEL: Record<Role, string> = {
  MP: 'MP',
  BUSINESSMAN: 'Businessman',
  MLA: 'MLA',
  POLICE: 'Policeman',
};

/** Short badge text drawn on the canvas, so roles never depend on color alone. */
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

export const MP_REVEAL_MS = 12_000;
export const MP_BONUS_COINS = 50;
export const MP_FREEZE_MS = 5_000;
export const BIZ_BOOST_MS = 30_000;
export const BIZ_REFUND_MULTIPLIER = 1.5;
export const BIZ_SCAM_FRACTION = 0.3;
export const MLA_FINE_FRACTION = 0.25;
export const MLA_SHORTCUT_WALLS: readonly [number, number] = [3, 4];
export const POLICE_HP_REWARD = 1;
