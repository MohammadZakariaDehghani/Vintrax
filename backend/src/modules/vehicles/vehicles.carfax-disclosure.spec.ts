import { toVehicleDetail } from './vehicles.mapper';

/**
 * An unapproved CARFAX reading is not disclosed.
 *
 * This is the property the whole review step rests on. Reading a report and
 * publishing what it says are two acts, and between them the records sit in the
 * database — so the listing response, which is public, must not carry them.
 *
 * Gating it in the page would not be enough and is the mistake this guards
 * against: the API is the disclosure boundary, and "the component does not draw
 * it" is not the same as "a buyer cannot read it". Anyone can fetch the listing
 * JSON.
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
function row(overrides: { carfaxHistoryApproved: boolean }) {
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
    carfaxFetchedAt: null,
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
    ...overrides,
  } as unknown as Parameters<typeof toVehicleDetail>[0];
}

const idsOf = (detail: { historyEvents: Array<{ id: string }> }) =>
  detail.historyEvents.map((entry) => entry.id);

describe('CARFAX records in the listing response', () => {
  it('withholds an unapproved reading from a buyer', () => {
    const detail = toVehicleDetail(row({ carfaxHistoryApproved: false }), new Set());

    expect(idsOf(detail)).toEqual(['seller-1']);
  });

  it('shows it once the dealer has approved it', () => {
    const detail = toVehicleDetail(row({ carfaxHistoryApproved: true }), new Set());

    expect(idsOf(detail)).toEqual(['seller-1', 'carfax-1']);
  });

  it('shows an unapproved reading to the owner, who has to review it', () => {
    const detail = toVehicleDetail(row({ carfaxHistoryApproved: false }), new Set(), {
      includeUnapprovedCarfax: true,
    });

    expect(idsOf(detail)).toEqual(['seller-1', 'carfax-1']);
  });

  it('never withholds the seller’s own entries', () => {
    // They were public before this existed and the approval flag says nothing
    // about them.
    for (const approved of [true, false]) {
      const detail = toVehicleDetail(row({ carfaxHistoryApproved: approved }), new Set());
      expect(idsOf(detail)).toContain('seller-1');
    }
  });

  it('does not let the document permission double as the CARFAX one', () => {
    // `includeDocuments` is also true for a buyer holding an order on this
    // vehicle. An accident record the dealer has not published is not theirs
    // to see, so the two flags are separate and this proves they stayed so.
    const detail = toVehicleDetail(row({ carfaxHistoryApproved: false }), new Set(), {
      includeDocuments: true,
    });

    expect(idsOf(detail)).toEqual(['seller-1']);
  });
});
