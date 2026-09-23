import sharp, { type Metadata, type OutputInfo } from 'sharp';

/** Input formats a vehicle photo may arrive in, detected from its bytes. */
export type SourceFormat = 'jpeg' | 'png' | 'webp' | 'avif';

/** Output formats, best-compressing first — the order `<picture>` lists them. */
export type VariantFormat = 'avif' | 'webp';

export interface ImageProcessorOptions {
  maxInputBytes: number;
  maxInputDimension: number;
  maxInputPixels: number;
  maxWidth: number;
  maxHeight: number;
  /** Ascending. */
  variantWidths: readonly number[];
  webpQuality: number;
  avifEnabled: boolean;
  avifQuality: number;
}

export interface SourceMetadata {
  format: SourceFormat;
  /** As displayed — already swapped for a photo the camera stored sideways. */
  width: number;
  height: number;
  sizeBytes: number;
  /** The MIME type the bytes actually are, whatever the upload claimed. */
  contentType: string;
  extension: string;
}

export interface ImageVariant {
  width: number;
  height: number;
  format: VariantFormat;
  contentType: string;
  buffer: Buffer;
}

export interface ProcessedImage {
  source: SourceMetadata;
  /** Largest variant's dimensions — the display aspect ratio. */
  width: number;
  height: number;
  widths: number[];
  formats: VariantFormat[];
  variants: ImageVariant[];
}

