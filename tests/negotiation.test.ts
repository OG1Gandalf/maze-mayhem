import { describe, expect, it } from 'vitest';
import { PRICE_RANGES, ROLES } from '../shared/constants';
import { createNegotiation, makeOffer, quickOffers, rollPrice } from '../server/negotiation';
import { createRng, type Rng } from '../server/rng';

/** An Rng whose next() always returns `v` (0.5 = no noise, 0 = -5%, ~1 = +5%). */
const fixed = (v: number): Rng => ({ ...createRng(1), next: () => v });

const PRICE = 50;

describe('negotiation', () => {
  it('high offer: accepted on the first step and the full offer is paid', () => {
    const n = createNegotiation('MP', PRICE);
    const r = makeOffer(n, 60, fixed(0.5));
    expect(r).toEqual({ kind: 'success', paid: 60 });
    expect(n.done).toBe(true);
  });

  it('medium offer (close to the price): "Not enough" and moves to step 2', () => {
    const n = createNegotiation('MLA', PRICE);
    const r = makeOffer(n, 42, fixed(0.5));
    expect(r).toEqual({ kind: 'counter', reply: 'not_enough', farTooLow: false, step: 2 });
    expect(n.step).toBe(2);
  });

  it('low offer (well under the price): "Too much to ask" and moves to step 2', () => {
    const n = createNegotiation('BUSINESSMAN', PRICE);
    const r = makeOffer(n, 25, fixed(0.5));
    expect(r).toEqual({ kind: 'counter', reply: 'too_much_to_ask', farTooLow: false, step: 2 });
  });

  it('far-too-low offer costs a step (jumps straight to the final step)', () => {
    const n = createNegotiation('POLICE', PRICE);
    const r = makeOffer(n, 10, fixed(0.5));
    expect(r).toEqual({ kind: 'counter', reply: 'too_much_to_ask', farTooLow: true, step: 3 });
  });

  it('far-too-low offer on step 2 ends the negotiation in failure', () => {
    const n = createNegotiation('MP', PRICE);
    makeOffer(n, 40, fixed(0.5));
    expect(makeOffer(n, 5, fixed(0.5))).toEqual({ kind: 'fail', farTooLow: true });
    expect(n.done).toBe(true);
  });

  it('runs exactly three steps: low, medium, then a final miss fails', () => {
    const n = createNegotiation('MLA', PRICE);
    expect(makeOffer(n, 25, fixed(0.5)).kind).toBe('counter');
    expect(makeOffer(n, 45, fixed(0.5)).kind).toBe('counter');
    expect(n.step).toBe(3);
    expect(makeOffer(n, 48, fixed(0.5))).toEqual({ kind: 'fail', farTooLow: false });
    expect(() => makeOffer(n, 100, fixed(0.5))).toThrow();
  });

  it('a final offer that meets the price succeeds', () => {
    const n = createNegotiation('MLA', PRICE);
    makeOffer(n, 25, fixed(0.5));
    makeOffer(n, 45, fixed(0.5));
    expect(makeOffer(n, 50, fixed(0.5))).toEqual({ kind: 'success', paid: 50 });
  });

  it('applies a small random factor (±5%) around the hidden price', () => {
    // Threshold = round(50 * (1 ± 0.05)): lowest 48, highest 52.
    expect(makeOffer(createNegotiation('MP', PRICE), 48, fixed(0)).kind).toBe('success');
    expect(makeOffer(createNegotiation('MP', PRICE), 48, fixed(0.999)).kind).toBe('counter');
    for (let seed = 1; seed < 200; seed++) {
      expect(makeOffer(createNegotiation('MP', PRICE), 47, createRng(seed)).kind).not.toBe('success');
      expect(makeOffer(createNegotiation('MP', PRICE), 53, createRng(seed)).kind).toBe('success');
    }
  });

  it('quick offers are Low/Medium/High fractions of current coins', () => {
    expect(quickOffers(100)).toEqual({ low: 25, medium: 50, high: 80 });
    expect(quickOffers(0)).toEqual({ low: 0, medium: 0, high: 0 });
  });

  it('hidden prices stay inside role ranges, ranked MP > Businessman > MLA > Policeman', () => {
    const rng = createRng(5);
    for (const role of ROLES) {
      for (let i = 0; i < 200; i++) {
        const p = rollPrice(role, rng);
        expect(p).toBeGreaterThanOrEqual(PRICE_RANGES[role][0]);
        expect(p).toBeLessThanOrEqual(PRICE_RANGES[role][1]);
      }
    }
    const order = ['MP', 'BUSINESSMAN', 'MLA', 'POLICE'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(PRICE_RANGES[order[i - 1]][0]).toBeGreaterThan(PRICE_RANGES[order[i]][0]);
      expect(PRICE_RANGES[order[i - 1]][1]).toBeGreaterThan(PRICE_RANGES[order[i]][1]);
    }
  });
});
