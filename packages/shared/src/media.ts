import { z } from 'zod';
import type { Article, ArticleSummary, HomeFeature, OptimizedImage, PromoTile } from './contracts';
import { PROMO_VIDEO } from './domain';

/**
 * The media system: one way to describe the picture or video a piece of home
 * page content shows, shared by the hero, blog posts, home features and home
 * boxes (see documentation/media-system.md).
 *
 * A *media asset* is a file in the media library — an uploaded photo, already
 * cut into responsive WebP renditions, or an uploaded video, already
 * re-encoded for the web with a poster frame and a phone-sized rendition.
 *
 * A *media presentation* is how one piece of content shows media: which asset
 * on a computer, which (optionally) on a phone, how it is cropped, whether a
 * video plays on its own, and how it animates into view. Content stores a
 * snapshot of the assets' public URLs, so the home page never needs a join to
 * draw itself; an asset in use cannot be deleted, so a snapshot never points
 * at a file that is gone.
 *
 * Videos are always silent: the upload pipeline removes the sound track, which
 * is also what lets a browser start them without a click. There is no "muted"
 * switch because there is nothing to unmute.
 */

export const MEDIA_KINDS = ['IMAGE', 'VIDEO'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** `cover` fills the box and crops; `contain` shows the whole picture inside it. */
export const MEDIA_FITS = ['COVER', 'CONTAIN'] as const;
export type MediaFit = (typeof MEDIA_FITS)[number];

/** Which part of the picture stays in view when `cover` crops it. */
export const MEDIA_POSITIONS = [
  'CENTER',
  'TOP',
  'BOTTOM',
  'LEFT',
  'RIGHT',
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
] as const;
export type MediaPosition = (typeof MEDIA_POSITIONS)[number];

/** CSS `object-position` for each choice. */
export const MEDIA_POSITION_CSS: Record<MediaPosition, string> = {
  CENTER: '50% 50%',
  TOP: '50% 0%',
  BOTTOM: '50% 100%',
  LEFT: '0% 50%',
  RIGHT: '100% 50%',
  TOP_LEFT: '0% 0%',
  TOP_RIGHT: '100% 0%',
  BOTTOM_LEFT: '0% 100%',
  BOTTOM_RIGHT: '100% 100%',
};

export const MEDIA_POSITION_LABELS: Record<MediaPosition, string> = {
  CENTER: 'Centre',
  TOP: 'Top',
  BOTTOM: 'Bottom',
  LEFT: 'Left',
  RIGHT: 'Right',
  TOP_LEFT: 'Top left',
  TOP_RIGHT: 'Top right',
  BOTTOM_LEFT: 'Bottom left',
  BOTTOM_RIGHT: 'Bottom right',
};

/**
 * How content enters the screen. Deliberately few, and all subtle: a fade, a
 * short rise, a slight scale, or the picture unveiled from the bottom edge.
 * Visitors who ask their system for reduced motion get none of them.
 */
export const MEDIA_ANIMATIONS = ['NONE', 'FADE', 'SLIDE_UP', 'SCALE', 'REVEAL'] as const;
export type MediaAnimationType = (typeof MEDIA_ANIMATIONS)[number];

export const MEDIA_ANIMATION_LABELS: Record<MediaAnimationType, string> = {
  NONE: 'None',
  FADE: 'Fade in',
  SLIDE_UP: 'Slide up',
  SCALE: 'Scale in',
  REVEAL: 'Reveal',
};

export const MEDIA_ANIMATION_LIMITS = {
  durationMs: { min: 150, max: 2000, default: 700 },
  delayMs: { min: 0, max: 1500, default: 0 },
} as const;

/** Media library limits the browser checks before uploading; the API checks them again. */
export const MEDIA_IMAGE = {
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const,
  /** Matches the API's IMAGE_MAX_UPLOAD_BYTES default. */
  maxUploadBytes: 15 * 1024 * 1024,
  /** Smaller than this would look soft anywhere on the home page. */
  minWidth: 320,
  minHeight: 180,
  /** Matches the API's IMAGE_MAX_INPUT_DIMENSION default. */
  maxDimension: 12_000,
} as const;

/** Videos go through the same pipeline as promo tile videos, plus a phone rendition. */
export const MEDIA_VIDEO = {
  ...PROMO_VIDEO,
  /** The phone rendition's width; desktop renditions are at most `maxWidth`. */
  smallWidth: 720,
} as const;

// --- Shapes ------------------------------------------------------------------

/** One file as content shows it: a snapshot of a library asset's public URLs. */
export interface MediaSource {
  /** The library asset it came from; null for media saved before the library. */
  assetId: string | null;
  /** An image's plain rendition, or a video's MP4. */
  url: string;
  /** A video's poster frame. */
  posterUrl: string | null;
  /** A video's phone-sized rendition, used on a phone when no mobile media is set. */
  smallUrl: string | null;
  width: number | null;
  height: number | null;
  /** An image's responsive renditions, for `srcset`. */
  image: OptimizedImage | null;
}

export interface MediaAnimation {
  type: MediaAnimationType;
  durationMs: number;
  delayMs: number;
  /** Animate when scrolled into view; off means it animates once, as the page loads. */
  onScroll: boolean;
}

export interface MediaPresentation {
  kind: MediaKind;
  desktop: MediaSource;
  /** Shown on phones instead of `desktop`; null falls back to `desktop`. */
  mobile: MediaSource | null;
  alt: string | null;
  fit: MediaFit;
  position: MediaPosition;
  /** A video plays by itself when on screen; off shows its poster with a play button. */
  autoplay: boolean;
  loop: boolean;
  animation: MediaAnimation;
}

export const DEFAULT_MEDIA_ANIMATION: MediaAnimation = {
  type: 'FADE',
  durationMs: MEDIA_ANIMATION_LIMITS.durationMs.default,
  delayMs: MEDIA_ANIMATION_LIMITS.delayMs.default,
  onScroll: true,
};

/** A file in the media library, as the admin sees it. Storage keys never leave the API. */
export interface MediaAsset {
  id: string;
  kind: MediaKind;
  /** The administrator's own name for it. */
  label: string;
  /** The default description, copied into content that uses it. */
  alt: string | null;
  url: string;
  posterUrl: string | null;
  smallUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sizeBytes: number;
  contentType: string;
  image: OptimizedImage | null;
  createdAt: string;
  updatedAt: string;
}

export const MEDIA_USAGE_TYPES = ['HOME_HERO', 'ARTICLE', 'HOME_FEATURE', 'HOME_BOX'] as const;
export type MediaUsageType = (typeof MEDIA_USAGE_TYPES)[number];

/** Where an asset is shown — why it cannot be deleted yet. */
export interface MediaUsage {
  type: MediaUsageType;
  id: string;
  title: string;
}

/** A library asset's stored files as a source, for content that uses it. */
export function mediaSourceFromAsset(asset: MediaAsset): MediaSource {
  return {
    assetId: asset.id,
    url: asset.url,
    posterUrl: asset.posterUrl,
    smallUrl: asset.smallUrl,
    width: asset.width,
    height: asset.height,
    image: asset.image,
  };
}

// --- Validation --------------------------------------------------------------

const url = z.string().trim().min(1).max(500);
const uuid = z.string().uuid();

/**
 * A source as an administrator sends it: a library asset by id (the API fills
 * in its URLs, so nobody can point content at a file it did not issue), or —
 * for content saved before the library existed — the URLs it already has,
 * which the API checks are its own.
 */
export const mediaSourceInputSchema = z.union([
  z.object({ assetId: uuid }).strict(),
  z
    .object({
      url,
      posterUrl: url.nullish(),
      smallUrl: url.nullish(),
    })
    .strict(),
]);
export type MediaSourceInput = z.infer<typeof mediaSourceInputSchema>;

const animationSchema = z
  .object({
    type: z.enum(MEDIA_ANIMATIONS).default(DEFAULT_MEDIA_ANIMATION.type),
    durationMs: z
      .number()
      .int()
      .min(MEDIA_ANIMATION_LIMITS.durationMs.min)
      .max(MEDIA_ANIMATION_LIMITS.durationMs.max)
      .default(MEDIA_ANIMATION_LIMITS.durationMs.default),
    delayMs: z
      .number()
      .int()
      .min(MEDIA_ANIMATION_LIMITS.delayMs.min)
      .max(MEDIA_ANIMATION_LIMITS.delayMs.max)
      .default(MEDIA_ANIMATION_LIMITS.delayMs.default),
    onScroll: z.boolean().default(true),
  })
  .strict();

const presentationFields = {
  kind: z.enum(MEDIA_KINDS),
  alt: z.string().trim().max(160).nullish(),
  fit: z.enum(MEDIA_FITS).default('COVER'),
  position: z.enum(MEDIA_POSITIONS).default('CENTER'),
  autoplay: z.boolean().default(true),
  loop: z.boolean().default(true),
  animation: animationSchema.default({}),
};

export const mediaPresentationInputSchema = z
  .object({
    ...presentationFields,
    desktop: mediaSourceInputSchema,
    mobile: mediaSourceInputSchema.nullish(),
  })
  .strict();
export type MediaPresentationInput = z.input<typeof mediaPresentationInputSchema>;
export type ParsedMediaPresentationInput = z.output<typeof mediaPresentationInputSchema>;

const imageSourceSchema = z.object({ width: z.number(), url: z.string() });

const storedSourceSchema = z.object({
  assetId: z.string().nullable(),
  url: z.string(),
  posterUrl: z.string().nullable(),
  smallUrl: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  image: z
    .object({
      width: z.number(),
      height: z.number(),
      webp: z.array(imageSourceSchema),
      avif: z.array(imageSourceSchema),
    })
    .nullable(),
});

/** A stored presentation, as the API reads it back. Anything else is treated as no media. */
export const mediaPresentationSchema = z.object({
  ...presentationFields,
  alt: z.string().nullable(),
  desktop: storedSourceSchema,
  mobile: storedSourceSchema.nullable(),
});

/** A stored JSON value as a presentation, or null when it is missing or malformed. */
export function parseMediaPresentation(value: unknown): MediaPresentation | null {
  if (value === null || value === undefined) return null;
  const parsed = mediaPresentationSchema.safeParse(value);
  return parsed.success ? (parsed.data as MediaPresentation) : null;
}

export const mediaAssetQuerySchema = z.object({
  kind: z.enum(MEDIA_KINDS).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type MediaAssetQuery = z.infer<typeof mediaAssetQuerySchema>;

export const updateMediaAssetSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    alt: z.string().trim().max(160).nullable(),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateMediaAssetInput = z.infer<typeof updateMediaAssetSchema>;

// --- Content written before the media system ---------------------------------

function plainSource(url: string, posterUrl: string | null = null): MediaSource {
  return { assetId: null, url, posterUrl, smallUrl: null, width: null, height: null, image: null };
}

/** A presentation for a plain uploaded URL, as content stored it before the library. */
export function legacyMediaPresentation(
  kind: MediaKind,
  url: string,
  options: { alt?: string | null; posterUrl?: string | null } = {},
): MediaPresentation {
  return {
    kind,
    desktop: plainSource(url, options.posterUrl ?? null),
    mobile: null,
    alt: options.alt ?? null,
    fit: 'COVER',
    position: 'CENTER',
    autoplay: true,
    loop: true,
    animation: DEFAULT_MEDIA_ANIMATION,
  };
}

/** What a blog post shows: its media, or the photograph every post had before. */
export function articleMedia(
  article: Pick<Article | ArticleSummary, 'media' | 'heroImageUrl' | 'heroAlt'>,
): MediaPresentation | null {
  if (article.media) return article.media;
  return article.heroImageUrl
    ? legacyMediaPresentation('IMAGE', article.heroImageUrl, { alt: article.heroAlt })
    : null;
}

/** What a home feature shows: its media, or the photo it was saved with before. */
export function homeFeatureMedia(
  feature: Pick<HomeFeature, 'media' | 'imageUrl' | 'imageAlt'>,
): MediaPresentation | null {
  if (feature.media) return feature.media;
  return feature.imageUrl
    ? legacyMediaPresentation('IMAGE', feature.imageUrl, { alt: feature.imageAlt })
    : null;
}

/** What a home box shows: its media, or the photo or video it was saved with before. */
export function promoTileMedia(
  tile: Pick<
    PromoTile,
    'media' | 'mediaType' | 'imageUrl' | 'imageAlt' | 'videoUrl' | 'videoPosterUrl'
  >,
): MediaPresentation | null {
  if (tile.media) return tile.media;
  if (tile.mediaType === 'VIDEO') {
    return tile.videoUrl
      ? legacyMediaPresentation('VIDEO', tile.videoUrl, {
          alt: tile.imageAlt,
          posterUrl: tile.videoPosterUrl ?? tile.imageUrl,
        })
      : null;
  }
  return tile.imageUrl
    ? legacyMediaPresentation('IMAGE', tile.imageUrl, { alt: tile.imageAlt })
    : null;
}

/** A still picture for a presentation: the image itself, or a video's poster. */
export function mediaStillUrl(media: MediaPresentation | null): string | null {
  if (!media) return null;
  return media.kind === 'VIDEO' ? media.desktop.posterUrl : media.desktop.url;
}
