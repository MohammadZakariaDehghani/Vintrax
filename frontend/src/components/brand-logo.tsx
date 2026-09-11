import { BRAND_LOGOS } from '@/components/brand-logos.generated';
import { cn } from '@/lib/utils';

/**
 * A vehicle make's own mark, for the "popular makes" shortcuts.
 *
 * The marks are the makers' trademarks. They appear here to label a link to
 * that maker's actual vehicles in Vintrax's inventory — which is what a mark is
 * for, and how every marketplace labels a make filter. Nothing implies
 * endorsement or affiliation.
 *
 * Paths are lifted out of `simple-icons` at build time by
 * scripts/generate-brand-logos.mjs, so the 3,500-icon package never ships.
 * A make with no icon there gets a lettermark instead, which is why adding a
 * make to the catalogue never needs a code change here.
 */

/**
 * What to draw for a make with no mark on file.
 *
 * A short name is its own lettermark — "BMW", "GMC", "Ram". A name of two
 * words takes an initial from each: "Land Rover" → "LR". Anything else takes
 * one letter, because a truncation ("Buick" → "BU") reads as a typo where a
 * single "B" reads as a monogram.
 */
function lettermark(make: string): string {
  const words = make.split(/[\s-]+/).filter(Boolean);
  if (make.length <= 3) return make.toUpperCase();
  if (words.length > 1)
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
  return make.slice(0, 1).toUpperCase();
}

export function BrandLogo({ make, className }: { make: string; className?: string }) {
  const logo = BRAND_LOGOS[make.toLowerCase()];

  if (!logo) {
    return (
      <span
        className={cn(
          'grid h-8 w-8 place-items-center rounded-full border border-current text-[0.625rem] font-bold leading-none tracking-tight',
          className,
        )}
        aria-hidden
      >
        {lettermark(make)}
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-8 w-8', className)}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d={logo.path} />
    </svg>
  );
}
