import type { MakeLogo } from '@vintrax/shared';

/** One row of the admin make-logos screen: a make, its current logo if any, and how many are listed. */
export interface MakeLogoRow {
  make: string;
  count: number;
  imageUrl: string | null;
  alt: string | null;
}

/**
 * The admin screen's list of makes, unlike the home page's row: it must show
 * a make an administrator has already set a logo for even after that make's
 * inventory sells through, or the logo becomes impossible to find and remove
 * again. Facet makes come first, in their existing count order; any
 * curated-only make — a logo set for a make with nothing currently listed —
 * is appended after, at `count: 0`.
 *
 * Matched case-insensitively, the same as `buildPopularMakes`.
 */
export function buildMakeLogoRows({
  curated = [],
  facetMakes = [],
}: {
  curated?: MakeLogo[];
  facetMakes?: Array<{ value: string; count: number }>;
}): MakeLogoRow[] {
  const byMake = new Map(curated.map((entry) => [entry.make.trim().toLowerCase(), entry]));
  const seen = new Set<string>();
  const rows: MakeLogoRow[] = [];

  for (const entry of facetMakes) {
    const key = entry.value.trim().toLowerCase();
    seen.add(key);
    const row = byMake.get(key);
    rows.push({
      make: entry.value,
      count: entry.count,
      imageUrl: row?.imageUrl ?? null,
      alt: row?.alt ?? null,
    });
  }

  for (const entry of curated) {
    const key = entry.make.trim().toLowerCase();
    if (seen.has(key)) continue;
    rows.push({ make: entry.make, count: 0, imageUrl: entry.imageUrl, alt: entry.alt });
  }

  return rows;
}
