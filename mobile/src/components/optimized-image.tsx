import Image from 'next/image';
import {
  fallbackImageSource,
  imageSrcSet,
  type OptimizedImage as OptimizedRenditions,
} from '@vintrax/shared';
import { cn } from '@/lib/format';

/**
 * A vehicle photo filling its (relatively positioned) parent — the mobile
 * counterpart of frontend/src/components/optimized-image.tsx (issue #74).
 *
 * A processed photo is drawn straight from the API's own WebP (and AVIF)
 * renditions with `srcset`, which skips the round trip through Next's image
 * optimizer: the resizing has already been done, once, at upload. A photo
 * from before the pipeline has no renditions yet, so it keeps going through
 * `next/image` exactly as before rather than falling back to the original.
 *
 * `priority` is for the first photo on a vehicle page, the largest paint:
 * eager, at high fetch priority. Everything else is lazy.
 */
/**
 * Whether a photo lives on another origin (an S3 bucket or CDN). Those are
 * drawn as they are: the image optimiser only fetches this app's own paths.
 */
export function isRemoteImage(src: string): boolean {
  return /^(https?:)?\/\//i.test(src);
}

export function OptimizedImage({
  image,
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  image: OptimizedRenditions | null | undefined;
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (!image) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={isRemoteImage(src)}
        className={className}
      />
    );
  }

  return (
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
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : undefined}
        className={cn('absolute inset-0 h-full w-full', className)}
      />
    </picture>
  );
}