/** A failure while encoding one particular variant, e.g. `640.webp`. */
export class VariantError extends Error {
  constructor(
    readonly variant: string,
    cause: unknown,
  ) {
    super(`${variant}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'VariantError';
  }
}

/**
 * Why an upload was refused. The message is written for the dealer who
 * picked the file, so it goes back in the 400 as-is.
 */
export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

const SOURCE_TYPES: Record<SourceFormat, { contentType: string; extension: string }> = {
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  png: { contentType: 'image/png', extension: 'png' },
  webp: { contentType: 'image/webp', extension: 'webp' },
  avif: { contentType: 'image/avif', extension: 'avif' },
};

const VARIANT_TYPES: Record<VariantFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
};

/**
 * Encoder effort, 0 (fastest) to 9 / 6. WebP at 4 is libwebp's own default.
 * AVIF at 2 is the knee measured for documentation/images.md: at 4 it is
 * ~13% smaller than WebP but ~25× slower, which does not fit in an upload.
 */
const WEBP_EFFORT = 4;
const AVIF_EFFORT = 2;

/**
 * EXIF orientations 5–8 store the picture rotated a quarter turn, so the
 * header's width and height are the wrong way round for what is displayed.
 */
function isQuarterTurned(orientation: number | undefined): boolean {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}

/**
 * Turns one uploaded photo into the set of responsive variants the site
 * actually serves.
 *
 * Framework-free on purpose: buffer in, buffers out, no storage, database or
 * HTTP. That is what lets the same code run inside an upload request today,
 * from the `images:migrate` command, and from a background worker later
 * without being rewritten.
 *
 * The photo is decoded exactly once. `normalise()` produces an upright,
 * sRGB, metadata-free raw bitmap no larger than the biggest variant — with
 * libvips' shrink-on-load that decode is itself much cheaper than the full
 * resolution — and every variant is encoded from that small bitmap, instead
 * of each re-decoding a 24-megapixel JPEG.
 */
export class ImageProcessor {
  constructor(private readonly options: ImageProcessorOptions) {}

  get formats(): VariantFormat[] {
    return this.options.avifEnabled ? ['avif', 'webp'] : ['webp'];
  }

  /**
   * Reads what the bytes are, never what the filename or MIME type claims,
   * and refuses anything that is not a photo this pipeline can handle —
   * before any pixel is decoded.
   */
  async validate(buffer: Buffer): Promise<SourceMetadata> {
    if (buffer.byteLength === 0) throw new ImageValidationError('The file is empty.');
    if (buffer.byteLength > this.options.maxInputBytes) {
      throw new ImageValidationError(
        `The photo is ${megabytes(buffer.byteLength)} MB. The limit is ${megabytes(this.options.maxInputBytes)} MB.`,
      );
    }

    const metadata = await this.readMetadata(buffer);
    const format = sourceFormat(metadata);
    if (!format) {
      throw new ImageValidationError(
        metadata.format === 'heif'
          ? 'HEIC photos are not supported yet. Export the photo as JPEG and upload that instead.'
          : 'This file is not a supported photo. Upload a JPEG, PNG, WebP or AVIF image.',
      );
    }

    const rawWidth = metadata.width ?? 0;
    const rawHeight = metadata.height ?? 0;
    if (rawWidth < 1 || rawHeight < 1) {
      throw new ImageValidationError('The photo has no readable dimensions.');
    }
    const longest = Math.max(rawWidth, rawHeight);
    if (
      longest > this.options.maxInputDimension ||
      rawWidth * rawHeight > this.options.maxInputPixels
    ) {
      throw new ImageValidationError(
        `The photo is ${rawWidth} × ${rawHeight} pixels, larger than Vintrax accepts. ` +
          `Resize it to at most ${this.options.maxInputDimension} pixels on its longest side.`,
      );
    }

    const turned = isQuarterTurned(metadata.orientation);
    return {
      format,
      width: turned ? rawHeight : rawWidth,
      height: turned ? rawWidth : rawHeight,
      sizeBytes: buffer.byteLength,
      ...SOURCE_TYPES[format],
    };
  }

  /** Header-only read; decodes no pixels. */
  async readMetadata(buffer: Buffer): Promise<Metadata> {
    try {
      return await sharp(buffer, { limitInputPixels: false }).metadata();
    } catch {
      throw new ImageValidationError('The file is not a readable image. It may be damaged.');
    }
  }

  /**
   * Which widths to generate for a photo whose upright, capped size is
   * `width` pixels across. Never upscales: a width above the photo's own is
   * dropped, and the photo's own width is added as the top variant when it
   * falls between two configured steps — an 800 px photo gets 320, 640 and
   * 800, not a blurry 960.
   */
  targetWidths(width: number): number[] {
    const widths = this.options.variantWidths.filter((candidate) => candidate < width);
    widths.push(width);
    return [...new Set(widths)].sort((a, b) => a - b);
  }

  async process(buffer: Buffer): Promise<ProcessedImage> {
    const source = await this.validate(buffer);
    const base = await this.normalise(buffer);

    const variants: ImageVariant[] = [];
    const widths = this.targetWidths(base.info.width);
    for (const width of widths) {
      for (const format of this.formats) {
        variants.push(await this.encode(base, width, format));
      }
    }

    const largest = variants[variants.length - 1]!;
    return {
      source,
      width: largest.width,
      height: largest.height,
      widths,
      formats: this.formats,
      variants,
    };
  }

  /**
   * Decode once: upright (EXIF orientation applied, and the tag with it),
   * sRGB, fitted inside the configured maximum without enlarging, as a raw
   * bitmap. Nothing from the original's metadata — EXIF, GPS, XMP, camera
   * serial numbers — survives into raw pixels, so no variant can carry it.
   */
  private async normalise(buffer: Buffer): Promise<{ data: Buffer; info: OutputInfo }> {
    try {
      return await sharp(buffer, {
        limitInputPixels: this.options.maxInputPixels,
        failOn: 'error',
        autoOrient: true,
      })
        .resize({
          width: this.options.maxWidth,
          height: this.options.maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      throw new ImageValidationError(
        `The photo could not be read. It may be damaged or incomplete. (${shortReason(error)})`,
      );
    }
  }

  private async encode(
    base: { data: Buffer; info: OutputInfo },
    width: number,
    format: VariantFormat,
  ): Promise<ImageVariant> {
    const { info } = base;
    let pipeline = sharp(base.data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });
    if (width < info.width) pipeline = pipeline.resize({ width });

    pipeline =
      format === 'avif'
        ? pipeline.avif({ quality: this.options.avifQuality, effort: AVIF_EFFORT })
        : pipeline.webp({ quality: this.options.webpQuality, effort: WEBP_EFFORT });

    let encoded: { data: Buffer; info: OutputInfo };
    try {
      encoded = await pipeline.toBuffer({ resolveWithObject: true });
    } catch (error) {
      throw new VariantError(`${width}.${format}`, error);
    }
    const { data, info: out } = encoded;
    return {
      width: out.width,
      height: out.height,
      format,
      contentType: VARIANT_TYPES[format],
      buffer: data,
    };
  }
}

function sourceFormat(metadata: Metadata): SourceFormat | null {
  switch (metadata.format) {
    case 'jpeg':
    case 'png':
    case 'webp':
      return metadata.format;
    // libvips reports AVIF as its HEIF container; the codec tells AVIF (AV1)
    // from HEIC (HEVC), which the bundled libvips cannot decode.
    case 'heif':
      return metadata.compression === 'av1' ? 'avif' : null;
    default:
      return null;
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]!.slice(0, 160);
}
