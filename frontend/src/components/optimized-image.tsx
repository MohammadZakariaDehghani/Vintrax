import {
  fallbackImageSource,
  imageSrcSet,
  type OptimizedImage as OptimizedRenditions,
} from '@vintrax/shared';
import { cn } from '@/lib/utils';

/**
 * Common `sizes` values, so each layout states how wide its photo is drawn
 * once, here, rather than each call site inventing its own string. They
 * mirror the Tailwind breakpoints the layouts themselves use.
 */
export const IMAGE_SIZES = {
  /** Card grids: one column on phones, two from `sm`, three or four from `lg`. */
  card: '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  /** The list layout: full width on phones, a 196 px thumbnail from `sm`. */
  row: '(min-width: 640px) 196px, 100vw',
  /**
   * The vehicle page's main photo: two thirds of the gallery, which from `lg`
   * shares the page with the 380 px sidebar.
   */
  hero: '(min-width: 1024px) 45vw, (min-width: 640px) 66vw, 100vw',
  /** The two photos stacked beside the main one. */
  side: '(min-width: 1024px) 22vw, (min-width: 640px) 33vw, 100vw',
  /** Small fixed thumbnails: gallery strip, inventory table, moderation queue. */
  thumb: '160px',
  /** Comparison columns: two to four across. */
  compare: '(min-width: 1024px) 25vw, 50vw',
} as const;

/**
 * Every vehicle photo on the site, drawn one way (issue #74).
 *
 * A processed photo becomes a `<picture>`: an AVIF `<source>` when the API
 * produced one, and an `<img>` whose `srcset` lists every WebP width so the
 * browser picks by viewport and pixel density. `width`/`height` carry the
 * photo's real aspect ratio, so its box is reserved before a byte arrives.
 * A photo from before the pipeline (or a seed SVG) has no renditions and is
 * drawn from its plain URL, exactly as it was.
 *
 * `priority` is for the one photo that is the page's largest paint — the
 * vehicle page's main image: loaded eagerly at high fetch priority. Every
 * other photo is lazy and decodes off the main thread.
 *
 * A server component (no hooks, no handlers), so cards rendered on the
 * server can use it directly.
 */
export function OptimizedImage({
  image,
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  image: OptimizedRenditions | null | undefined;
  /** The plain URL, used when `image` is null. */
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const loading = priority ? 'eager' : 'lazy';
  const fetchPriority = priority ? 'high' : undefined;

  if (!image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        className={className}
      />
    );
  }

  return (
    // `contents`: the <picture> box disappears from layout, so the <img>
    // sizes against the caller's container exactly as a bare <img> did.
    <picture className="contents">
      {image.avif.length > 0 ? (
        <source type="image/avif" srcSet={imageSrcSet(image.avif)} sizes={sizes} />
      ) : null}
      <img
        src={fallbackImageSource(image.webp).url}
        srcSet={imageSrcSet(image.webp)}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={alt}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        className={cn(className)}
      />
    </picture>
  );
}
