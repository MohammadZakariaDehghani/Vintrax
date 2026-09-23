import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import type { UploadedVehicleImage } from '@vintrax/shared';
import { buildOptimizedImage, fallbackImageSource } from '@vintrax/shared';
import type { PrismaClient, VehicleImageAsset } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IMAGE_STORAGE, type ImageStorage } from '../../common/storage/image-storage';
import type { Env } from '../../config/env';
import { imageProcessorOptions } from './image-config';
import {
  ImageProcessor,
  ImageValidationError,
  VariantError,
  type VariantFormat,
} from './image-processor';
import { Semaphore } from './semaphore';

/** Public variants: `vehicles/<assetId>/<width>.<format>`. */
export const VARIANT_FOLDER = 'vehicles';
/**
 * Retained originals: `vehicle-originals/<assetId>/original.<ext>`. Not in
 * the API's list of publicly served folders — an original still carries the
 * camera's EXIF, including where the photo was taken.
 */
export const ORIGINAL_FOLDER = 'vehicle-originals';

/**
 * Every variant URL is new — a replaced photo gets a new asset id, so a new
 * folder — which is what makes a year-long immutable cache safe.
 */
const VARIANT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface IngestContext {
  uploadedById: string | null;
  /** Only for the logs; a photo is usually uploaded before its listing exists. */
  vehicleId?: string | null;
  /** Set by `images:migrate`: the pre-pipeline URL this photo came from. */
  legacyUrl?: string;
}

type AssetRow = Pick<
  VehicleImageAsset,
  'id' | 'baseUrl' | 'widths' | 'formats' | 'width' | 'height' | 'originalKey'
>;

/**
 * The vehicle photo pipeline, end to end: validate, record, process, store,
 * record again. Controllers stay thin and call `ingest`; `images:migrate`
 * calls the same method, so a backfilled photo is indistinguishable from a
 * fresh upload.
 *
 * Synchronous, inside the upload request, on purpose (see
 * documentation/images.md): the uploader needs to hear "this is not a photo"
 * immediately, the form needs the processed URL to show a preview and to
 * save the listing with, and at ~1 s per camera photo with a concurrency cap
 * the cost is bounded. `ImageProcessor` takes a buffer and returns buffers,
 * so moving `process()` onto the existing BullMQ queue later is a change to
 * this class only.
 */
