import {
  DEFAULT_MEDIA_ANIMATION,
  mediaSourceFromAsset,
  type MediaAsset,
  type MediaKind,
  type MediaPresentation,
  type MediaPresentationInput,
  type MediaSource,
  type MediaSourceInput,
} from '@vintrax/shared';

/**
 * A source as the API takes it: a library asset by id — the API fills in its
 * URLs — or, for media saved before the library, the URLs it already had.
 */
export function toSourceInput(source: MediaSource): MediaSourceInput {
  if (source.assetId) return { assetId: source.assetId };
  return {
    url: source.url,
    ...(source.posterUrl ? { posterUrl: source.posterUrl } : {}),
    ...(source.smallUrl ? { smallUrl: source.smallUrl } : {}),
  };
}

/** What the editors hold — URLs included, for the preview — as the API takes it. */
export function toMediaInput(media: MediaPresentation | null): MediaPresentationInput | null {
  if (!media) return null;
  return {
    kind: media.kind,
    desktop: toSourceInput(media.desktop),
    mobile: media.mobile ? toSourceInput(media.mobile) : null,
    alt: media.alt?.trim() ? media.alt.trim() : null,
    fit: media.fit,
    position: media.position,
    autoplay: media.autoplay,
    loop: media.loop,
    animation: media.animation,
  };
}

/** A fresh presentation of a library asset, with the site's defaults. */
export function presentationFromAsset(asset: MediaAsset): MediaPresentation {
  return {
    kind: asset.kind,
    desktop: mediaSourceFromAsset(asset),
    mobile: null,
    alt: asset.alt,
    fit: 'COVER',
    position: 'CENTER',
    autoplay: true,
    loop: true,
    animation: DEFAULT_MEDIA_ANIMATION,
  };
}

/** A still picture to stand for the media where only one plain URL fits — a card, a share preview. */
export function stillUrl(media: MediaPresentation | null): string | null {
  if (!media) return null;
  return media.kind === 'VIDEO' ? media.desktop.posterUrl : media.desktop.url;
}

/** Whether an asset can fill a slot of this kind. */
export function fits(asset: MediaAsset, kind: MediaKind): boolean {
  return asset.kind === kind;
}
