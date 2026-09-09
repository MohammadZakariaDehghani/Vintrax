import { BODY_TYPES, type BodyType, type BodyTypeImage, type VehicleSummary } from '@atlas/shared';

/**
 * A body-type shortcut on the home page: the picture, and how many are listed.
 *
 * `imageUrl` null means neither an administrator nor live inventory supplied a
 * photograph, and the drawn silhouette stands in.
 */
export interface BodyTypeShortcut {
  bodyType: BodyType;
  imageUrl: string | null;
  /** Set only when an administrator gave the photo one. */
  alt: string | null;
  count: number;
}

/**
 * Builds the row from the enum, not from what happens to be in stock.
 *
 * Three sources for the picture, in order of how much say a person had in it:
 * what an administrator chose, then the newest photographed listing of that
 * shape, then nothing — which the component draws as a silhouette. Falling
 * through rather than requiring the first means the row works on a fresh
 * install and improves as it is used.
 *
 * The enum is the driver because facets only carry body types something is
 * listed under. Building the row from facets silently dropped the photograph
 * for any shape with nothing in stock: a van uploaded through the admin screen
 * and then ignored here, with no error anywhere to say why. The row always
 * renders all nine, so the data behind it has to cover all nine.
 */
export function buildBodyTypeShortcuts({
  curated = [],
  vehicles = [],
  counts = [],
}: {
  curated?: BodyTypeImage[];
  vehicles?: VehicleSummary[];
  counts?: Array<{ value: BodyType; count: number }>;
}): BodyTypeShortcut[] {
  const byType = new Map(curated.map((entry) => [entry.bodyType, entry]));
  const byCount = new Map(counts.map((entry) => [entry.value, entry.count]));

  return BODY_TYPES.map((bodyType) => ({
    bodyType,
    imageUrl:
      byType.get(bodyType)?.imageUrl ??
      vehicles.find((vehicle) => vehicle.bodyType === bodyType && vehicle.primaryImageUrl)
        ?.primaryImageUrl ??
      null,
    alt: byType.get(bodyType)?.alt ?? null,
    count: byCount.get(bodyType) ?? 0,
  }));
}
