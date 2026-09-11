import { cn } from '@/lib/utils';

/**
 * The Vintrax identity.
 *
 * Two shapes, deliberately not the same drawing:
 *
 *   `Logo`      the full lockup — the car in outline over the wordmark over
 *               AUTOSALES. This is the brand as supplied, and it is what the
 *               page header and the footer show.
 *
 *   `LogoMark`  the square app icon — the same car as a solid silhouette.
 *               A browser tab is 16 pixels and the lockup's tapered outlines
 *               close up into a smudge well before that, so the icon keeps the
 *               subject and drops the line work. See documentation/brand.md.
 *
 * Inline SVG rather than an `<img>` so the light-surface variant can follow the
 * theme, which an image file cannot do — dark mode here is a class on `<html>`,
 * not the OS preference.
 *
 * To use a supplied image file instead of this drawing, put it in
 * `frontend/public/` and set NEXT_PUBLIC_BRAND_LOGO_SRC to its path. That value
 * is compiled into the bundle, so it is a rebuild rather than a restart.
 */
const BRAND_LOGO_SRC = process.env['NEXT_PUBLIC_BRAND_LOGO_SRC'];

/**
 * Brand colours are fixed values, not theme tokens.
 *
 * `--primary` and `--primary-foreground` swap in dark mode, so a mark built
 * from them inverts and stops matching the app icon, which is a static file.
 */
const CARBON = '#0c1210';
const GREEN = '#21c45d';

/**
 * The car, as the source logo draws it: tapered sweeps that come to a point at
 * each end rather than an outline of uniform width. Seven filled crescents, not
 * stroked paths — a stroke cannot taper.
 */
const CAR = [
  // Roofline, pointed at the nose and again past the tail.
  'M 44 132 C 120 66, 268 36, 420 40 C 552 44, 656 66, 716 96 C 650 78, 548 58, 420 54 C 272 50, 126 80, 44 132 Z',
  // Greenhouse. It stops short of the tail so the cabin reads as an opening
  // instead of closing the roofline into a solid lens.
  'M 154 130 C 214 86, 300 64, 398 64 C 474 64, 534 78, 580 100 C 530 90, 470 78, 398 78 C 304 78, 216 100, 154 130 Z',
  // Wheel arches: thick over the crown, thin where they meet the body, so they
  // belong to the car rather than standing under it.
  'M 152 172 C 152 124, 184 100, 222 100 C 260 100, 292 124, 292 172 L 281 172 C 281 132, 254 113, 222 113 C 190 113, 163 132, 163 172 Z',
  'M 486 172 C 486 118, 522 92, 564 92 C 608 92, 642 118, 642 172 L 629 172 C 629 126, 600 105, 564 105 C 528 105, 499 126, 499 172 Z',
  'M 292 168 C 350 177, 430 179, 486 171 C 430 187, 350 185, 292 168 Z',
  // The tail flick leaves the rear arch rather than floating beside it.
  'M 636 128 C 674 108, 716 104, 752 114 C 716 124, 684 140, 662 164 C 656 150, 648 136, 636 128 Z',
  'M 56 128 C 84 118, 108 116, 126 120 C 106 132, 82 138, 62 140 Z',
];

/**
 * One id, not a generated one. Several lockups render on the same page — the
 * header has two and the footer a third — and duplicate ids would normally be
 * a bug. Here every definition is identical, so whichever the browser resolves
 * first is the right one, and a `useId()` would make this a client component
 * for nothing.
 */
const CHROME_ID = 'vintrax-chrome';

/** The wordmark's metal: two highlights over a light ramp, edged in brand green. */
function ChromeGradient() {
  return (
    <defs>
      <linearGradient id={CHROME_ID} x1="0" y1="0" x2="0" y2="1">
        {/* Every stop is light. The wordmark sits at about 14px on the header
            band, and a chrome ramp with a genuinely dark mid-band cuts the
            glyphs in half at that size and reads as damage rather than metal.
            The contrast between stops is what says "polished"; the absolute
            darkness is not, and it costs legibility. */}
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="38%" stopColor="#eef2f5" />
        <stop offset="52%" stopColor="#ffffff" />
        <stop offset="74%" stopColor="#d4dce1" />
        <stop offset="100%" stopColor="#b3bec5" />
      </linearGradient>
    </defs>
  );
}

/**
 * The wordmark is set rather than drawn as outlines, so `textLength` pins its
 * width: whichever face the browser actually has, the lockup keeps its
 * proportions and the layout around it does not move.
 */
const WORDMARK_FONT = "'Arial Black','Helvetica Neue',Impact,system-ui,sans-serif";

export function Logo({
  className,
  /**
   * `onDark` for a coloured band such as the site header: the wordmark takes
   * its chrome, which needs a dark surface behind it. On a light surface the
   * same gradient is nearly invisible, so `auto` sets the lockup in the theme's
   * own colours instead.
   */
  tone = 'auto',
}: {
  className?: string;
  tone?: 'auto' | 'onDark';
}) {
  const onDark = tone === 'onDark';

  if (BRAND_LOGO_SRC) {
    // A supplied file wins over the drawing. It carries its own background, so
    // it is only safe on the carbon band — hence no theme handling here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={BRAND_LOGO_SRC} alt="Vintrax" className={cn('h-12 w-auto', className)} />;
  }

  const carFill = onDark ? GREEN : 'hsl(var(--primary))';

  return (
    <svg
      viewBox="0 0 780 392"
      className={cn('h-12 w-auto', className)}
      role="img"
      aria-label="Vintrax Autosales"
    >
      {onDark ? <ChromeGradient /> : null}

      <g transform="translate(0 6)" fill={carFill}>
        {CAR.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      <text
        x="390"
        y="306"
        textAnchor="middle"
        textLength="716"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={WORDMARK_FONT}
        fontSize="118"
        fontWeight="900"
        fill={onDark ? `url(#${CHROME_ID})` : 'hsl(var(--primary))'}
        // paint-order puts the stroke behind the fill, so the green reads as an
        // edge on the metal rather than a line drawn over it.
        stroke={onDark ? GREEN : 'none'}
        strokeWidth={onDark ? 3 : 0}
        paintOrder="stroke"
      >
        VINTRAX
      </text>

      <text
        x="390"
        y="376"
        textAnchor="middle"
        textLength="556"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={WORDMARK_FONT}
        fontSize="54"
        fontWeight="700"
        fill={onDark ? GREEN : 'hsl(var(--muted-foreground))'}
      >
        AUTOSALES
      </text>
    </svg>
  );
}

/**
 * The square app icon: the same car, reduced to a silhouette.
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
        fill={plain ? 'currentColor' : GREEN}
      >
        <path d={BODY} fillRule="evenodd" />
        <path d={WHEELS} fillRule="evenodd" />
      </g>
    </svg>
  );
}
