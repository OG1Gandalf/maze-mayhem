import {
  CLOSE_FRACTION,
  FAR_TOO_LOW_FRACTION,
  NEGOTIATION_NOISE,
  NEGOTIATION_STEPS,
  PRICE_RANGES,
  QUICK_OFFER_FRACTIONS,
} from '../shared/constants';
import type { NpcReply, Role } from '../shared/protocol';
import type { Rng } from './rng';

export interface Negotiation {
  role: Role;
  /** Hidden asking price. Never sent to clients. */
  price: number;
  /** Current step, 1-based. */
  step: number;
  done: boolean;
  lastReply: NpcReply | null;
  lastFarTooLow: boolean;
}

export type OfferOutcome =
  | { kind: 'success'; paid: number }
  | { kind: 'fail'; farTooLow: boolean }
  | { kind: 'counter'; reply: Exclude<NpcReply, 'accept'>; farTooLow: boolean; step: number };

export function rollPrice(role: Role, rng: Rng): number {
  const [min, max] = PRICE_RANGES[role];
  return rng.int(min, max);
}

export function createNegotiation(role: Role, price: number): Negotiation {
  return { role, price, step: 1, done: false, lastReply: null, lastFarTooLow: false };
}

export function quickOffers(coins: number): { low: number; medium: number; high: number } {
  const f = (x: number) => Math.max(0, Math.floor(coins * x));
  return { low: f(QUICK_OFFER_FRACTIONS.low), medium: f(QUICK_OFFER_FRACTIONS.medium), high: f(QUICK_OFFER_FRACTIONS.high) };
}

/**
 * Resolves one offer. The NPC accepts when the offer reaches the hidden price plus a small random wobble.
 * Otherwise it counters with a rough hint; a far-too-low offer costs an extra step, and missing on the
 * final step fails the bribe. Mutates `n`.
 */
export function makeOffer(n: Negotiation, offer: number, rng: Rng): OfferOutcome {
  if (n.done) throw new Error('Negotiation already finished');
  const amount = Math.max(0, Math.floor(offer));
  const threshold = Math.round(n.price * (1 + (rng.next() * 2 - 1) * NEGOTIATION_NOISE));

  if (amount >= threshold) {
    n.done = true;
    n.lastReply = 'accept';
    return { kind: 'success', paid: amount };
  }

  const farTooLow = amount < n.price * FAR_TOO_LOW_FRACTION;
  const nextStep = n.step + (farTooLow ? 2 : 1);
  n.lastFarTooLow = farTooLow;
  if (nextStep > NEGOTIATION_STEPS) {
    n.done = true;
    return { kind: 'fail', farTooLow };
  }
  const reply = amount >= n.price * CLOSE_FRACTION ? 'not_enough' : 'too_much_to_ask';
  n.step = nextStep;
  n.lastReply = reply;
  return { kind: 'counter', reply, farTooLow, step: nextStep };
}
