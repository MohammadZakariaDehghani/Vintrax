import type { Province, TaxCategory, TaxType } from '@vintrax/shared';

/**
 * The platform's default sales-tax configuration, installed as data by the
 * migration `20261008000100_accounting_tax_defaults` (generated from this
 * list). After that the database is the source of truth: rates change through
 * the Tax Center (a new version from an effective date), never by editing
 * this file. Kept here so the defaults are reviewable and testable.
 *
 * This is configuration, not tax advice. Each rule cites where it came from;
 * a dealer and their accountant confirm what applies to them.
 *
 * Sources (checked October 2026):
 * - GST/HST rates by province: CRA, "GST/HST calculator (and rates)"
 *   https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html
 * - Nova Scotia HST 15% → 14% from April 1, 2025: CRA Notice 342 and
 *   https://news.novascotia.ca/en/2025/03/31/province-lowers-hst-raises-income-thresholds-nova-scotians
 * - Trade-ins under GST/HST (tax on the net amount when the trade-in comes
 *   from a non-registrant): Excise Tax Act s. 153(4); CRA Notice of Change TIB B-084.
 * - BC PST on passenger vehicles from dealers (7/8/9/10 %, and 15/20 % from
 *   $125,000/$150,000; rate set by the price before trade-in, tax on the price
 *   after it): BC Bulletin PST 308 "Vehicles" (rev. March 2025) and Notice 2018-003.
 * - Saskatchewan PST 6 % (dealer used-vehicle sales taxable since April 11,
 *   2018; trade-in deducted when tax was paid on it): Saskatchewan PST-78 / PST-18.
 * - Manitoba RST 7 % (trade-in deducted for vehicles of the same general kind):
 *   Manitoba Finance, Retail Sales Tax and Bulletin 012.
 * - Quebec QST 9.975 % on the price excluding GST; trade-in credit reduces the
 *   amount (for used vehicles QST is on the greater of the price and the
 *   estimated value — not modelled): Revenu Québec, "Basic Rules for Applying
 *   the GST/HST and QST" and "Trade-In of a Road Vehicle Between an Individual and a Dealer".
 */

export interface DefaultTaxRule {
  province: Province;
  taxType: TaxType;
  name: string;
  rate: string;
  effectiveFrom: string;
  effectiveTo?: string;
  taxableCategories?: TaxCategory[];
  exemptCategories?: TaxCategory[];
  minPriceCents?: number;
  maxPriceCents?: number;
  tradeInReducesBase: boolean;
  recoverable: boolean;
  source: string;
  notes?: string;
}

const CRA_RATES =
  'CRA — GST/HST calculator (and rates): https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html';
const BC_PST_308 =
  'BC Bulletin PST 308, Vehicles (rev. March 2025): https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-308-vehicles.pdf';

const GST_ONLY: Province[] = ['AB', 'BC', 'MB', 'NT', 'NU', 'QC', 'SK', 'YT'];

