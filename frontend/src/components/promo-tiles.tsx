import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  promoTileHasMedia,
  promoTileMedia,
  type PromoTile,
  type PromoTileWidth,
} from '@vintrax/shared';
import { cn } from '@/lib/utils';
import { ResponsiveMedia } from '@/components/media/responsive-media';
import { revealProps, type MediaVariant } from '@/components/media/media-style';

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
  ...attributes
}: {
  href: string | null;
  /** For a box with no words of its own; otherwise its words are its name. */
  label: string | undefined;
  className: string;
  style?: CSSProperties;
  children: React.ReactNode;
  'data-reveal'?: string;
  'data-reveal-load'?: string;
}) {
  if (!href) {
    return (
      <div className={className} style={style} {...attributes}>
        {children}
      </div>
    );
  }
  if (href.startsWith('/')) {
    return (
      <Link href={href} aria-label={label} className={className} style={style} {...attributes}>
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
      {...attributes}
    >
      {children}
    </a>
  );
}

/** Every medium fills the tile the same way: edge to edge, cropped to the tile's shape. */
const MEDIA_CLASS =
  'absolute inset-0 h-full w-full transition-transform duration-300 group-hover:scale-[1.03]';

/**
 * What goes inside a tile. The tile itself — size, span, order, corners and
 * scaling — is `PromoTileRow`'s and is the same for a photo and a video, so
 * only this changes when a tile switches between them. A box saved before the
 * media library draws the photo or video it was saved with.
 */
function TileMedia({ tile, variant }: { tile: PromoTile; variant: MediaVariant }) {
  const media = promoTileMedia(tile);
  if (!media) return null;
  return (
    <ResponsiveMedia
      media={media}
      sizes={`(min-width: 640px) ${Math.round((tile.widthSpan / 12) * 100)}vw, 100vw`}
      variant={variant}
      className={MEDIA_CLASS}
    />
  );
}

/** Words over the media — real text, never baked into the picture. */
function TileText({ tile }: { tile: PromoTile }) {
  if (!tile.title && !tile.body && !tile.ctaLabel) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-5 text-white">
      {tile.title ? (
        <p className="text-lg font-bold leading-tight tracking-tight md:text-xl">{tile.title}</p>
      ) : null}
      {tile.body ? <p className="mt-1 line-clamp-3 text-sm text-white/85">{tile.body}</p> : null}
      {tile.ctaLabel ? (
        // Not a link of its own: the whole box is the link.
        <span className="mt-3 inline-flex items-center gap-1.5 self-start rounded-md bg-white/95 px-3.5 py-2 text-sm font-semibold text-[hsl(0_12%_9%)] transition-colors group-hover:bg-white">
          {tile.ctaLabel}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      ) : null}
    </div>
  );
}

/** The tiles themselves, without the page's container; also the admin preview. */
export function PromoTileRow({
  tiles,
  variant = 'auto',
}: {
  tiles: PromoTile[];
  /** Forces the desktop or phone media, for the admin preview frames. */
  variant?: MediaVariant;
}) {
  const shown = tiles.filter(promoTileHasMedia);
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-4 [container-type:inline-size] sm:grid-cols-12">
      {shown.map((tile, index) => (
        <TileLink
          key={tile.slot}
          href={tile.linkUrl}
          label={
            tile.title || tile.body || tile.ctaLabel
              ? undefined
              : tile.media?.alt || tile.imageAlt || 'Promotion'
          }
          // Boxes rise in one after another, each as its media asks.
          {...revealProps(promoTileMedia(tile)?.animation ?? { type: 'SLIDE_UP' }, {
            index,
            style: promoTileSizing(tile),
          })}
          className={cn(
            'group relative block overflow-hidden rounded-lg border border-border bg-muted',
            'aspect-[var(--promo-ratio)] sm:aspect-auto sm:h-[var(--promo-height)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            SPAN_CLASS[tile.widthSpan] ?? SPAN_CLASS[4],
          )}
        >
          <TileMedia tile={tile} variant={variant} />
          <TileText tile={tile} />
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
