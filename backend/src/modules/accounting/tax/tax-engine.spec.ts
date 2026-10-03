import type { Province, TaxCategory } from '@vintrax/shared';
import { DEFAULT_TAX_RULES } from './tax-defaults';
import { calculateTax, effectiveRules, type TaxRuleInput } from './tax-engine';

/**
 * The tax engine against the default Canadian configuration. These pin the
 * arithmetic, not the law: the rules are data, and the expected amounts here
 * follow from the rates each default cites.
 */

function rulesFor(province: Province, date: string): Array<TaxRuleInput & { dealerId: string | null }> {
  return DEFAULT_TAX_RULES.filter(
    (rule) =>
      rule.province === province &&
      rule.effectiveFrom <= date &&
      (!rule.effectiveTo || rule.effectiveTo >= date),
  ).map((rule, index) => ({
    id: `${province}-${rule.taxType}-${index}`,
    dealerId: null,
    taxType: rule.taxType,
    rate: rule.rate,
    taxableCategories: rule.taxableCategories ?? [],
    exemptCategories: rule.exemptCategories ?? [],
    minPriceCents: rule.minPriceCents ?? null,
    maxPriceCents: rule.maxPriceCents ?? null,
    tradeInReducesBase: rule.tradeInReducesBase,
    recoverable: rule.recoverable,
    taxIncluded: false,
  }));
}

const sale = (province: Province, lines: Array<[TaxCategory, number]>, tradeInCents = 0, date = '2026-06-15') =>
  calculateTax({
    rules: rulesFor(province, date),
    lines: lines.map(([category, amountCents]) => ({ category, amountCents })),
    tradeInCents,
  });

const byType = (result: ReturnType<typeof sale>) =>
  Object.fromEntries(result.components.map((component) => [component.taxType, component.taxCents]));

describe('GST, HST, PST and QST from configuration', () => {
  it('charges GST only in Alberta and the territories', () => {
    for (const province of ['AB', 'YT', 'NT', 'NU'] as const) {
      const result = sale(province, [['VEHICLE', 2_000_000]]);
      expect(byType(result)).toEqual({ GST: 100_000 });
    }
  });

  it('charges HST at each province’s rate', () => {
    expect(byType(sale('ON', [['VEHICLE', 2_000_000]]))).toEqual({ HST: 260_000 });
    expect(byType(sale('NB', [['VEHICLE', 2_000_000]]))).toEqual({ HST: 300_000 });
    expect(byType(sale('PE', [['VEHICLE', 2_000_000]]))).toEqual({ HST: 300_000 });
  });

  it('follows Nova Scotia’s HST change on its effective date', () => {
    expect(byType(sale('NS', [['VEHICLE', 1_000_000]], 0, '2025-03-31'))).toEqual({ HST: 150_000 });
    expect(byType(sale('NS', [['VEHICLE', 1_000_000]], 0, '2025-04-01'))).toEqual({ HST: 140_000 });
  });

  it('charges GST and QST separately in Quebec, QST on the price without GST', () => {
    const result = sale('QC', [['VEHICLE', 2_000_000]]);
    expect(byType(result)).toEqual({ GST: 100_000, QST: 199_500 });
    expect(result.totalTaxCents).toBe(299_500);
  });

  it('charges GST and PST in Saskatchewan and Manitoba', () => {
    expect(byType(sale('SK', [['VEHICLE', 1_800_000]]))).toEqual({ GST: 90_000, PST: 108_000 });
    expect(byType(sale('MB', [['VEHICLE', 1_800_000]]))).toEqual({ GST: 90_000, PST: 126_000 });
  });
});

