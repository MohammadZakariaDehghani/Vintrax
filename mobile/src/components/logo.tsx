import { cn } from '@/lib/format';

/**
 * The Atlas mark, for the few places inside the application that should say
 * which app this is. Same geometry as `public/icons/icon.svg`, which stays a
 * standalone file because the manifest and the browser need one.
 */
/**
 * Brand colours are fixed values, not theme tokens.
 *
 * `--primary` and `--primary-foreground` swap in dark mode, so a tile built
 * from them inverts — a light tile with a near-black glyph — and stops matching
 * the app icon, which is a static file. An identity should look the same in
 * both themes; only the monochrome variant below follows the surface.
 */
const BRAND_BLUE = '#1c4c86';
const BRAND_AMBER = '#e7aa40';

export function LogoMark({
  className,
  /**
   * Monochrome: drops the tile and inherits `currentColor`, for a coloured or
   * cramped surface where the tile cannot sit.
   */
  plain = false,
  ...props
}: { className?: string; plain?: boolean } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn('h-7 w-7', className)}
      role="img"
      aria-label="Atlas"
      {...props}
    >
      {plain ? null : <rect width="512" height="512" rx="112" fill={BRAND_BLUE} />}
      <path
        d="M158 372 L256 140 L354 372"
        fill="none"
        stroke={plain ? 'currentColor' : '#ffffff'}
        strokeWidth={54}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M170 296 H342" fill="none" stroke={BRAND_AMBER} strokeWidth={42} />
    </svg>
  );
}
