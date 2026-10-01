import type { CSSProperties } from 'react';
import { imageSrcSet, type MediaSource } from '@vintrax/shared';
import { PHONE_QUERY, type MediaVariant } from './media-style';

/** `srcset` for a source: every WebP width when the library made them, else its one URL. */
function webpSet(source: MediaSource): string {
  return source.image ? imageSrcSet(source.image.webp) : source.url;
}

/**
 * A picture from the media system, drawn once for every screen.
 *
 * A `<picture>`: on a phone the mobile picture when there is one (chosen by
 * the browser from a media query, so the other is never downloaded), AVIF
 * where it was made, and WebP widths in `srcset` so the browser picks by size
 * and pixel density. Pictures saved before the library have one URL and are
 * drawn from it as they always were.
 *
 * `priority` is for the one picture that is the page's largest paint — the
 * hero: fetched eagerly at high priority. Everything else is lazy. The box is
 * the caller's: this fills it (`className`), so nothing shifts as it loads.
 *
 * A server component: no hooks, so pages render it into their HTML.
 */
export function MediaImage({
  desktop,
  mobile,
  alt,
  sizes,
  priority = false,
  variant = 'auto',
  className,
  style,
}: {
  desktop: MediaSource;
  mobile: MediaSource | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  variant?: MediaVariant;
  className?: string;
  style?: CSSProperties;
}) {
  const main = variant === 'mobile' ? (mobile ?? desktop) : desktop;
  const phone = variant === 'auto' ? mobile : null;
  const avif = main.image?.avif ?? [];

  return (
    // `contents`: the <picture> takes no box, so the <img> fills the caller's.
    <picture className="contents">
      {phone ? (
        <>
          {phone.image?.avif.length ? (
            <source
              media={PHONE_QUERY}
              type="image/avif"
              srcSet={imageSrcSet(phone.image.avif)}
              sizes="100vw"
            />
          ) : null}
          <source media={PHONE_QUERY} srcSet={webpSet(phone)} sizes="100vw" />
        </>
      ) : null}
      {avif.length > 0 ? (
        <source type="image/avif" srcSet={imageSrcSet(avif)} sizes={sizes} />
      ) : null}
      <img
        src={main.url}
        srcSet={main.image ? imageSrcSet(main.image.webp) : undefined}
        sizes={main.image ? sizes : undefined}
        alt={alt}
        width={main.width ?? undefined}
        height={main.height ?? undefined}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className={className}
        style={style}
      />
    </picture>
  );
}
