import { vehicleValueQuerySchema } from '@vintrax/shared';
import {
  DEFAULT_KM_SLOPE,
  MIN_COMPARABLES,
  TRADE_IN_SHARE,
  YEAR_DEPRECIATION,
  estimateValue,
  mileageSlope,
  weightedQuantile,
  type Comparable,
} from './value-estimate';

let next = 0;
function car(year: number, mileageKm: number, priceCad: number, trim: string | null = null) {
  next += 1;
  return { id: `car-${next}`, year, mileageKm, priceCad, trim } satisfies Comparable;
}

describe('weightedQuantile', () => {
  it('is the ordinary median with equal weights', () => {
    const entries = [1, 2, 3, 4, 5].map((value) => ({ value, weight: 1 }));
    expect(weightedQuantile(entries, 0.5)).toBe(3);
  });

  it('leans toward the heavier entries', () => {
    const entries = [
      { value: 10, weight: 1 },
      { value: 20, weight: 1 },
      { value: 30, weight: 5 },
    ];
    expect(weightedQuantile(entries, 0.5)).toBe(30);
  });
});

describe('mileageSlope', () => {
  it('falls back to the default with too few cars', () => {
    expect(mileageSlope([{ mileageKm: 10_000, logPrice: 10 }])).toBe(DEFAULT_KM_SLOPE);
  });

  it('never lets kilometres add value', () => {
    const points = [20_000, 40_000, 60_000, 80_000, 100_000, 120_000].map((mileageKm) => ({
      mileageKm,
      logPrice: Math.log(20_000 + mileageKm / 10),
    }));
    expect(mileageSlope(points)).toBe(0);
  });

  it('follows the cars when they show a believable drop', () => {
    // 3 % per 10,000 km.
    const perKm = Math.log(0.97) / 10_000;
    const points = [20_000, 40_000, 60_000, 80_000, 100_000, 120_000].map((mileageKm) => ({
      mileageKm,
      logPrice: Math.log(30_000) + perKm * mileageKm,
    }));
    expect(mileageSlope(points)).toBeCloseTo(perKm, 10);
  });
});

describe('estimateValue', () => {
  it(`says nothing with fewer than ${MIN_COMPARABLES} cars`, () => {
    expect(estimateValue({ year: 2020, mileageKm: 50_000 }, [car(2020, 50_000, 25_000)])).toBe(
      null,
    );
  });

  it('values a car like the identical cars around it', () => {
    const cars = [24_000, 25_000, 26_000, 25_000, 25_500].map((price) => car(2020, 50_000, price));
    const result = estimateValue({ year: 2020, mileageKm: 50_000 }, cars)!;
    expect(result.marketValue).toBe(25_000);
    expect(result.low).toBeLessThanOrEqual(result.marketValue);
    expect(result.high).toBeGreaterThanOrEqual(result.marketValue);
    expect(result.confidence).toBe('MEDIUM');
  });

  it('values a newer car higher and an older one lower', () => {
    const cars = [25_000, 25_000, 25_000].map((price) => car(2020, 50_000, price));
    const newer = estimateValue({ year: 2021, mileageKm: 50_000 }, cars)!;
    const older = estimateValue({ year: 2019, mileageKm: 50_000 }, cars)!;
    expect(newer.marketValue).toBe(Math.round(25_000 / (1 - YEAR_DEPRECIATION) / 100) * 100);
    expect(older.marketValue).toBe(Math.round((25_000 * (1 - YEAR_DEPRECIATION)) / 100) * 100);
  });

  it('values a car with more kilometres lower', () => {
    const cars = [25_000, 25_000, 25_000].map((price) => car(2020, 50_000, price));
    const low = estimateValue({ year: 2020, mileageKm: 30_000 }, cars)!;
    const high = estimateValue({ year: 2020, mileageKm: 120_000 }, cars)!;
    expect(low.marketValue).toBeGreaterThan(25_000);
    expect(high.marketValue).toBeLessThan(25_000);
  });

  it('sets aside a listing priced wildly out of line', () => {
    const cars = [
      ...[25_000, 25_200, 24_800, 25_100].map((price) => car(2020, 50_000, price)),
      car(2020, 50_000, 1),
      car(2020, 50_000, 250_000),
    ];
    const result = estimateValue({ year: 2020, mileageKm: 50_000 }, cars)!;
    expect(result.used).toBe(4);
    expect(result.marketValue).toBeGreaterThan(24_000);
    expect(result.marketValue).toBeLessThan(26_000);
  });

  it('counts a matching trim for more', () => {
    const cars = [
      car(2020, 50_000, 30_000, 'Limited'),
      car(2020, 50_000, 30_000, 'Limited'),
      car(2020, 50_000, 24_000, 'LE'),
      car(2020, 50_000, 24_000, 'LE'),
      car(2020, 50_000, 24_000, 'LE'),
    ];
    expect(
      estimateValue({ year: 2020, mileageKm: 50_000, trim: 'limited' }, cars)!.marketValue,
    ).toBe(30_000);
    expect(estimateValue({ year: 2020, mileageKm: 50_000 }, cars)!.marketValue).toBe(24_000);
  });

  it('offers a trade-in below the market value', () => {
    const cars = [25_000, 25_000, 25_000].map((price) => car(2020, 50_000, price));
    const result = estimateValue({ year: 2020, mileageKm: 50_000 }, cars)!;
    expect(result.tradeInLow).toBe(25_000 * TRADE_IN_SHARE.low);
    expect(result.tradeInHigh).toBe(25_000 * TRADE_IN_SHARE.high);
    expect(result.tradeInHigh).toBeLessThan(result.marketValue);
  });

  it('has a range of at least 4 % either side', () => {
    const cars = [25_000, 25_000, 25_000].map((price) => car(2020, 50_000, price));
    const result = estimateValue({ year: 2020, mileageKm: 50_000 }, cars)!;
    expect(result.low).toBe(24_000);
    expect(result.high).toBe(26_000);
    expect(result.confidence).toBe('LOW');
  });
});

describe('the value query', () => {
  it('reads numbers from the query string', () => {
    const parsed = vehicleValueQuerySchema.parse({
      year: '2020',
      make: 'Toyota',
      model: 'RAV4',
      mileageKm: '50000',
    });
    expect(parsed).toMatchObject({ year: 2020, mileageKm: 50_000 });
  });

  it('refuses a missing model, negative kilometres or an unknown province', () => {
    expect(() =>
      vehicleValueQuerySchema.parse({ year: 2020, make: 'Toyota', mileageKm: 1 }),
    ).toThrow();
    expect(() =>
      vehicleValueQuerySchema.parse({ year: 2020, make: 'T', model: 'R', mileageKm: -1 }),
    ).toThrow();
    expect(() =>
      vehicleValueQuerySchema.parse({
        year: 2020,
        make: 'T',
        model: 'R',
        mileageKm: 1,
        province: 'XX',
      }),
    ).toThrow();
  });
});
