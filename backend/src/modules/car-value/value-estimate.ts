/**
 * The arithmetic behind "Check your car's value", kept apart from the
 * database so it can be pinned by tests.
 *
 * The method is the one a dealer's appraiser uses, made mechanical: find cars
 * of the same make and model near the visitor's year, move each one's price to
 * what it would be at the visitor's year and kilometres, and take the middle
 * of those adjusted prices. Closer cars count for more.
 */

export interface Comparable {
  id: string;
  year: number;
  mileageKm: number;
  priceCad: number;
  trim: string | null;
}

export interface ValueTarget {
  year: number;
  mileageKm: number;
  trim?: string | null;
}

export interface ValueResult {
  marketValue: number;
  low: number;
  high: number;
  tradeInLow: number;
  tradeInHigh: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** How many cars the figure rests on, after outliers were set aside. */
  used: number;
}

/** Fewer comparable cars than this and the tool says so rather than guess. */
export const MIN_COMPARABLES = 3;

/** A used car loses roughly this share of its value with each year of age. */
export const YEAR_DEPRECIATION = 0.07;

/**
 * What 10,000 km does to a price when the comparables cannot say for
 * themselves: about 2.5 %. As a slope on the log of the price, per kilometre.
 */
export const DEFAULT_KM_SLOPE = Math.log(1 - 0.025) / 10_000;

/** The fitted slope is kept between no effect and 7 % per 10,000 km. */
const STEEPEST_KM_SLOPE = Math.log(1 - 0.07) / 10_000;

/** Adjustments stop here: a car six years or 150,000 km away says little. */
const MAX_YEAR_GAP = 3;
const MAX_KM_GAP = 150_000;

/** A dealer's trade-in offer, as a share of what it would list the car at. */
export const TRADE_IN_SHARE = { low: 0.8, high: 0.9 } as const;

const roundTo100 = (value: number) => Math.round(value / 100) * 100;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** The value below which `share` of the total weight lies. */
export function weightedQuantile(
  entries: ReadonlyArray<{ value: number; weight: number }>,
  share: number,
): number {
  const sorted = [...entries].filter((entry) => entry.weight > 0).sort((a, b) => a.value - b.value);
  if (sorted.length === 0) return 0;
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  const goal = share * total;
  let running = 0;
  for (const entry of sorted) {
    running += entry.weight;
    if (running >= goal) return entry.value;
  }
  return sorted[sorted.length - 1]!.value;
}

/**
 * How price falls with kilometres among these cars, as a slope on the log of
 * the price. Fitted by least squares when there are enough cars with enough
 * spread in kilometres to fit it, otherwise the default. The fit is kept to a
 * believable range so a handful of odd listings cannot make kilometres add value.
 */
export function mileageSlope(points: ReadonlyArray<{ mileageKm: number; logPrice: number }>) {
  if (points.length < 6) return DEFAULT_KM_SLOPE;
  const meanKm = points.reduce((sum, p) => sum + p.mileageKm, 0) / points.length;
  const meanLog = points.reduce((sum, p) => sum + p.logPrice, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.mileageKm - meanKm) * (point.logPrice - meanLog);
    variance += (point.mileageKm - meanKm) ** 2;
  }
  // Under about 15,000 km of spread the slope is mostly noise.
  if (variance / points.length < 15_000 ** 2) return DEFAULT_KM_SLOPE;
  return clamp(covariance / variance, STEEPEST_KM_SLOPE, 0);
}

function sameTrim(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/**
 * The estimate, or null when there are too few comparable cars.
 *
 * 1. Each car's price is moved to the visitor's model year, at
 *    `YEAR_DEPRECIATION` a year.
 * 2. Kilometres are then adjusted along a slope fitted to these cars.
 * 3. Adjusted prices more than half again away from the median are set aside
 *    as listings priced in error or for a reason the data does not show.
 * 4. The market value is the weighted median; the range is the weighted
 *    middle half, never narrower than 4 % either side. A car counts for more
 *    the closer it is in year and kilometres, and twice as much for the same trim.
 */
export function estimateValue(
  target: ValueTarget,
  comparables: readonly Comparable[],
): ValueResult | null {
  const usable = comparables.filter(
    (car) => car.priceCad > 0 && Number.isFinite(car.priceCad) && car.mileageKm >= 0,
  );
  if (usable.length < MIN_COMPARABLES) return null;

  const yearAdjusted = usable.map((car) => {
    const gap = clamp(target.year - car.year, -MAX_YEAR_GAP, MAX_YEAR_GAP);
    const price =
      gap >= 0
        ? car.priceCad / Math.pow(1 - YEAR_DEPRECIATION, gap)
        : car.priceCad * Math.pow(1 - YEAR_DEPRECIATION, -gap);
    return { car, price };
  });

  const slope = mileageSlope(
    yearAdjusted.map(({ car, price }) => ({ mileageKm: car.mileageKm, logPrice: Math.log(price) })),
  );

  const adjusted = yearAdjusted.map(({ car, price }) => {
    const kmGap = clamp(target.mileageKm - car.mileageKm, -MAX_KM_GAP, MAX_KM_GAP);
    const value = price * Math.exp(slope * kmGap);
    const weight =
      (1 / (1 + Math.abs(target.year - car.year))) *
      (1 / (1 + Math.abs(target.mileageKm - car.mileageKm) / 50_000)) *
      (sameTrim(target.trim, car.trim) ? 2 : 1);
    return { value, weight };
  });

  const median = weightedQuantile(adjusted, 0.5);
  const kept = adjusted.filter(
    (entry) => entry.value >= median / 1.5 && entry.value <= median * 1.5,
  );
  if (kept.length < MIN_COMPARABLES) return null;

  const marketValue = weightedQuantile(kept, 0.5);
  const low = Math.min(weightedQuantile(kept, 0.25), marketValue * 0.96);
  const high = Math.max(weightedQuantile(kept, 0.75), marketValue * 1.04);

  const closeCount = usable.filter((car) => Math.abs(car.year - target.year) <= 1).length;
  const confidence: ValueResult['confidence'] =
    kept.length >= 12 && closeCount >= 8 ? 'HIGH' : kept.length >= 5 ? 'MEDIUM' : 'LOW';

  return {
    marketValue: roundTo100(marketValue),
    low: roundTo100(low),
    high: roundTo100(high),
    tradeInLow: roundTo100(marketValue * TRADE_IN_SHARE.low),
    tradeInHigh: roundTo100(marketValue * TRADE_IN_SHARE.high),
    confidence,
    used: kept.length,
  };
}
