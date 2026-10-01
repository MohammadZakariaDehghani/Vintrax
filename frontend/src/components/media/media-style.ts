import type { CSSProperties } from 'react';
import {
  MEDIA_POSITION_CSS,
  type MediaAnimation,
  type MediaAnimationType,
  type MediaPresentation,
} from '@vintrax/shared';

/**
 * Where "phone" ends. Matches Tailwind's `md` breakpoint, which is where the
 * site's layouts stop stacking — and the only width at which a separate
 * mobile picture or video is used.
 */
export const PHONE_QUERY = '(max-width: 767px)';

/** Which file to show: chosen by screen width, or forced (the admin preview frames). */
export type MediaVariant = 'auto' | 'desktop' | 'mobile';

/** `object-fit` as a class, so an image and a video in the same box get identical markup. */
export function fitClass(media: Pick<MediaPresentation, 'fit'>): string {
  return media.fit === 'CONTAIN' ? 'object-contain' : 'object-cover';
}

/** `object-position`, only when it is not the default centre. */
export function positionStyle(
  media: Pick<MediaPresentation, 'position'>,
): CSSProperties | undefined {
  return media.position === 'CENTER'
    ? undefined
    : { objectPosition: MEDIA_POSITION_CSS[media.position] };
}

const REVEAL_NAME: Record<Exclude<MediaAnimationType, 'NONE'>, string> = {
  FADE: 'fade',
  SLIDE_UP: 'slide-up',
  SCALE: 'scale',
  REVEAL: 'reveal',
};

/** Gap between items that enter together, so a row of cards arrives one after another. */
export const STAGGER_MS = 90;
/** However long a row is, the last item does not wait longer than this. */
const MAX_STAGGER_MS = 450;

export interface RevealOptions {
  /** Position in a row of items entering together. */
  index?: number;
  /** Merged into the returned style, so callers keep their own custom properties. */
  style?: CSSProperties;
}

/**
 * The attributes that make an element animate into view (see
 * `ScrollRevealObserver` and the `[data-reveal]` rules in globals.css).
 *
 * Plain attributes rather than a wrapper component, so server components can
 * use them on any element — a link, a grid cell, a section — without adding a
 * box to the layout or a client component per element. Without JavaScript, or
 * with reduced motion asked for, the content simply shows.
 */
export function revealProps(
  animation: Partial<MediaAnimation> & { type: MediaAnimationType },
  { index = 0, style }: RevealOptions = {},
): { 'data-reveal'?: string; 'data-reveal-load'?: string; style?: CSSProperties } {
  if (animation.type === 'NONE') return style ? { style } : {};
  const delay = (animation.delayMs ?? 0) + Math.min(index * STAGGER_MS, MAX_STAGGER_MS);
  return {
    'data-reveal': REVEAL_NAME[animation.type],
    ...(animation.onScroll === false ? { 'data-reveal-load': 'true' } : {}),
    style: {
      ...style,
      ...(animation.durationMs ? { '--reveal-duration': `${animation.durationMs}ms` } : {}),
      ...(delay ? { '--reveal-delay': `${delay}ms` } : {}),
    } as CSSProperties,
  };
}

/** The site's own section entrance: a short rise, used where no administrator chose one. */
export const SECTION_REVEAL = { type: 'SLIDE_UP' } as const;
