import {
  createVehicleSchema,
  listingQuality,
  updateVehicleSchema,
  vinCheckDigitMatches,
  youTubeEmbedUrl,
  youTubeVideoId,
} from '@vintrax/shared';
import { toVehicleDetail, type VehicleDetailRow } from './vehicles.mapper';

/**
 * The details the dealer's "Add a vehicle" form collects beyond the basics —
 * condition, video and reference prices — and the listing-quality score.
 */

const BASE = {
  title: '2000 Honda CR-V SE',
  description: 'A well-kept CR-V with a clean interior and new tires.',
  make: 'Honda',
  model: 'CR-V',
  year: 2000,
  priceCad: 4_980,
  mileageKm: 420_647,
  condition: 'USED',
  bodyType: 'SUV',
  transmission: 'AUTOMATIC',
  fuelType: 'GASOLINE',
  drivetrain: 'FOUR_WHEEL_DRIVE',
  province: 'ON',
  city: 'Toronto',
};

describe('the listing details a dealer can send', () => {
  it('accepts every field the form collects', () => {
    const parsed = createVehicleSchema.parse({
      ...BASE,
      vin: 'jhlrd1871yc810608',
      stockNumber: 'A1042',
      horsepower: 144,
      manufacturerColour: 'Satin Silver Metallic',
      curbWeightLbs: 3200,
      isDamaged: false,
      ownerCount: 2,
      availability: 'IMMEDIATELY',
      extendedWarranty: true,
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      salePriceCad: 4_500,
      msrpCad: 25_000,
      invoicePriceCad: 3_000,
      retailPriceCad: 5_500,
      wholesalePriceCad: 3_200,
    });
    expect(parsed).toMatchObject({ vin: 'JHLRD1871YC810608', stockNumber: 'A1042', ownerCount: 2 });
  });

  it('refuses a video that is not on YouTube, and more than five owners', () => {
    expect(
      createVehicleSchema.safeParse({ ...BASE, videoUrl: 'https://evil.example/v.mp4' }).success,
    ).toBe(false);
    expect(createVehicleSchema.safeParse({ ...BASE, ownerCount: 6 }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ ...BASE, availability: 'SOMEDAY' }).success).toBe(false);
  });

  it('lets an edit clear an optional field with null', () => {
    const parsed = updateVehicleSchema.parse({
      trim: null,
      stockNumber: null,
      videoUrl: null,
      isDamaged: null,
    });
    expect(parsed).toEqual({ trim: null, stockNumber: null, videoUrl: null, isDamaged: null });
  });

  it('takes the whole equipment catalogue', () => {
    const features = Array.from({ length: 120 }, (_, index) => `Feature ${index}`);
    expect(createVehicleSchema.safeParse({ ...BASE, features }).success).toBe(true);
  });
});

function row(overrides: Partial<Record<string, unknown>> = {}): VehicleDetailRow {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'vehicle-1',
    slug: 'vehicle-1',
    title: '2000 Honda CR-V SE',
    make: 'Honda',
    model: 'CR-V',
    trim: 'SE',
    year: 2000,
    priceCad: 4_980,
    mileageKm: 420_647,
    condition: 'USED',
    bodyType: 'SUV',
    fuelType: 'GASOLINE',
    transmission: 'AUTOMATIC',
    drivetrain: 'FOUR_WHEEL_DRIVE',
    province: 'ON',
    city: 'Toronto',
    status: 'ACTIVE',
    saleChannel: 'FIXED_PRICE',
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    description: 'A car.',
    vin: null,
    engine: null,
    engineSizeL: null,
    cylinders: null,
    doors: null,
    seats: null,
    exteriorColour: null,
    interiorColour: null,
    postalCode: null,
    horsepower: 144,
    manufacturerColour: null,
    curbWeightLbs: null,
    isDamaged: false,
    ownerCount: 2,
    availability: 'IMMEDIATELY',
    extendedWarranty: null,
    videoUrl: null,
    salePriceCad: 4_500,
    msrpCad: 25_000,
    invoicePriceCad: 3_000,
    retailPriceCad: null,
    wholesalePriceCad: 3_200,
    features: [],
    viewCount: 0,
    favouriteCount: 0,
    images: [],
    _count: { images: 0 },
    inspections: [],
    auctions: [],
    documents: [],
    historyEvents: [],
    seller: {
      id: 'seller-1',
      firstName: 'Sam',
      lastName: 'Seller',
      role: 'SELLER',
      province: 'ON',
      city: 'Toronto',
      createdAt: now,
      dealer: null,
    },
    ...overrides,
  } as unknown as VehicleDetailRow;
}

