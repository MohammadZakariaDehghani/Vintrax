import type { MakeLogo } from '@vintrax/shared';

/**
 * The row is a carousel showing 4 at a time (issue #67), with the rest
 * reachable through it rather than hidden — so the cap here is not "how many
 * show," it is "how many the row ever has to hold," and is set to match the
 * facet query's own cap (`postgres-search.provider.ts`'s `take: 15` on the
 * makes group-by) rather than an arbitrary smaller number. Supersedes D-045's
 * cap of 5, which was sized for a plain grid with no way to see more.
 */
export const MAX_POPULAR_MAKES = 15;

/** A make shown in the home page's "popular makes" row. */
export interface PopularMake {
  make: string;
  count: number;
  /** An administrator's own logo for this make, or null to draw the generated mark. */
  logoUrl: string | null;
}

/**
 * Builds the row from what is actually in stock, not from an administrator's
 * curated list.
 *
 * Unlike the body-type shortcuts, there is no fixed enum of makes to build
 * from — `counts` (the search facets) is the only source of which makes to
 * show and in what order, because "in stock right now" is the row's whole
 * point. A curated logo only ever decorates a make that is already on the
 * row; it cannot put one there that has no inventory, and a make with a logo
 * set but nothing currently listed simply does not appear, same as before
 * logos existed.
 *
 * Matched case-insensitively against `MakeLogo.make`, since a dealer's typed
 * `Vehicle.make` and an administrator's typed make name are not guaranteed to
 * agree on case.
 */
export function buildPopularMakes({
  curated = [],
  counts = [],
  limit = MAX_POPULAR_MAKES,
}: {
  curated?: MakeLogo[];
  counts?: Array<{ value: string; count: number }>;
  limit?: number;
}): PopularMake[] {
  const byMake = new Map(curated.map((entry) => [entry.make.trim().toLowerCase(), entry]));

  return counts.slice(0, limit).map((entry) => ({
    make: entry.value,
    count: entry.count,
    logoUrl: byMake.get(entry.value.trim().toLowerCase())?.imageUrl ?? null,
  }));
}
