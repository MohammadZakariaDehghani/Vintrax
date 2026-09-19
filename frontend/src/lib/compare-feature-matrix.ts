import type { VehicleDetail } from '@vintrax/shared';
import { categorizeFeatures } from '@/lib/compare-feature-categories';

/** One feature's row in the comparison table. */
export interface CompareFeatureRow {
  feature: string;
  /** One entry per vehicle, in the same order the vehicles were passed in. */
  present: boolean[];
}

export interface CompareFeatureCategoryGroup {
  category: string;
  rows: CompareFeatureRow[];
}

/**
 * The feature-by-feature comparison, grouped into categories.
 *
 * The feature list is the union of every selected vehicle's own typed
 * `features` array — there is no fixed catalogue to enumerate instead, only
 * whatever each seller actually wrote. `present` records whether a given
 * feature string appears in a given vehicle's own list; it is "not listed"
 * when it does not, never a confirmed "does not have this". Nothing in
 * `VehicleDetail` distinguishes a seller who checked and left a feature off
 * on purpose from one who simply did not mention it, so this does not assert
 * the stronger claim the data cannot support — the table's own legend says
 * "not listed", not "not available", for the same reason.
 */
export function buildFeatureCategoryMatrix(vehicles: VehicleDetail[]): CompareFeatureCategoryGroup[] {
  const union = Array.from(new Set(vehicles.flatMap((vehicle) => vehicle.features)));
  const presentByFeature = new Map<string, boolean[]>(
    union.map((feature) => [feature, vehicles.map((vehicle) => vehicle.features.includes(feature))]),
  );

  return categorizeFeatures(union).map((group) => ({
    category: group.category,
    rows: group.features.map((feature) => ({
      feature,
      present: presentByFeature.get(feature) ?? [],
    })),
  }));
}
