import { describe, expect, it } from 'vitest';
import type { VehicleDetail } from '@vintrax/shared';
import { buildCompareSpecs } from './compare-specs';

function vehicle(overrides: Partial<VehicleDetail> = {}): VehicleDetail {
  return {
    year: 2018,
    make: 'Honda',
    model: 'CR-V',
    trim: 'EX',
    priceCad: 24_995,
    mileageKm: 62_000,
    condition: 'USED',
    bodyType: 'SUV',
    transmission: 'AUTOMATIC',
    drivetrain: 'AWD',
    fuelType: 'GASOLINE',
    engine: '1.5L Turbo',
    cylinders: 4,
    doors: 4,
    seats: 5,
    exteriorColour: 'Modern Steel',
    interiorColour: 'Black',
    titleStatus: null,
    stockNumber: null,
    ...overrides,
  } as unknown as VehicleDetail;
}

describe('buildCompareSpecs', () => {
  it('reads the real fields off each vehicle, not placeholder values', () => {
    const rows = buildCompareSpecs([vehicle({ make: 'Toyota', model: 'RAV4' })]);

    expect(rows.find((row) => row.label === 'Make')?.values).toEqual(['Toyota']);
    expect(rows.find((row) => row.label === 'Model')?.values).toEqual(['RAV4']);
  });

  it('formats price and mileage the same way the vehicle detail page does', () => {
    const rows = buildCompareSpecs([vehicle({ priceCad: 24_995, mileageKm: 62_000 })]);

    expect(rows.find((row) => row.label === 'Price')?.values).toEqual(['$24,995']);
    expect(rows.find((row) => row.label === 'Mileage')?.values).toEqual(['62,000 km']);
  });

  it('marks a row as identical when every vehicle agrees', () => {
    const rows = buildCompareSpecs([vehicle({ transmission: 'AUTOMATIC' }), vehicle({ transmission: 'AUTOMATIC' })]);

    expect(rows.find((row) => row.label === 'Transmission')?.differs).toBe(false);
  });

  it('marks a row as differing when the vehicles disagree', () => {
    const rows = buildCompareSpecs([
      vehicle({ transmission: 'AUTOMATIC' }),
      vehicle({ transmission: 'MANUAL' }),
    ]);

    const transmission = rows.find((row) => row.label === 'Transmission');
    expect(transmission?.differs).toBe(true);
    expect(transmission?.values).toEqual(['Automatic', 'Manual']);
  });

  /**
   * A blank field is a fact about the form, not a claim about the car — the
   * same reasoning `vehicleFacts` uses. "Not stated" must never look like
   * every vehicle happening to share an empty string.
   */
  it('prints an unset optional field as "Not stated" rather than leaving it blank', () => {
    const rows = buildCompareSpecs([vehicle({ trim: null })]);

    expect(rows.find((row) => row.label === 'Trim')?.values).toEqual(['Not stated']);
  });

  it('never marks a row as differing with only one vehicle selected', () => {
    const rows = buildCompareSpecs([vehicle()]);

    expect(rows.every((row) => !row.differs)).toBe(true);
  });

  it('returns one column per vehicle for every row', () => {
    const rows = buildCompareSpecs([vehicle(), vehicle(), vehicle()]);

    expect(rows.every((row) => row.values.length === 3)).toBe(true);
  });
});
