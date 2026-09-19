import {
  ANTI_SNIPE_EXTENSION_SECONDS,
  ANTI_SNIPE_WINDOW_SECONDS,
  BID_INCREMENT_BANDS,
  ROLE_PERMISSIONS,
  minimumBidIncrement,
  placeBidSchema,
  createAuctionSchema,
} from '@vintrax/shared';

/**
 * The auction rules that decide who wins and what they pay. These are pure
 * functions, so they are tested directly rather than through the service —
 * a bug here is a money bug.
 */
describe('bid increments', () => {
  it('scales the minimum increment with the price band', () => {
    expect(minimumBidIncrement(2_000)).toBe(100);
    expect(minimumBidIncrement(12_000)).toBe(250);
    expect(minimumBidIncrement(25_000)).toBe(500);
    expect(minimumBidIncrement(60_000)).toBe(1_000);
    expect(minimumBidIncrement(200_000)).toBe(2_500);
  });

  it('applies the higher increment exactly at a band boundary', () => {
    // 5000 is the top of the first band, so it belongs to the next one.
    expect(minimumBidIncrement(4_999)).toBe(100);
    expect(minimumBidIncrement(5_000)).toBe(250);
  });

  it('never returns a zero increment, which would allow a no-op bid', () => {
    for (const band of BID_INCREMENT_BANDS) {
      expect(band.increment).toBeGreaterThan(0);
    }
    expect(minimumBidIncrement(0)).toBeGreaterThan(0);
  });
});

describe('anti-snipe window', () => {
  it('extends by at least as long as the window it protects', () => {
    // A shorter extension than the window would let a sniper win by bidding
    // just inside it, which defeats the purpose.
    expect(ANTI_SNIPE_EXTENSION_SECONDS).toBeGreaterThanOrEqual(ANTI_SNIPE_WINDOW_SECONDS);
  });
});

describe('bid validation', () => {
  it('rejects a zero or negative bid', () => {
    expect(placeBidSchema.safeParse({ amountCad: 0 }).success).toBe(false);
    expect(placeBidSchema.safeParse({ amountCad: -100 }).success).toBe(false);
  });

  it('coerces a numeric string, because form inputs submit strings', () => {
    const result = placeBidSchema.safeParse({ amountCad: '25000' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amountCad).toBe(25_000);
  });
});

describe('auction creation rules', () => {
  const base = {
    vehicleId: '11111111-1111-4111-8111-111111111111',
    startingBidCad: 10_000,
    startsAt: new Date('2030-01-01T00:00:00Z'),
    endsAt: new Date('2030-01-02T00:00:00Z'),
  };

  it('accepts a well-formed auction', () => {
    expect(createAuctionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an auction that ends before it starts', () => {
    const result = createAuctionSchema.safeParse({
      ...base,
      endsAt: new Date('2029-12-31T00:00:00Z'),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a buy-now price at or below the starting bid', () => {
    // Otherwise the lot could be bought instantly for the opening price.
    expect(createAuctionSchema.safeParse({ ...base, buyNowPriceCad: 9_000 }).success).toBe(false);
    expect(createAuctionSchema.safeParse({ ...base, buyNowPriceCad: 10_000 }).success).toBe(false);
    expect(createAuctionSchema.safeParse({ ...base, buyNowPriceCad: 15_000 }).success).toBe(true);
  });

  it('rejects a reserve below the starting bid', () => {
    expect(createAuctionSchema.safeParse({ ...base, reservePriceCad: 5_000 }).success).toBe(false);
  });
});

describe('role permissions', () => {
  it('lets buyers bid but never write inventory', () => {
    expect(ROLE_PERMISSIONS.BUYER).toContain('bid:place');
    expect(ROLE_PERMISSIONS.BUYER).not.toContain('vehicle:write');
  });

  it('does not let a dealer verify their own dealership', () => {
    // Self-verification would make the verified badge meaningless.
    expect(ROLE_PERMISSIONS.DEALER).not.toContain('dealer:verify');
    expect(ROLE_PERMISSIONS.ADMIN).toContain('dealer:verify');
  });

  it('confines inspectors to inspection work', () => {
    expect(ROLE_PERMISSIONS.INSPECTOR).toContain('inspection:write');
    expect(ROLE_PERMISSIONS.INSPECTOR).not.toContain('vehicle:write');
    expect(ROLE_PERMISSIONS.INSPECTOR).not.toContain('bid:place');
  });

  it('reserves settings management for super admins', () => {
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('settings:manage');
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toContain('settings:manage');
  });
});
