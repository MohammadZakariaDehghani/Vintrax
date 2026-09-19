/**
 * Grouping a seller's free-typed feature list for the comparison table.
 *
 * `VehicleDetail.features` is plain text a seller typed — there is no fixed
 * catalogue behind it, so "Heated Seats" and "heated seat" are two different
 * strings as far as the data model is concerned. Categorising an arbitrary
 * string therefore has to be a best-effort keyword match, not a lookup, and
 * a feature matching none of the keywords below still has to be shown
 * somewhere rather than silently dropped — that is what `OTHER_CATEGORY` is.
 *
 * The categories mirror the ones a shopper actually asks about; "Performance"
 * is deliberately not one of them here, even though it is a common category
 * name in this space, because engine, transmission, drivetrain and fuel type
 * are already their own rows in the main specification table (real,
 * structured `Vehicle` fields) — repeating them as "features" would compare
 * the same fact twice under two different sections.
 */

export const OTHER_CATEGORY = 'Other';

const FEATURE_CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Comfort & Convenience': [
    'heated seat',
    'ventilated seat',
    'cooled seat',
    'power seat',
    'memory seat',
    'leather seat',
    'leather interior',
    'keyless entry',
    'keyless start',
    'push button start',
    'remote start',
    'cruise control',
    'adaptive cruise',
    'air conditioning',
    'climate control',
    'dual zone climate',
    'heated steering wheel',
    'power liftgate',
    'power tailgate',
    'third row seat',
  ],
  Technology: [
    'bluetooth',
    'apple carplay',
    'android auto',
    'navigation',
    'gps',
    'premium audio',
    'sound system',
    'backup camera',
    'rear camera',
    'rear view camera',
    '360 camera',
    'surround view',
    'touchscreen',
    'satellite radio',
    'wifi hotspot',
    'wireless charging',
    'usb port',
  ],
  Safety: [
    'blind spot',
    'lane departure',
    'lane keep',
    'lane assist',
    'forward collision',
    'automatic emergency braking',
    'collision warning',
    'parking sensor',
    'stability control',
    'traction control',
    'airbag',
    'adaptive headlight',
    'tire pressure monitor',
  ],
  Exterior: [
    'sunroof',
    'moonroof',
    'panoramic roof',
    'alloy wheel',
    'fog light',
    'led headlight',
    'roof rack',
    'running board',
    'tow package',
    'trailer hitch',
    'power liftgate',
  ],
};

/** Category names in the order they should be shown, `OTHER_CATEGORY` always last. */
export const FEATURE_CATEGORY_ORDER = [...Object.keys(FEATURE_CATEGORY_KEYWORDS), OTHER_CATEGORY];

function categoryFor(feature: string): string {
  const lower = feature.toLowerCase();
  for (const [category, keywords] of Object.entries(FEATURE_CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return category;
  }
  return OTHER_CATEGORY;
}

export interface FeatureCategoryGroup {
  category: string;
  features: string[];
}

/**
 * Groups a set of feature names into categories, omitting any category none
 * of them matched — "only show categories relevant to the selected
 * vehicles," per the feature this exists for. Order is fixed regardless of
 * input order, so the same groups always print in the same place.
 */
export function categorizeFeatures(features: string[]): FeatureCategoryGroup[] {
  const byCategory = new Map<string, string[]>();
  for (const feature of features) {
    const category = categoryFor(feature);
    const existing = byCategory.get(category);
    if (existing) existing.push(feature);
    else byCategory.set(category, [feature]);
  }

  return FEATURE_CATEGORY_ORDER.map((category) => ({
    category,
    features: byCategory.get(category) ?? [],
  })).filter((group) => group.features.length > 0);
}