describe('reference prices in the vehicle detail', () => {
  it('are withheld from everyone by default', () => {
    const detail = toVehicleDetail(row(), new Set());
    expect(detail.referencePrices).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('3200');
  });

  it('are given to the seller and administrators when asked for', () => {
    const detail = toVehicleDetail(row(), new Set(), { includeReferencePrices: true });
    expect(detail.referencePrices).toEqual({
      salePriceCad: 4_500,
      msrpCad: 25_000,
      invoicePriceCad: 3_000,
      retailPriceCad: null,
      wholesalePriceCad: 3_200,
    });
  });

  it('never hide the public details', () => {
    const detail = toVehicleDetail(row(), new Set());
    expect(detail).toMatchObject({
      horsepower: 144,
      ownerCount: 2,
      isDamaged: false,
      availability: 'IMMEDIATELY',
    });
  });
});

describe('VIN check digit', () => {
  it('matches real North American VINs and catches a single wrong character', () => {
    expect(vinCheckDigitMatches('JHLRD1871YC810608')).toBe(true);
    expect(vinCheckDigitMatches('1HGCM82633A004352')).toBe(true);
    expect(vinCheckDigitMatches('1HGCM82634A004352')).toBe(false);
    expect(vinCheckDigitMatches('11111111111111111')).toBe(true);
    expect(vinCheckDigitMatches('JHLRD1871YC81060')).toBe(false);
  });
});

describe('YouTube links', () => {
  it('reads watch, share, Shorts and embed links, and nothing else', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(youTubeVideoId(url)).toBe('dQw4w9WgXcQ');
    }
    for (const url of [
      'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://evil.example/?next=https://youtu.be/dQw4w9WgXcQ',
      'javascript:alert(1)',
      'https://www.youtube.com/watch?v=short',
    ]) {
      expect(youTubeVideoId(url)).toBeNull();
    }
  });

  it('frames the no-cookie player built from the id alone', () => {
    expect(youTubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ?autoplay=1')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
  });
});

describe('listing quality', () => {
  const complete = {
    imageCount: 20,
    description: 'x'.repeat(400),
    features: ['a', 'b', 'c', 'd', 'e'],
    vin: 'JHLRD1871YC810608',
    trim: 'SE',
    exteriorColour: 'Silver',
    interiorColour: 'Black',
    doors: 4,
    seats: 5,
    engine: '2.0L',
    ownerCount: 2,
    isDamaged: false,
  };

  it('is 100 for a complete listing and 0 for an empty one', () => {
    expect(listingQuality(complete).score).toBe(100);
    expect(listingQuality({ imageCount: 0 }).score).toBe(0);
    expect(listingQuality(complete).tips.every((tip) => tip.done)).toBe(true);
  });

  it('weighs photos at 40, description at 20 and vehicle data at 40', () => {
    expect(listingQuality({ ...complete, imageCount: 5 }).score).toBe(80);
    expect(listingQuality({ ...complete, description: '' }).score).toBe(80);
    expect(listingQuality({ ...complete, vin: null, trim: null }).score).toBe(92);
  });

  it('counts "not damaged" as an answer, and an unanswered question as missing', () => {
    expect(listingQuality({ ...complete, isDamaged: true }).score).toBe(100);
    expect(listingQuality({ ...complete, isDamaged: null }).score).toBe(96);
  });

  it('says what to add', () => {
    const tip = listingQuality({ ...complete, imageCount: 7 }).tips.find(
      (entry) => entry.area === 'PHOTOS',
    );
    expect(tip).toMatchObject({ done: false });
    expect(tip!.message).toContain('Add 3 more photos');
  });
});
