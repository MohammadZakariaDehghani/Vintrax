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
const NAVY = '#16295c';
const RED = '#d32027';

const PEAK = 'M206 138 L108 392 L304 392 Z';
const ROAD = 'M120 392 C180 322, 288 236, 404 172 C312 266, 250 322, 240 392 Z';

export function LogoMark({
  className,
  /**
   * Monochrome: drops the tile and draws the road in `currentColor`, for a
   * coloured or cramped surface where the tile cannot sit. The peak keeps the
   * brand red, which is what still identifies it.
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
      {plain ? null : <rect width="512" height="512" rx="112" fill={NAVY} />}
      <g transform="translate(256 256) scale(1.1) translate(-256 -265)">
        <path d={PEAK} fill={RED} />
        <path d={ROAD} fill={plain ? 'currentColor' : '#ffffff'} />
      </g>
    </svg>
  );
}
