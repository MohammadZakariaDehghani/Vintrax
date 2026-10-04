import type { TaxCategory, TaxType } from '@vintrax/shared';
import { applyRate, extractIncludedTax, rateToScaled, sumCents } from '../core/money';

/**
 * The tax calculation, as a pure function of configured rules.
 *
 * No rate lives here. The caller loads the rules in force for the province
 * and date (see TaxService.rulesFor) and this decides, for each rule, what
 * part of the transaction it taxes and how much tax that is. Every component
 * is returned separately — GST, PST, QST, HST — never one blended "tax".
 */

export interface TaxRuleInput {
  id: string;
  taxType: TaxType;
  /** Percent as an exact decimal string, e.g. "9.975". */
  rate: string;
  taxableCategories: readonly string[];
  exemptCategories: readonly string[];
  /** Graduated rules (BC PST on passenger vehicles) apply in a price range. */
  minPriceCents: number | null;
  maxPriceCents: number | null;
  tradeInReducesBase: boolean;
  recoverable: boolean;
  taxIncluded: boolean;
}

export interface TaxableLine {
  category: TaxCategory;
  amountCents: number;
}

export interface TaxCalculationInput {
  rules: readonly TaxRuleInput[];
  lines: readonly TaxableLine[];
  /** Trade-in allowance, which may reduce the taxable amount. */
  tradeInCents?: number;
  /**
   * The vehicle's price before any trade-in, for choosing a graduated rate.
   * Defaults to the sum of the VEHICLE lines.
   */
  vehiclePriceCents?: number;
}

export interface TaxComponent {
  ruleId: string;
  taxType: TaxType;
  rate: string;
  /** What the rate was applied to, after any trade-in reduction. */
  taxableCents: number;
  /** Lines this rule did not tax (exempt or outside its categories). */
  exemptCents: number;
  /** Trade-in actually deducted from this component's base. */
  tradeInDeductedCents: number;
  taxCents: number;
  recoverable: boolean;
}

export interface TaxCalculation {
  components: TaxComponent[];
  totalTaxCents: number;
  /** The subtotal before tax and before trade-in. */
  grossCents: number;
}

export function ruleTaxesCategory(rule: TaxRuleInput, category: TaxCategory): boolean {
  if (category === 'EXEMPT') return false;
  if (rule.exemptCategories.includes(category)) return false;
  return rule.taxableCategories.length === 0 || rule.taxableCategories.includes(category);
}

export function ruleMatchesPrice(rule: TaxRuleInput, vehiclePriceCents: number): boolean {
  if (rule.minPriceCents !== null && vehiclePriceCents < rule.minPriceCents) return false;
  if (rule.maxPriceCents !== null && vehiclePriceCents > rule.maxPriceCents) return false;
  return true;
}

export function calculateTax(input: TaxCalculationInput): TaxCalculation {
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents < 0) {
      throw new Error('Taxable amounts must be non-negative whole cents');
    }
  }
  const gross = sumCents(input.lines.map((line) => line.amountCents));
  const vehiclePrice =
    input.vehiclePriceCents ??
    sumCents(
      input.lines.filter((line) => line.category === 'VEHICLE').map((line) => line.amountCents),
    );
  const tradeIn = Math.max(0, input.tradeInCents ?? 0);

  const components: TaxComponent[] = [];
  for (const rule of input.rules) {
    const graduated = rule.minPriceCents !== null || rule.maxPriceCents !== null;
    if (graduated && !ruleMatchesPrice(rule, vehiclePrice)) continue;

    const taxedLines = input.lines.filter((line) => ruleTaxesCategory(rule, line.category));
    const before = sumCents(taxedLines.map((line) => line.amountCents));
    if (before === 0) continue;

    const deducted = rule.tradeInReducesBase ? Math.min(tradeIn, before) : 0;
    const base = before - deducted;
    const scaled = rateToScaled(rule.rate);

    let taxCents: number;
    let taxableCents: number;
    if (rule.taxIncluded) {
      taxCents = extractIncludedTax(base, scaled);
      taxableCents = base - taxCents;
    } else {
      taxCents = applyRate(base, scaled);
      taxableCents = base;
    }

    components.push({
      ruleId: rule.id,
      taxType: rule.taxType,
      rate: rule.rate,
      taxableCents,
      exemptCents: gross - before,
      tradeInDeductedCents: deducted,
      taxCents,
      recoverable: rule.recoverable,
    });
  }

  return {
    components,
    totalTaxCents: sumCents(
      components.filter((c) => !isIncluded(c, input.rules)).map((c) => c.taxCents),
    ),
    grossCents: gross,
  };
}

/** Tax already inside the price is not added on top. */
function isIncluded(component: TaxComponent, rules: readonly TaxRuleInput[]): boolean {
  return rules.find((rule) => rule.id === component.ruleId)?.taxIncluded ?? false;
}

/**
 * Picks the rules in force: a dealer's own rules for a (province, tax type)
 * replace the platform defaults for that pair entirely.
 */
export function effectiveRules<T extends TaxRuleInput & { dealerId: string | null }>(
  rules: readonly T[],
): T[] {
  const dealerTypes = new Set(rules.filter((rule) => rule.dealerId).map((rule) => rule.taxType));
  return rules.filter((rule) => (rule.dealerId ? true : !dealerTypes.has(rule.taxType)));
}
