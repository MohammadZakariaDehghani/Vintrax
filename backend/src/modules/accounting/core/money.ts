import { Prisma } from '@prisma/client';

/**
 * Money inside the accounting module is integer cents (a JS number). It is
 * stored as NUMERIC(15,2) and crosses the database boundary through these two
 * functions only, which convert via strings — never by multiplying a float.
 *
 * The largest amount the schemas accept is $10 billion (1e12 cents), and a
 * sum of a few thousand of those stays far below 2^53, so plain number
 * arithmetic on cents is exact everywhere it is used.
 */

/** Prisma Decimal (or its string form) → integer cents. */
export function toCents(value: Prisma.Decimal | string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'string' ? value : value.toString();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`Not a decimal amount: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new Error(`Amount has more than two decimals: ${text}`);
  }
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  return sign ? -cents : cents;
}

/** Integer cents → a Prisma Decimal for a NUMERIC(15,2) column. */
export function fromCents(cents: number): Prisma.Decimal {
  if (!Number.isSafeInteger(cents)) throw new Error(`Cents must be an integer: ${cents}`);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return new Prisma.Decimal(text);
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** A rate kept as a percentage string ("9.975") → integer hundred-thousandths of a percent. */
export function rateToScaled(rate: Prisma.Decimal | string | number): bigint {
  const text = typeof rate === 'string' ? rate : rate.toString();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`Not a rate: ${text}`);
  const [, whole, fraction = ''] = match;
  if (fraction.length > 5 && /[1-9]/.test(fraction.slice(5))) {
    throw new Error(`Rate has more than five decimals: ${text}`);
  }
  return BigInt(whole!) * 100_000n + BigInt(fraction.slice(0, 5).padEnd(5, '0'));
}

/** RATE_SCALE × 100 %: a scaled rate of RATE_SCALE * 100 is 100 %. */
export const RATE_SCALE = 100_000n;
const PERCENT_SCALE = RATE_SCALE * 100n;

/** cents × rate, rounded half away from zero to a whole cent. */
export function applyRate(cents: number, scaledRate: bigint): number {
  const product = BigInt(cents) * scaledRate;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs * 2n + PERCENT_SCALE) / (2n * PERCENT_SCALE);
  return Number(negative ? -rounded : rounded);
}

/**
 * The tax inside a tax-included amount: cents − cents / (1 + rate), with the
 * pre-tax part rounded to the cent first.
 */
export function extractIncludedTax(cents: number, scaledRate: bigint): number {
  const denominator = PERCENT_SCALE + scaledRate;
  const numerator = BigInt(cents) * PERCENT_SCALE;
  const base = (numerator * 2n + denominator) / (2n * denominator);
  return cents - Number(base);
}

/**
 * Splits `total` in proportion to `weights`, to the cent, so the parts always
 * add up to the total exactly (largest-remainder method).
 */
export function allocateCents(total: number, weights: readonly number[]): number[] {
  const weightSum = sumCents(weights);
  if (weightSum === 0) return weights.map((_, index) => (index === 0 ? total : 0));
  const raw = weights.map((weight) => (BigInt(total) * BigInt(weight)) / BigInt(weightSum));
  const parts = raw.map((value) => Number(value));
  let remainder = total - sumCents(parts);
  const order = weights
    .map((weight, index) => ({
      index,
      fraction: Number((BigInt(total) * BigInt(weight)) % BigInt(weightSum)),
    }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) {
    if (remainder === 0) break;
    parts[index]! += remainder > 0 ? 1 : -1;
    remainder += remainder > 0 ? -1 : 1;
  }
  return parts;
}
