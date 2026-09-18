import { toVehicleDetail } from './vehicles.mapper';

/**
 * CARFAX-sourced history rows never reach the listing response.
 *
 * Vintrax no longer fetches or reads any CARFAX report — every history entry
 * is the seller's own typed account. The mapper still filters out
 * `source: 'CARFAX'` defensively, in case a row from before that feature was
 * removed still sits in the database; this proves that filter holds.
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
function row() {
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
    carfaxOneOwner: null,
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

describe('CARFAX records in the listing response', () => {
  it('keeps the seller’s own entries and drops any leftover CARFAX row', () => {
    const detail = toVehicleDetail(row(), new Set());

    expect(idsOf(detail)).toEqual(['seller-1']);
  });

  it('drops a leftover CARFAX row for the owner too', () => {
    const detail = toVehicleDetail(row(), new Set(), { includeDocuments: true });

    expect(idsOf(detail)).toEqual(['seller-1']);
  });
});