export const DEFAULT_TAX_RULES: readonly DefaultTaxRule[] = [
  ...GST_ONLY.map((province): DefaultTaxRule => ({
    province,
    taxType: 'GST',
    name: 'GST',
    rate: '5',
    effectiveFrom: '2008-01-01',
    tradeInReducesBase: true,
    recoverable: true,
    source: CRA_RATES,
  })),
  {
    province: 'ON',
    taxType: 'HST',
    name: 'HST (Ontario)',
    rate: '13',
    effectiveFrom: '2010-07-01',
    tradeInReducesBase: true,
    recoverable: true,
    source: CRA_RATES,
  },
  {
    province: 'NB',
    taxType: 'HST',
    name: 'HST (New Brunswick)',
    rate: '15',
    effectiveFrom: '2016-07-01',
    tradeInReducesBase: true,
    recoverable: true,
    source: CRA_RATES,
  },
  {
    province: 'NL',
    taxType: 'HST',
    name: 'HST (Newfoundland and Labrador)',
    rate: '15',
    effectiveFrom: '2016-07-01',
    tradeInReducesBase: true,
    recoverable: true,
    source: CRA_RATES,
  },
  {
    province: 'PE',
    taxType: 'HST',
    name: 'HST (Prince Edward Island)',
    rate: '15',
    effectiveFrom: '2016-10-01',
    tradeInReducesBase: true,
    recoverable: true,
    source: CRA_RATES,
  },
  {
    province: 'NS',
    taxType: 'HST',
    name: 'HST (Nova Scotia)',
    rate: '15',
    effectiveFrom: '2010-07-01',
    effectiveTo: '2025-03-31',
    tradeInReducesBase: true,
    recoverable: true,
    source: CRA_RATES,
  },
  {
    province: 'NS',
    taxType: 'HST',
    name: 'HST (Nova Scotia)',
    rate: '14',
    effectiveFrom: '2025-04-01',
    tradeInReducesBase: true,
    recoverable: true,
    source: `${CRA_RATES}; CRA Notice 342 (Nova Scotia HST rate decrease)`,
  },
  {
    province: 'QC',
    taxType: 'QST',
    name: 'QST',
    rate: '9.975',
    effectiveFrom: '2013-01-01',
    tradeInReducesBase: true,
    recoverable: true,
    source:
      'Revenu Québec — Basic Rules for Applying the GST/HST and QST: https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/',
    notes:
      'For used vehicles QST applies to the greater of the sale price and the estimated value; that rule is not modelled.',
  },
  // BC PST on passenger vehicles bought from a dealer: graduated by price.
  ...(
    [
      [0, 5_499_999, '7'],
      [5_500_000, 5_599_999, '8'],
      [5_600_000, 5_699_999, '9'],
      [5_700_000, 12_499_999, '10'],
      [12_500_000, 14_999_999, '15'],
      [15_000_000, null, '20'],
    ] as const
  ).map(([min, max, rate]): DefaultTaxRule => ({
    province: 'BC',
    taxType: 'PST',
    name: `PST on vehicles (${rate}%)`,
    rate,
    effectiveFrom: '2018-04-01',
    taxableCategories: ['VEHICLE', 'FEES'],
    minPriceCents: min,
    ...(max === null ? {} : { maxPriceCents: max }),
    tradeInReducesBase: true,
    recoverable: false,
    source: `${BC_PST_308}; BC Notice 2018-003`,
    notes:
      'Passenger vehicles. The rate is set by the purchase price before the trade-in; tax applies to the price after it.',
  })),
  {
    province: 'BC',
    taxType: 'PST',
    name: 'PST (general)',
    rate: '7',
    effectiveFrom: '2013-04-01',
    taxableCategories: ['ACCESSORIES', 'PARTS', 'GENERAL', 'SERVICE', 'WARRANTY'],
    tradeInReducesBase: false,
    recoverable: false,
    source: 'BC Provincial Sales Tax Act; https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst',
  },
  {
    province: 'SK',
    taxType: 'PST',
    name: 'PST (Saskatchewan)',
    rate: '6',
    effectiveFrom: '2018-04-11',
    tradeInReducesBase: true,
    recoverable: false,
    source:
      'Saskatchewan Ministry of Finance, PST-78 and PST-18: https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax',
    notes: 'A trade-in is deducted when Saskatchewan tax was paid on it.',
  },
  {
    province: 'MB',
    taxType: 'PST',
    name: 'RST (Manitoba)',
    rate: '7',
    effectiveFrom: '2019-07-01',
    tradeInReducesBase: true,
    recoverable: false,
    source:
      'Manitoba Finance, Retail Sales Tax: https://www.gov.mb.ca/finance/taxation/taxes/retail.html; Bulletin 012',
    notes: 'A trade-in is deducted for vehicles of the same general kind.',
  },
];

/** SQL for the data migration, so the defaults are data from day one. */
export function defaultTaxRulesSql(): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const array = (values: readonly string[] | undefined) =>
    values && values.length > 0
      ? `ARRAY[${values.map(quote).join(', ')}]::text[]`
      : `ARRAY[]::text[]`;
  const rows = DEFAULT_TAX_RULES.map(
    (rule) =>
      `(gen_random_uuid(), NULL, ${quote(rule.province)}::"Province", ${quote(rule.taxType)}::"TaxType", ${quote(rule.name)}, ${rule.rate}, ` +
      `DATE ${quote(rule.effectiveFrom)}, ${rule.effectiveTo ? `DATE ${quote(rule.effectiveTo)}` : 'NULL'}, false, ` +
      `${array(rule.taxableCategories)}, ${array(rule.exemptCategories)}, ` +
      `${rule.minPriceCents ?? 'NULL'}, ${rule.maxPriceCents ?? 'NULL'}, ${rule.tradeInReducesBase}, ${rule.recoverable}, ` +
      `${rule.notes ? `jsonb_build_object('notes', ${quote(rule.notes)})` : 'NULL'}, ${quote(rule.source)}, true, 1, NOW(), NOW())`,
  );
  return (
    `INSERT INTO "TaxRule" ("id", "dealerId", "province", "taxType", "name", "rate", "effectiveFrom", "effectiveTo", "taxIncluded", ` +
    `"taxableCategories", "exemptCategories", "minPriceCents", "maxPriceCents", "tradeInReducesBase", "recoverable", "metadata", "source", ` +
    `"isActive", "version", "createdAt", "updatedAt") VALUES\n  ${rows.join(',\n  ')};\n`
  );
}
