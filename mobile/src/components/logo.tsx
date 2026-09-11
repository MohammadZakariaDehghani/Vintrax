import { cn } from '@/lib/format';

/**
 * The Vintrax mark, for the few places inside the application that should say
 * which app this is. Same geometry as `public/icons/icon.svg`, which stays a
 * standalone file because the manifest and the browser need one.
 */
/**
 * Brand colours are fixed values, not theme tokens.
 *
 * `--primary` and `--primary-foreground` swap in dark mode, so a mark built
 * from them inverts and stops matching the app icon, which is a static file.
 * An identity should look the same in both themes; only the monochrome variant
 * below follows its surface.
 */
const CARBON = '#0c1210';
const GREEN = '#21c45d';

/**
 * The car in profile, as one path.
 *
 * The wheel arches are subpaths cut with `fill-rule="evenodd"` rather than
 * discs painted in the background colour. A punched-out disc only works when
 * the surface behind it is known, and `plain` puts this mark on surfaces that
 * are not.
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
      className={cn('h-7 w-7', className)}
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
