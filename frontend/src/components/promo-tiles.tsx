import Link from 'next/link';
import type { CSSProperties } from 'react';
import { promoTileHasMedia, type PromoTile, type PromoTileWidth } from '@vintrax/shared';
import { cn } from '@/lib/utils';
import { PromoTileVideo } from '@/components/promo-tile-video';

/**
 * The width, in pixels, of the page's content column at its widest (the
 * container's 1400px less its padding). An administrator's height is a height
 * at this width; narrower windows scale it down, so a tile keeps its shape.
 */
export const PROMO_REFERENCE_WIDTH_PX = 1360;

/** Written out whole so Tailwind finds every class. */
const SPAN_CLASS: Record<PromoTileWidth, string> = {
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
  6: 'sm:col-span-6',
  8: 'sm:col-span-8',
  9: 'sm:col-span-9',
  12: 'sm:col-span-12',
};

/**
 * How a tile sizes itself, as CSS custom properties the classes below read.
 *
 * - From the small breakpoint up, the tiles share a twelve-column row and a
 *   tile's height is its desktop height scaled by the row's own width
 *   (`cqw`), so tiles given the same height stay level at any window size.
 * - On a phone they stack at full width and keep their desktop shape
 *   (`aspect-ratio`), so a wide banner stays wide and a square stays square.
 */
export function promoTileSizing(tile: Pick<PromoTile, 'widthSpan' | 'heightPx'>): CSSProperties {
  const desktopWidth = (tile.widthSpan / 12) * PROMO_REFERENCE_WIDTH_PX;
  return {
    '--promo-ratio': `${Math.round(desktopWidth)} / ${tile.heightPx}`,
    '--promo-height': `${((tile.heightPx / PROMO_REFERENCE_WIDTH_PX) * 100).toFixed(4)}cqw`,
  } as CSSProperties;
}

function TileLink({
  href,
  label,
  className,
  style,
  children,
}: {
  href: string | null;
  label: string;
  className: string;
  style: CSSProperties;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  if (href.startsWith('/')) {
    return (
      <Link href={href} aria-label={label} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={className}
      style={style}
    >
      {children}
    </a>
  );
}

/** Every medium fills the tile the same way: edge to edge, cropped to the tile's shape. */
const MEDIA_CLASS =
  'absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]';

/**
 * What goes inside a tile. The tile itself — size, span, order, corners and
 * scaling — is `PromoTileRow`'s and is the same for both, so only this changes
 * when a tile switches between a photo and a video.
 */
function TileMedia({ tile }: { tile: PromoTile }) {
  if (tile.mediaType === 'VIDEO' && tile.videoUrl) {
    return (
      <PromoTileVideo
        src={tile.videoUrl}
        poster={tile.videoPosterUrl}
        fallbackImageUrl={tile.imageUrl}
        className={MEDIA_CLASS}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tile.imageUrl ?? ''}
      alt={tile.imageAlt ?? ''}
      loading="lazy"
      className={MEDIA_CLASS}
    />
  );
}

/** The tiles themselves, without the page's container; also the admin preview. */
export function PromoTileRow({ tiles }: { tiles: PromoTile[] }) {
  const shown = tiles.filter(promoTileHasMedia);
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-4 [container-type:inline-size] sm:grid-cols-12">
      {shown.map((tile) => (
        <TileLink
          key={tile.slot}
          href={tile.linkUrl}
          label={tile.imageAlt || 'Promotion'}
          style={promoTileSizing(tile)}
          className={cn(
            'group relative block overflow-hidden rounded-lg border border-border bg-muted',
            'aspect-[var(--promo-ratio)] sm:aspect-auto sm:h-[var(--promo-height)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            SPAN_CLASS[tile.widthSpan] ?? SPAN_CLASS[4],
          )}
        >
          <TileMedia tile={tile} />
        </TileLink>
      ))}
    </div>
  );
}

/**
 * Up to three administrator-made promo tiles under the last-search card: a
 * photograph or a silent looping video each, linking to a page on Vintrax or
 * opening another website in its own tab, each as wide and tall as the
 * administrator set it.
 */
export function PromoTiles({ tiles }: { tiles: PromoTile[] }) {
  if (!tiles.some(promoTileHasMedia)) return null;
  return (
    <section aria-label="Promotions" className="container pt-6">
      <PromoTileRow tiles={tiles} />
    </section>
  );
}
