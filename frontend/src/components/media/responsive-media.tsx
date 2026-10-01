import type { MediaPresentation } from '@vintrax/shared';
import { cn } from '@/lib/utils';
import { MediaImage } from './media-image';
import { fitClass, positionStyle, type MediaVariant } from './media-style';
import { VideoBackground } from './video-background';

/**
 * Any media-system picture or video, filling the caller's box — the one
 * component the hero, blog, features and home boxes all draw media with, so
 * a new kind of media is added here once.
 *
 * The caller owns the box (its size, aspect ratio and rounded corners), which
 * is what keeps the page from shifting as media loads; `className` places the
 * media inside it, usually `absolute inset-0 h-full w-full`. Crop (`fit`) and
 * focus (`position`) come from the presentation.
 */
export function ResponsiveMedia({
  media,
  sizes,
  className,
  priority = false,
  controls = false,
  controlsClassName,
  suspended = false,
  variant = 'auto',
}: {
  media: MediaPresentation;
  /** How wide the box is drawn, for the browser to pick a rendition. */
  sizes: string;
  className?: string;
  priority?: boolean;
  /** A pause button on a video. */
  controls?: boolean;
  controlsClassName?: string;
  /** Keeps a video paused, e.g. on a slideshow's hidden slides. */
  suspended?: boolean;
  variant?: MediaVariant;
}) {
  const classes = cn(className, fitClass(media));
  const style = positionStyle(media);

  if (media.kind === 'VIDEO') {
    return (
      <VideoBackground
        media={media}
        className={classes}
        style={style}
        sizes={sizes}
        priority={priority}
        controls={controls}
        controlsClassName={controlsClassName}
        suspended={suspended}
        variant={variant}
      />
    );
  }
  return (
    <MediaImage
      desktop={media.desktop}
      mobile={media.mobile}
      alt={media.alt ?? ''}
      sizes={sizes}
      priority={priority}
      variant={variant}
      className={classes}
      style={style}
    />
  );
}
