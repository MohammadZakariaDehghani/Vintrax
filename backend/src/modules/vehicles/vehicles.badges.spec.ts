import { toVehicleDetail, toVehicleSummary } from './vehicles.mapper';

/**
 * The five vehicle-history badges (issue #67, superseding D-047's automatic
 * CARFAX extraction). Each is a plain boolean the dealer set directly, and
 * `toVehicleSummary`/`toVehicleDetail` do nothing but carry them through into
 * one `badges` object — there is no extraction status, no publish toggle, and
 * no per-viewer filtering of the timeline any more.
 */

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v1',
    slug: 'a-car',
    title: 'A car',
    make: 'Toyota',
    model: 'RAV4',
    trim: null,
    year: 2019,
    priceCad: 30_000,
    mileageKm: 40_000,
    condition: 'USED',
    bodyType: 'SUV',
    fuelType: 'GASOLINE',
    transmission: 'AUTOMATIC',
    drivetrain: 'AWD',
    province: 'ON',
    city: 'Toronto',
    status: 'ACTIVE',
    saleChannel: 'FIXED_PRICE',
    carfaxUrl: 'https://vhr.carfax.ca/report/abc',
    badgeLowKilometres: false,
    badgeOneOwner: true,
    badgeNoAccident: false,
    badgeReport: false,
    badgeCarfax: true,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [],
    _count: { images: 0 },
    inspections: [],
    auctions: [],
    description: 'A car.',
    vin: null,
    stockNumber: null,
    titleStatus: null,
    engine: null,
    engineSizeL: null,
    cylinders: null,
    doors: null,
    seats: null,
    exteriorColour: null,
    interiorColour: null,
    postalCode: null,
    features: [],
    viewCount: 0,
    favouriteCount: 0,
    documents: [],
    historyEvents: [
      { id: 'e1', kind: 'ACCIDENT_DAMAGE', occurredOn: null, label: 'Fender bender', detail: null, position: 0 },
    ],
    seller: {
      id: 's1',
      firstName: 'A',
      lastName: 'Dealer',
      role: 'DEALER',
      province: 'ON',
      city: 'Toronto',
      dealer: null,
      createdAt: new Date(),
    },
    ...overrides,
  } as unknown as Parameters<typeof toVehicleDetail>[0];
}

describe('vehicle badges', () => {
  it('carries all five badges through to the summary, as one object', () => {
    const summary = toVehicleSummary(row(), new Set());

    expect(summary.badges).toEqual({
      lowKilometres: false,
      oneOwner: true,
      noAccident: false,
      report: false,
      carfax: true,
    });
  });

  it('is independent of carfaxUrl — a badge can be on with no link, or a link with no badge', () => {
    const noLink = toVehicleSummary(row({ carfaxUrl: null, badgeCarfax: true }), new Set());
    expect(noLink.carfaxUrl).toBeNull();
    expect(noLink.badges.carfax).toBe(true);

    const linkNoBadge = toVehicleSummary(
      row({ carfaxUrl: 'https://vhr.carfax.ca/report/abc', badgeCarfax: false }),
      new Set(),
    );
    expect(linkNoBadge.carfaxUrl).not.toBeNull();
    expect(linkNoBadge.badges.carfax).toBe(false);
  });

  it('carries the timeline through unfiltered — every entry is the dealer\'s own', () => {
    const detail = toVehicleDetail(row(), new Set());
    expect(detail.historyEvents).toHaveLength(1);
    expect(detail.historyEvents[0]).not.toHaveProperty('source');
  });

  it('shows the same badges and timeline to the owner as to anyone else — nothing is viewer-gated', () => {
    const asOwner = toVehicleDetail(row(), new Set(), { includeDocuments: true });
    const asAnyone = toVehicleDetail(row(), new Set());

    expect(asAnyone.badges).toEqual(asOwner.badges);
    expect(asAnyone.historyEvents).toEqual(asOwner.historyEvents);
  });
});
