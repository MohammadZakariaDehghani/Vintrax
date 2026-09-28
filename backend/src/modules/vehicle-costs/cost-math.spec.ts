import {
  costGroupOf,
  formatCents,
  grossMarginCents,
  parseAmountToCents,
  summariseVehicleCosts,
  type CostOverviewRow,
} from '@vintrax/shared';
import { sortRows, summarise } from './vehicle-costs.service';

/** The arithmetic the cost pages show. One definition, shared by the API and the UI. */

describe('summariseVehicleCosts', () => {
  it('splits purchase, repair and other costs and totals them', () => {
    const totals = summariseVehicleCosts(
      [
        { category: 'PURCHASE', amountCents: 1_500_000 },
        { category: 'BODY_REPAIR', amountCents: 60_000 },
        { category: 'TIRES', amountCents: 80_000 },
        { category: 'LICENSING', amountCents: 12_000 },
      ],
      20_000,
    );
    expect(totals).toEqual({
      purchaseCents: 1_500_000,
      additionalCents: 152_000,
      repairCents: 140_000,
      otherCents: 12_000,
      totalCents: 1_652_000,
      grossMarginCents: 2_000_000 - 1_652_000,
    });
  });

  it('has no margin when nothing is recorded, rather than claiming the whole price', () => {
    expect(summariseVehicleCosts([], 25_000).grossMarginCents).toBeNull();
  });

  it('reports a negative margin when the car cost more than its price', () => {
    expect(grossMarginCents(10_000, 1_200_000)).toBe(-200_000);
  });

  it('adds several entries in the same category', () => {
    const totals = summariseVehicleCosts(
      [
        { category: 'PARTS', amountCents: 10_050 },
        { category: 'PARTS', amountCents: 20_025 },
      ],
      1,
    );
    expect(totals.repairCents).toBe(30_075);
  });
});

describe('cost groups', () => {
  it('counts reconditioning as repair and fees as other', () => {
    expect(costGroupOf('PURCHASE')).toBe('PURCHASE');
    expect(costGroupOf('MECHANICAL_REPAIR')).toBe('REPAIR');
    expect(costGroupOf('PARTS')).toBe('REPAIR');
    expect(costGroupOf('AUCTION_FEE')).toBe('OTHER');
    expect(costGroupOf('DETAILING')).toBe('OTHER');
  });
});

describe('amounts', () => {
  it('reads what a dealer types as exact cents', () => {
    expect(parseAmountToCents('15000')).toBe(1_500_000);
    expect(parseAmountToCents('$15,000.50')).toBe(1_500_050);
    expect(parseAmountToCents('450.7')).toBe(45_070);
    expect(parseAmountToCents('0.1')).toBe(10);
  });

  it('refuses anything it would have to guess at', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('12.345')).toBeNull();
    expect(parseAmountToCents('-5')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('1e5')).toBeNull();
  });

  it('formats cents as Canadian dollars', () => {
    expect(formatCents(1_765_000)).toBe('$17,650.00');
  });
});

function row(overrides: Partial<CostOverviewRow>): CostOverviewRow {
  return {
    vehicleId: 'v',
    title: 'Car',
    vin: null,
    stockNumber: null,
    status: 'ACTIVE',
    priceCad: 20_000,
    costCount: 1,
    costsUpdatedAt: '2026-09-01T00:00:00.000Z',
    purchaseCents: 0,
    additionalCents: 0,
    repairCents: 0,
    otherCents: 0,
    totalCents: 0,
    grossMarginCents: 0,
    ...overrides,
  };
}

describe('overview', () => {
  it('averages over costed vehicles only', () => {
    const summary = summarise('ALL', [
      row({
        vehicleId: 'a',
        purchaseCents: 1_000_000,
        totalCents: 1_000_000,
        grossMarginCents: 1_000_000,
      }),
      row({
        vehicleId: 'b',
        repairCents: 200_000,
        totalCents: 200_000,
        grossMarginCents: 1_800_000,
      }),
      row({ vehicleId: 'c', costCount: 0, costsUpdatedAt: null, grossMarginCents: null }),
    ]);
    expect(summary).toMatchObject({
      vehicleCount: 3,
      costedVehicleCount: 2,
      totalCostCents: 1_200_000,
      repairCents: 200_000,
      averageCostCents: 600_000,
      averageGrossMarginCents: (2_000_000 * 2 - 1_200_000) / 2,
    });
  });

  it('sorts uncosted vehicles after costed ones whichever way margin is ordered', () => {
    const rows = [
      row({ vehicleId: 'none', grossMarginCents: null, costCount: 0 }),
      row({ vehicleId: 'low', grossMarginCents: 100 }),
      row({ vehicleId: 'high', grossMarginCents: 900 }),
    ];
    expect(sortRows(rows, 'margin_asc').map((r) => r.vehicleId)).toEqual(['low', 'high', 'none']);
    expect(sortRows(rows, 'margin_desc').map((r) => r.vehicleId)).toEqual(['high', 'low', 'none']);
  });
});
