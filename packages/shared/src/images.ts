import type { ImageSource, OptimizedImage } from './contracts';

/**
 * Responsive widths every vehicle photo is rendered at (issue #74), with the
 * names the documentation uses for them. The API's IMAGE_VARIANT_WIDTHS can
 * change the list; nothing on the client depends on these exact numbers — it
 * reads the widths each photo actually has.
 */
export const DEFAULT_IMAGE_VARIANT_WIDTHS = {
  thumbnail: 320,
  small: 640,
  medium: 960,
  large: 1440,
  xlarge: 1920,
} as const;

/** What the API stores for a processed photo; see `VehicleImageAsset`. */
export interface ImageAssetRecord {
  baseUrl: string;
  widths: number[];
  formats: string[];
  width: number | null;
  height: number | null;
}

/** `<baseUrl>/<width>.<format>` for every width, or null if not usable. */
export function buildOptimizedImage(asset: ImageAssetRecord): OptimizedImage | null {
  if (!asset.width || !asset.height || asset.widths.length === 0) return null;
  const sources = (format: string): ImageSource[] =>
    asset.formats.includes(format)
      ? [...asset.widths]
          .sort((a, b) => a - b)
          .map((width) => ({ width, url: `${asset.baseUrl}/${width}.${format}` }))
      : [];
  const webp = sources('webp');
  if (webp.length === 0) return null;
  return { width: asset.width, height: asset.height, webp, avif: sources('avif') };
}

/** The `srcset` attribute for a set of renditions: `a.webp 320w, b.webp 640w`. */
export function imageSrcSet(sources: readonly ImageSource[]): string {
  return sources.map((source) => `${source.url} ${source.width}w`).join(', ');
}

/**
 * The rendition to put in `src`, for the rare browser that ignores `srcset`:
 * the smallest one at least `target` wide, or the largest there is.
 */
export function fallbackImageSource(sources: readonly ImageSource[], target = 960): ImageSource {
  return sources.find((source) => source.width >= target) ?? sources[sources.length - 1]!;
}
