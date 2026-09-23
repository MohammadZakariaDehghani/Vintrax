import type { Env } from '../../config/env';
import type { ImageProcessorOptions } from './image-processor';

/** The one place IMAGE_* configuration becomes processor settings. */
export function imageProcessorOptions(
  env: Pick<
    Env,
    | 'IMAGE_MAX_UPLOAD_BYTES'
    | 'IMAGE_MAX_INPUT_DIMENSION'
    | 'IMAGE_MAX_INPUT_PIXELS'
    | 'IMAGE_MAX_WIDTH'
    | 'IMAGE_MAX_HEIGHT'
    | 'IMAGE_VARIANT_WIDTHS'
    | 'IMAGE_WEBP_QUALITY'
    | 'IMAGE_AVIF_ENABLED'
    | 'IMAGE_AVIF_QUALITY'
  >,
): ImageProcessorOptions {
  return {
    maxInputBytes: env.IMAGE_MAX_UPLOAD_BYTES,
    maxInputDimension: env.IMAGE_MAX_INPUT_DIMENSION,
    maxInputPixels: env.IMAGE_MAX_INPUT_PIXELS,
    maxWidth: env.IMAGE_MAX_WIDTH,
    maxHeight: env.IMAGE_MAX_HEIGHT,
    variantWidths: env.IMAGE_VARIANT_WIDTHS,
    webpQuality: env.IMAGE_WEBP_QUALITY,
    avifEnabled: env.IMAGE_AVIF_ENABLED,
    avifQuality: env.IMAGE_AVIF_QUALITY,
  };
}
