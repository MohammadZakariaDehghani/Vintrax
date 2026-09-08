import {
  LISTING_STATUSES,
  SELLER_STATUS_TRANSITIONS,
  createVehicleSchema,
  updateListingStatusSchema,
  updateVehicleSchema,
} from '@atlas/shared';

/**
 * Publication is a moderation decision.
 *
 * A seller who can write `status` on their own listing has no moderation step
 * at all — they can approve themselves. These tests pin the schemas that make
 * that impossible, and the transition table that is the only other way in.
 */

const validListing = {
  title: '2020 Test Car in good condition',
  description: 'A perfectly ordinary car, described at sufficient length to pass validation.',
  make: 'Test',
  model: 'Car',
  year: 2020,
  priceCad: 20_000,
  mileageKm: 10_000,
  condition: 'USED',
  bodyType: 'SEDAN',
  transmission: 'AUTOMATIC',
  fuelType: 'GASOLINE',
  drivetrain: 'FWD',
  province: 'ON',
  city: 'Toronto',
};

describe('creating a listing', () => {
  it('defaults to a draft', () => {
    const parsed = createVehicleSchema.parse(validListing);

    expect(parsed.status).toBe('DRAFT');
  });

  it('allows submitting straight for review', () => {
    const parsed = createVehicleSchema.parse({ ...validListing, status: 'PENDING_REVIEW' });

    expect(parsed.status).toBe('PENDING_REVIEW');
  });

  it('refuses to create a listing that is already published', () => {
    const result = createVehicleSchema.safeParse({ ...validListing, status: 'ACTIVE' });

    expect(result.success).toBe(false);
  });

  it('refuses statuses owned by the auction and settlement flows', () => {
    for (const status of ['IN_AUCTION', 'SOLD', 'ARCHIVED'] as const) {
      expect(createVehicleSchema.safeParse({ ...validListing, status }).success).toBe(false);
    }
  });
});

describe('updating a listing', () => {
  it('refuses a status smuggled in beside a legitimate edit', () => {
    // Rejected, not stripped. Stripping would save the price, report success
    // and leave the status untouched — a silent no-op is how an edit form kept
    // offering a control that did nothing.
    const result = updateVehicleSchema.safeParse({ priceCad: 19_000, status: 'ACTIVE' });

    expect(result.success).toBe(false);
  });

  it('says where the status actually changes', () => {
    const result = updateVehicleSchema.safeParse({ priceCad: 19_000, status: 'ACTIVE' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message).join(' ')).toContain(
      '/vehicles/:id/status',
    );
  });

  it('refuses a payload whose only field was the status', () => {
    expect(updateVehicleSchema.safeParse({ status: 'ACTIVE' }).success).toBe(false);
  });

  it('refuses an unknown field, rather than quietly discarding it', () => {
    expect(updateVehicleSchema.safeParse({ priceCad: 19_000, colour: 'red' }).success).toBe(false);
  });

  it('still accepts an ordinary edit', () => {
    expect(updateVehicleSchema.safeParse({ mileageKm: 12_000 }).success).toBe(true);
  });
});

describe('the seller status endpoint', () => {
  it('accepts only the statuses a seller owns', () => {
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'ARCHIVED', 'SOLD'] as const) {
      expect(updateListingStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('refuses ACTIVE, which is what moderation is for', () => {
    expect(updateListingStatusSchema.safeParse({ status: 'ACTIVE' }).success).toBe(false);
  });

  it('refuses IN_AUCTION, which describes a running auction', () => {
    expect(updateListingStatusSchema.safeParse({ status: 'IN_AUCTION' }).success).toBe(false);
  });
});

describe('the seller transition table', () => {
  it('covers every listing status, so no state is left undefined', () => {
    for (const status of LISTING_STATUSES) {
      expect(SELLER_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('never lets a seller reach ACTIVE from anywhere', () => {
    for (const status of LISTING_STATUSES) {
      expect(SELLER_STATUS_TRANSITIONS[status]).not.toContain('ACTIVE');
    }
  });

  it('lets a seller submit a draft for review and withdraw it again', () => {
    expect(SELLER_STATUS_TRANSITIONS.DRAFT).toContain('PENDING_REVIEW');
    expect(SELLER_STATUS_TRANSITIONS.PENDING_REVIEW).toContain('DRAFT');
  });

  it('lets a seller delist a published vehicle', () => {
    expect(SELLER_STATUS_TRANSITIONS.ACTIVE).toContain('ARCHIVED');
  });

  it('lets a seller unpublish to edit, in one step rather than two', () => {
    // Costing them the approval is the point; making it awkward is not.
    expect(SELLER_STATUS_TRANSITIONS.ACTIVE).toContain('DRAFT');
  });

  it('freezes a listing that is in a running auction', () => {
    // Bidders are committed to it; the seller cancels the auction instead.
    expect(SELLER_STATUS_TRANSITIONS.IN_AUCTION).toEqual([]);
  });

  it('lets a seller mark a vehicle sold from every state that is on the market', () => {
    // Cars get sold off the platform, and the listing has to be able to say so.
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'ARCHIVED'] as const) {
      expect(SELLER_STATUS_TRANSITIONS[status]).toContain('SOLD');
    }
  });

  it('lets a sold listing reopen as a draft, and only as a draft', () => {
    // The service refuses when a real order exists, so this is for a
    // mistake or a deal that fell through — not for relisting a paid car.
    expect(SELLER_STATUS_TRANSITIONS.SOLD).toEqual(['DRAFT']);
  });

  it('offers no transition that re-publishes without review', () => {
    // Everything returns through DRAFT, which is the state moderation reads
    // from, so a reopened listing is reviewed again before it goes live.
    for (const status of LISTING_STATUSES) {
      for (const target of SELLER_STATUS_TRANSITIONS[status]) {
        expect(target).not.toBe('ACTIVE');
      }
    }
    expect(SELLER_STATUS_TRANSITIONS.ARCHIVED).toEqual(['DRAFT', 'SOLD']);
  });
});