describe('trade-ins', () => {
  it('taxes the net amount where the rule says the trade-in reduces it', () => {
    // Ontario: $30,000 car, $10,000 trade-in → HST on $20,000.
    expect(byType(sale('ON', [['VEHICLE', 3_000_000]], 1_000_000))).toEqual({ HST: 260_000 });
    // Saskatchewan's own example: $18,000 less $5,000 trade → 6 % of $13,000.
    expect(byType(sale('SK', [['VEHICLE', 1_800_000]], 500_000))).toEqual({ GST: 65_000, PST: 78_000 });
  });

  it('never makes the taxable amount negative', () => {
    const result = sale('ON', [['VEHICLE', 500_000]], 900_000);
    expect(byType(result)).toEqual({ HST: 0 });
    expect(result.components[0]!.tradeInDeductedCents).toBe(500_000);
  });
});

describe('BC PST on passenger vehicles', () => {
  it('picks the rate from the price before the trade-in', () => {
    // $60,000 truck with a $25,000 trade-in: the rate is 10 % (the $60,000
    // bracket) and it applies to $35,000 → $3,500 (BC PST 308's example).
    const result = sale('BC', [['VEHICLE', 6_000_000]], 2_500_000);
    expect(byType(result)).toEqual({ GST: 175_000, PST: 350_000 });
  });

  it('uses each bracket’s rate', () => {
    const pst = (price: number) => byType(sale('BC', [['VEHICLE', price]])).PST;
    expect(pst(5_499_999)).toBe(385_000); // 7 %
    expect(pst(5_500_000)).toBe(440_000); // 8 %
    expect(pst(5_650_000)).toBe(508_500); // 9 %
    expect(pst(10_000_000)).toBe(1_000_000); // 10 %
    expect(pst(13_000_000)).toBe(1_950_000); // 15 %
    expect(pst(20_000_000)).toBe(4_000_000); // 20 %
  });

  it('taxes accessories at the general rate, separately from the vehicle', () => {
    const result = sale('BC', [
      ['VEHICLE', 3_000_000],
      ['ACCESSORIES', 100_000],
    ]);
    const pst = result.components.filter((component) => component.taxType === 'PST');
    expect(pst.map((component) => component.taxCents).sort()).toEqual([210_000, 7_000].sort());
  });
});

describe('exemptions and rounding', () => {
  it('does not tax an exempt line, and reports it as exempt', () => {
    const result = sale('ON', [
      ['VEHICLE', 1_000_000],
      ['EXEMPT', 50_000],
    ]);
    expect(byType(result)).toEqual({ HST: 130_000 });
    expect(result.components[0]!.exemptCents).toBe(50_000);
  });

  it('rounds each tax to the nearest cent, half up', () => {
    // QST 9.975 % of $10.05 = 1.002487… → $1.00; of $0.05 = 0.4987… → 0
    expect(byType(sale('QC', [['GENERAL', 1_005]])).QST).toBe(100);
    // HST 13 % of $0.50 = 6.5¢ → 7¢
    expect(byType(sale('ON', [['GENERAL', 50]])).HST).toBe(7);
  });

  it('handles a zero transaction', () => {
    expect(sale('ON', [['VEHICLE', 0]]).totalTaxCents).toBe(0);
  });

  it('extracts tax from a tax-included amount', () => {
    const result = calculateTax({
      rules: [{ ...rulesFor('ON', '2026-01-01')[0]!, taxIncluded: true }],
      lines: [{ category: 'GENERAL', amountCents: 11_300 }],
    });
    expect(result.components[0]!.taxCents).toBe(1_300);
    expect(result.components[0]!.taxableCents).toBe(10_000);
    expect(result.totalTaxCents).toBe(0); // already in the price
  });
});

describe('dealer overrides', () => {
  it('replaces the platform rule of the same type, and only that type', () => {
    const platform = rulesFor('QC', '2026-01-01');
    const dealerQst = { ...platform.find((rule) => rule.taxType === 'QST')!, id: 'mine', dealerId: 'd1', rate: '10' };
    const rules = effectiveRules([...platform, dealerQst]);
    expect(rules.map((rule) => [rule.taxType, rule.rate])).toEqual(
      expect.arrayContaining([
        ['GST', '5'],
        ['QST', '10'],
      ]),
    );
    expect(rules).toHaveLength(2);
  });
});
