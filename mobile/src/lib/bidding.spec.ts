import { describe, expect, it } from 'vitest';
import { isSubmittableBid, quickBidLadder } from './bidding';

/**
 * The one-tap bid amounts. Every value offered has to be one the API will
 * accept — a button that reliably produces a rejection is worse than no button.
 */
describe('quickBidLadder', () => {
  it('starts at the minimum the server reported', () => {
    const ladder = quickBidLadder({ currentBidCad: 20_000, minimumNextBidCad: 20_500 });
    expect(ladder[0]).toBe(20_500);
  });

  it('climbs by the server-derived step, so every amount clears the minimum', () => {
    const ladder = quickBidLadder({ currentBidCad: 20_000, minimumNextBidCad: 20_500 });
    expect(ladder).toEqual([20_500, 21_000, 22_500]);
    for (const amount of ladder) expect(amount).toBeGreaterThanOrEqual(20_500);
  });

  it('never repeats an amount, which would give two buttons the same effect', () => {
    const ladder = quickBidLadder({ currentBidCad: 5_000, minimumNextBidCad: 5_250 });
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  it('falls back to a single amount when the step is not positive', () => {
    // A malformed or already-outdated auction payload must not produce a
    // ladder of amounts the API would reject.
    expect(quickBidLadder({ currentBidCad: 20_000, minimumNextBidCad: 20_000 })).toEqual([20_000]);
    expect(quickBidLadder({ currentBidCad: 20_000, minimumNextBidCad: 19_000 })).toEqual([19_000]);
  });
});

describe('isSubmittableBid', () => {
  const auction = { minimumNextBidCad: 20_500 };

  it('accepts a whole amount at or above the minimum', () => {
    expect(isSubmittableBid('20500', auction)).toBe(true);
    expect(isSubmittableBid('25000', auction)).toBe(true);
  });

  it('rejects an amount below the minimum before spending a round trip', () => {
    expect(isSubmittableBid('20499', auction)).toBe(false);
  });

  it('rejects empty and non-numeric input', () => {
    expect(isSubmittableBid('', auction)).toBe(false);
    expect(isSubmittableBid('abc', auction)).toBe(false);
    expect(isSubmittableBid('20 500', auction)).toBe(false);
  });

  it('rejects decimals and signs, since bids are whole dollars', () => {
    expect(isSubmittableBid('20500.50', auction)).toBe(false);
    expect(isSubmittableBid('-21000', auction)).toBe(false);
    expect(isSubmittableBid('+21000', auction)).toBe(false);
  });

  it('rejects a number too large to represent exactly', () => {
    expect(isSubmittableBid('9'.repeat(20), auction)).toBe(false);
  });
});
