import { cn } from '@/lib/utils';

/**
 * The Atlas mark and lockup.
 *
 * Inline SVG rather than an `<img>` so the monochrome variant can inherit the
 * surface colour, which an image file cannot do — dark mode here is a class on
 * `<html>`, not the OS preference.
 *
 * The geometry matches `app/icon.svg`; that has to stay a standalone file for
 * the favicon and the manifest.
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
      className={cn('h-9 w-9', className)}
      role="img"
      aria-label="Atlas"
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

/**
 * The full lockup: mark, name, and the descriptor that says what Atlas is.
 *
 * The name and descriptor are live text rather than outlines, so they stay
 * selectable and scale with the reader's font settings — and, unlike a flat
 * image, the descriptor can be translated.
 */
export function Logo({
  className,
  descriptor,
}: {
  className?: string;
  /** Omitted in cramped placements, where it would be unreadable anyway. */
  descriptor?: string;
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark aria-hidden />
      <span className="flex flex-col leading-none">
        <span className="text-xl font-extrabold tracking-tight text-primary">ATLAS</span>
        {descriptor ? (
          <span className="mt-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {descriptor}
          </span>
        ) : null}
      </span>
    </span>
  );
}
