import Image from 'next/image';
import brandLogo from '../../public/vintrax-logo.png';
import { cn } from '@/lib/utils';

/**
 * The Vintrax identity.
 *
 * Two shapes, deliberately not the same artwork:
 *
 *   `Logo`      the supplied lockup — `frontend/public/vintrax-logo.png`,
 *               rendered exactly as delivered apart from its background, which
 *               was keyed off. The page header, the footer and the sign-in page
 *               all show this.
 *
 *   `LogoMark`  the square app icon, which is its own drawing. A browser tab is
 *               16 pixels, and a 2.5:1 lockup with a chrome bevel and a carbon
 *               weave is an unreadable smudge well before that; the icon keeps
 *               the subject and drops the treatment. See documentation/brand.md.
 *
 * The supplied file goes through next/image rather than a bare `<img>`. It is a
 * 1989×790 PNG — the right master to keep in the repository, and the wrong
 * thing to send to a phone on every page. The static import hands Next the
 * intrinsic dimensions, so it emits a correctly sized WebP per breakpoint and
 * reserves the right box before the file arrives.
 *
 * The artwork was delivered on a solid black slab, which was right on the
 * near-black header and wrong on the footer and the sign-in page, where it read
 * as a rectangle pasted onto a white page. `scripts/unmatte-logo.js` keys that
 * ground off; the delivered file is kept verbatim at `brand/vintrax-logo-source.png`
 * so the step is reproducible. Nothing else about the artwork changed — no
 * crop, no recolour, no redraw — and every pixel keeps its own RGB.
 *
 * The lockup's wordmark is chrome, so it is built for a dark ground and is
 * low-contrast on a white one. See documentation/brand.md.
 *
 * `w-auto` against a fixed height is what keeps it from being stretched — the
 * aspect ratio stays the file's own at every breakpoint.
 *
 * NEXT_PUBLIC_BRAND_LOGO_SRC overrides all of this with another path under
 * `frontend/public/`, for swapping the artwork without a code change. An
 * arbitrary path has no intrinsic size known at build time, so it takes the
 * plain `<img>` route. That value is compiled into the bundle, so setting it is
 * a rebuild rather than a restart.
 */
const BRAND_LOGO_SRC = process.env['NEXT_PUBLIC_BRAND_LOGO_SRC'];

/**
 * The icon's colours are fixed values, not theme tokens.
 *
 * `--primary` and `--primary-foreground` swap in dark mode, so a mark built
 * from them inverts and stops matching `app/icon.svg`, which is a static file.
 * These two hexes carry the same values as `--header` and `--accent`; changing
 * one means changing the other.
 */
const CARBON = '#100d0d';
const RED = '#ed1d1d';

export function Logo({ className }: { className?: string }) {
  if (BRAND_LOGO_SRC) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={BRAND_LOGO_SRC} alt="Vintrax" className={cn('h-12 w-auto', className)} />;
  }

  // One file for both themes. The artwork is the same either way now that the
  // ground is transparent — what changes is the surface behind it, which is the
  // page's, not the logo's.
  //
  // `priority` because this is in the header — above the fold on every page,
  // where lazy-loading shows a visible flash of nothing.
  return (
    <Image
      src={brandLogo}
      alt="Vintrax"
      className={cn('h-12 w-auto', className)}
      sizes="(max-width: 640px) 240px, 340px"
      priority
    />
  );
}

/**
 * The square app icon: a coupe in profile, reduced to a silhouette.
 *
 * The geometry matches `app/icon.svg`; that has to stay a standalone file for
 * the favicon and the manifest.
 *
 * The wheel arches are subpaths cut with `fill-rule="evenodd"` rather than
 * discs painted in the background colour. A punched-out disc only works when
 * the surface behind it is known, and `plain` puts this mark on surfaces that
 * are not — a coloured band, a photograph, the header at any theme.
 */
const BODY =
  'M44 318 L44 262 C44 252 48 246 58 242 L112 222 C140 180 176 163 216 162 L252 162 C306 162 356 186 404 222 L452 254 C474 266 486 280 486 298 L484 318 Z ' +
  'M94 312 a52 52 0 1 0 104 0 a52 52 0 1 0 -104 0 Z ' +
  'M334 312 a52 52 0 1 0 104 0 a52 52 0 1 0 -104 0 Z ';

/** Wheels, sitting in the arches the body path cut. */
const WHEELS =
  'M106 312 a40 40 0 1 0 80 0 a40 40 0 1 0 -80 0 Z ' +
  'M346 312 a40 40 0 1 0 80 0 a40 40 0 1 0 -80 0 Z ';

export function LogoMark({
  className,
  /**
   * Monochrome: drops the tile and draws the car in `currentColor`, for a
   * coloured or cramped surface where the tile cannot sit.
   */
  plain = false,
  ...props
}: { className?: string; plain?: boolean } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn('h-9 w-9', className)}
      role="img"
      aria-label="Vintrax"
      {...props}
    >
      {plain ? null : <rect width="512" height="512" rx="112" fill={CARBON} />}
      <g
        transform="translate(256 256) scale(1.3) translate(-265 -257)"
        fill={plain ? 'currentColor' : RED}
      >
        <path d={BODY} fillRule="evenodd" />
        <path d={WHEELS} fillRule="evenodd" />
      </g>
    </svg>
  );
}
