import { BODY_TYPES, type BodyType, type BodyTypeImage } from '@vintrax/shared';

/**
 * A body-type shortcut on the home page: the icon, and how many are listed.
 *
 * `imageUrl` null means no administrator uploaded an image for that shape, and
 * the drawn silhouette stands in.
 */
export interface BodyTypeShortcut {
  bodyType: BodyType;
  imageUrl: string | null;
  /** Set only when an administrator gave the image one. */
  alt: string | null;
  count: number;
}

/**
 * Builds the row from the enum, not from what happens to be in stock.
 *
 * The shortcuts are icons, drawn without a frame: the image an administrator
 * uploaded for a shape (cut out of its backdrop when it was uploaded), or the
 * drawn silhouette. A listing's photograph is no longer borrowed for a shape
 * without one — it is a car in a car park, with a background no icon can
 * lose.
 *
 * The enum is the driver because facets only carry body types something is
 * listed under. Building the row from facets silently dropped the image for
 * any shape with nothing in stock: a van uploaded through the admin screen
 * and then ignored here, with no error anywhere to say why. The row always
 * renders all nine, so the data behind it has to cover all nine.
 */
export function buildBodyTypeShortcuts({
  curated = [],
  counts = [],
}: {
  curated?: BodyTypeImage[];
  counts?: Array<{ value: BodyType; count: number }>;
}): BodyTypeShortcut[] {
  const byType = new Map(curated.map((entry) => [entry.bodyType, entry]));
  const byCount = new Map(counts.map((entry) => [entry.value, entry.count]));

  return BODY_TYPES.map((bodyType) => ({
    bodyType,
    imageUrl: byType.get(bodyType)?.imageUrl ?? null,
    alt: byType.get(bodyType)?.alt ?? null,
    count: byCount.get(bodyType) ?? 0,
  }));
}