@Injectable()
export class VehicleImagesService {
  private readonly logger = new Logger(VehicleImagesService.name);
  private readonly processor: ImageProcessor;
  private readonly slots: Semaphore;
  private readonly fallbackWidth: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaClient,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    config: ConfigService<Env, true>,
  ) {
    const env = {
      IMAGE_MAX_UPLOAD_BYTES: config.get('IMAGE_MAX_UPLOAD_BYTES', { infer: true }),
      IMAGE_MAX_INPUT_DIMENSION: config.get('IMAGE_MAX_INPUT_DIMENSION', { infer: true }),
      IMAGE_MAX_INPUT_PIXELS: config.get('IMAGE_MAX_INPUT_PIXELS', { infer: true }),
      IMAGE_MAX_WIDTH: config.get('IMAGE_MAX_WIDTH', { infer: true }),
      IMAGE_MAX_HEIGHT: config.get('IMAGE_MAX_HEIGHT', { infer: true }),
      IMAGE_VARIANT_WIDTHS: config.get('IMAGE_VARIANT_WIDTHS', { infer: true }),
      IMAGE_WEBP_QUALITY: config.get('IMAGE_WEBP_QUALITY', { infer: true }),
      IMAGE_AVIF_ENABLED: config.get('IMAGE_AVIF_ENABLED', { infer: true }),
      IMAGE_AVIF_QUALITY: config.get('IMAGE_AVIF_QUALITY', { infer: true }),
    };
    this.processor = new ImageProcessor(imageProcessorOptions(env));
    this.slots = new Semaphore(config.get('IMAGE_PROCESSING_CONCURRENCY', { infer: true }));
    this.fallbackWidth = config.get('IMAGE_FALLBACK_WIDTH', { infer: true });

    // libvips' operation cache helps when the same image is processed
    // repeatedly; here every image is new, so it only holds memory.
    sharp.cache(false);
  }

  /**
   * Validates, processes and stores one photo. Throws `BadRequestException`
   * with a message meant for the uploader when the file is not an
   * acceptable photo. A file refused by the header check leaves no trace; one
   * that fails later, at decode (a truncated JPEG), leaves only a FAILED row
   * with the reason — never a file.
   */
  async ingest(buffer: Buffer, context: IngestContext): Promise<UploadedVehicleImage> {
    // Cheap header-only check first, outside the processing queue, so a
    // wrong file is refused at once rather than after waiting its turn.
    const source = await this.validate(buffer);

    const asset = await this.prisma.vehicleImageAsset.create({
      data: {
        // Placeholders until processing succeeds; both are unique, so they
        // carry the id rather than being empty.
        url: `pending:${randomUUID()}`,
        baseUrl: '',
        status: 'PROCESSING',
        uploadedById: context.uploadedById,
        legacyUrl: context.legacyUrl ?? null,
        originalContentType: source.contentType,
        originalWidth: source.width,
        originalHeight: source.height,
        originalSizeBytes: source.sizeBytes,
      },
      select: { id: true },
    });

    const started = Date.now();
    const writtenKeys: string[] = [];
    try {
      const processed = await this.slots.run(() => this.processor.process(buffer));

      const originalKey = `${ORIGINAL_FOLDER}/${asset.id}/original.${processed.source.extension}`;
      await this.storage.save(originalKey, buffer, { contentType: processed.source.contentType });
      writtenKeys.push(originalKey);

      for (const variant of processed.variants) {
        const key = variantKey(asset.id, variant.width, variant.format);
        await this.storage.save(key, variant.buffer, {
          contentType: variant.contentType,
          cacheControl: VARIANT_CACHE_CONTROL,
        });
        writtenKeys.push(key);
      }

      const baseUrl = this.storage.getPath(`${VARIANT_FOLDER}/${asset.id}`);
      const optimized = buildOptimizedImage({
        baseUrl,
        widths: processed.widths,
        formats: processed.formats,
        width: processed.width,
        height: processed.height,
      })!;
      const fallback = fallbackImageSource(optimized.webp, this.fallbackWidth);
      const processingMs = Date.now() - started;

      await this.prisma.vehicleImageAsset.update({
        where: { id: asset.id },
        data: {
          status: 'READY',
          url: fallback.url,
          baseUrl,
          widths: processed.widths,
          formats: processed.formats,
          width: processed.width,
          height: processed.height,
          originalKey,
          processingMs,
          processedAt: new Date(),
        },
      });

      this.logger.log(
        `image ${asset.id} READY vehicle=${context.vehicleId ?? '-'} ` +
          `${processed.source.width}x${processed.source.height} ${processed.source.format} ` +
          `${Math.round(processed.source.sizeBytes / 1024)}KB -> ` +
          `${processed.widths.join('/')} ${processed.formats.join('+')} in ${processingMs}ms`,
      );

      return {
        id: asset.id,
        url: fallback.url,
        key: variantKey(asset.id, fallback.width, 'webp'),
        sizeBytes: processed.source.sizeBytes,
        contentType: 'image/webp',
        originalWidth: processed.source.width,
        originalHeight: processed.source.height,
        optimized,
      };
    } catch (error) {
      const processingMs = Date.now() - started;
      const variant = error instanceof VariantError ? error.variant : '-';
      this.logger.error(
        `image ${asset.id} FAILED vehicle=${context.vehicleId ?? '-'} variant=${variant} ` +
          `after ${processingMs}ms: ${describe(error)}`,
      );

      // Nothing half-written survives: the row records the failure, the
      // files it would have pointed at are removed.
      await Promise.all(writtenKeys.map((key) => this.storage.delete(key).catch(() => undefined)));
      await this.prisma.vehicleImageAsset
        .update({
          where: { id: asset.id },
          data: { status: 'FAILED', error: describe(error).slice(0, 500), processingMs },
        })
        .catch(() => undefined);

      if (error instanceof ImageValidationError) throw new BadRequestException(error.message);
      throw new InternalServerErrorException('The photo could not be processed. Try again.');
    }
  }

  /** Header-only validation, mapped to a 400 the uploader can read. */
  async validate(buffer: Buffer): Promise<{
    contentType: string;
    width: number;
    height: number;
    sizeBytes: number;
  }> {
    try {
      return await this.processor.validate(buffer);
    } catch (error) {
      if (error instanceof ImageValidationError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /**
   * Which of `urls` are processed photos this user may attach, as
   * url → asset id. A URL with no asset (a legacy photo, a seed placeholder)
   * is simply absent and is stored without one, as before.
   *
   * An asset attaches only for whoever uploaded it, an administrator, or a
   * listing it is already on — so one seller cannot adopt, and later
   * release, another seller's upload by guessing its URL.
   */
  async assetIdsFor(
    urls: readonly string[],
    access: { userId: string; isAdmin: boolean; vehicleId?: string },
  ): Promise<Map<string, string>> {
    if (urls.length === 0) return new Map();
    const rows = await this.prisma.vehicleImageAsset.findMany({
      where: {
        url: { in: [...urls] },
        status: 'READY',
        ...(access.isAdmin
          ? {}
          : {
              OR: [
                { uploadedById: access.userId },
                ...(access.vehicleId
                  ? [{ images: { some: { vehicleId: access.vehicleId } } }]
                  : []),
              ],
            }),
      },
      select: { id: true, url: true },
    });
    return new Map(rows.map((row) => [row.url, row.id]));
  }

  /**
   * Deletes every asset in `assetIds` that no listing uses any more — its
   * variants, its original, its row. Called after the write that detached
   * them has committed, so no page can be pointing at a file this removes.
   * Idempotent: a second call finds nothing left to do.
   */
  async releaseUnused(assetIds: Iterable<string>): Promise<number> {
    const ids = [...new Set(assetIds)];
    if (ids.length === 0) return 0;

    const unused = await this.prisma.vehicleImageAsset.findMany({
      where: { id: { in: ids }, images: { none: {} } },
      select: {
        id: true,
        baseUrl: true,
        widths: true,
        formats: true,
        width: true,
        height: true,
        originalKey: true,
      },
    });

    for (const asset of unused) await this.deleteAsset(asset);
    return unused.length;
  }

  /** Every key an asset owns. */
  keysFor(asset: Pick<AssetRow, 'id' | 'widths' | 'formats' | 'originalKey'>): string[] {
    const keys = asset.widths.flatMap((width) =>
      asset.formats.map((format) => variantKey(asset.id, width, format as VariantFormat)),
    );
    if (asset.originalKey) keys.push(asset.originalKey);
    return keys;
  }

  private async deleteAsset(asset: AssetRow): Promise<void> {
    const keys = this.keysFor(asset);
    for (const key of keys) await this.storage.delete(key);
    await this.prisma.vehicleImageAsset.deleteMany({ where: { id: asset.id } });
    this.logger.log(`image ${asset.id} deleted with its ${keys.length} files`);
  }

  /** For `images:migrate`: the storage key behind a pre-pipeline URL, if it is ours. */
  legacyKey(url: string): string | null {
    return this.storage.keyFromUrl(url);
  }

  readStored(key: string): Promise<Buffer> {
    return this.storage.read(key);
  }

  storedExists(key: string): Promise<boolean> {
    return this.storage.exists(key);
  }
}

export function variantKey(assetId: string, width: number, format: VariantFormat): string {
  return `${VARIANT_FOLDER}/${assetId}/${width}.${format}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
