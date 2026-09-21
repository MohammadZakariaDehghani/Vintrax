import { toVehicleDetail } from './vehicles.mapper';

/**
 * Who gets to see the CARFAX extraction, and how much of it.
 *
 * The owner and an admin (`includeCarfaxStatus: true`) see everything Vintrax
 * extracted, regardless of `showVehicleHistory` — the edit page has to be
 * able to preview a reading before the dealer decides whether to publish it.
 * Anyone else sees `CARFAX`-sourced history rows only once that toggle is on,
 * and never sees `carfaxFetchedAt`/`carfaxFetchError` at all — internal
 * extraction diagnostics with no reason to reach a buyer, following D-036's
 * own rule that an unpublished CARFAX finding is withheld by the API itself,
 * not merely left undrawn by the page. A `SELLER` row is always visible to
 * everyone, exactly as it always has been.
 */

const event = (id: string, source: 'SELLER' | 'CARFAX') => ({
  id,
  kind: 'ACCIDENT_DAMAGE' as const,
  source,
  occurredOn: null,
  label: `record ${id}`,
  detail: null,
  position: 0,
});

/** The minimum a detail row needs to map. */
function row(overrides: { showVehicleHistory?: boolean } = {}) {
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
    carfaxOneOwner: true,
    carfaxLowKilometres: null,
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
    showVehicleHistory: overrides.showVehicleHistory ?? false,
    carfaxFetchedAt: new Date('2026-01-01T00:00:00Z'),
    carfaxFetchError: 'the report host resolved to a private address',
    documents: [],
    historyEvents: [event('seller-1', 'SELLER'), event('carfax-1', 'CARFAX')],
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
  } as unknown as Parameters<typeof toVehicleDetail>[0];
}

const idsOf = (detail: { historyEvents: Array<{ id: string }> }) =>
  detail.historyEvents.map((entry) => entry.id);

describe('the owner or an admin (includeCarfaxStatus: true)', () => {
  it('sees the CARFAX row even while showVehicleHistory is off', () => {
    const detail = toVehicleDetail(row({ showVehicleHistory: false }), new Set(), {
      includeCarfaxStatus: true,
    });

    expect(idsOf(detail)).toEqual(['seller-1', 'carfax-1']);
  });

  it('sees the fetch timestamp and error', () => {
    const detail = toVehicleDetail(row(), new Set(), { includeCarfaxStatus: true });

    expect(detail.carfaxFetchedAt).not.toBeNull();
    expect(detail.carfaxFetchError).toBe('the report host resolved to a private address');
  });
});

describe('anyone else (includeCarfaxStatus unset)', () => {
  it('drops the CARFAX row while showVehicleHistory is off', () => {
    const detail = toVehicleDetail(row({ showVehicleHistory: false }), new Set());

    expect(idsOf(detail)).toEqual(['seller-1']);
  });

  it('keeps the seller row and the CARFAX row once showVehicleHistory is on', () => {
    const detail = toVehicleDetail(row({ showVehicleHistory: true }), new Set());

    expect(idsOf(detail)).toEqual(['seller-1', 'carfax-1']);
  });

  it('never sees the fetch timestamp or error, on or off', () => {
    const off = toVehicleDetail(row({ showVehicleHistory: false }), new Set());
    const on = toVehicleDetail(row({ showVehicleHistory: true }), new Set());

    expect(off.carfaxFetchedAt).toBeNull();
    expect(off.carfaxFetchError).toBeNull();
    expect(on.carfaxFetchedAt).toBeNull();
    expect(on.carfaxFetchError).toBeNull();
  });

  it('still sees the badges and the toggle state itself', () => {
    const detail = toVehicleDetail(row({ showVehicleHistory: false }), new Set());

    expect(detail.carfaxOneOwner).toBe(true);
    expect(detail.showVehicleHistory).toBe(false);
  });
});
