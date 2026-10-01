import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEDIA_IMAGE,
  buildOptimizedImage,
  fallbackImageSource,
  mediaSourceFromAsset,
  type MediaAsset,
  type MediaAssetQuery,
  type MediaKind,
  type MediaPresentation,
  type MediaSource,
  type MediaSourceInput,
  type MediaUsage,
  type Paginated,
  type ParsedMediaPresentationInput,
  type UpdateMediaAssetInput,
} from '@vintrax/shared';
import { Prisma, type MediaAsset as MediaAssetRow } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IMAGE_STORAGE, type ImageStorage } from '../../common/storage/image-storage';
import { StorageService } from '../../common/storage/storage.service';
import type { Env } from '../../config/env';
import { imageProcessorOptions } from '../vehicle-images/image-config';
import { ImageProcessor, ImageValidationError } from '../vehicle-images/image-processor';
import { Semaphore } from '../vehicle-images/semaphore';
import type { StoredVideoUpload } from '../uploads/promo-video-uploads.service';

/** Every library file lives under this folder, which the API serves publicly. */
export const MEDIA_FOLDER = 'media';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** A stored JSON presentation for Prisma, or a database NULL. */
export function presentationJson(
  media: MediaPresentation | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return media === null ? Prisma.DbNull : (media as unknown as Prisma.InputJsonValue);
}

/** A label from an uploaded file's name: no folders, no extension, nothing odd. */
export function labelFromFilename(name: string | undefined, fallback: string): string {
  const base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || fallback;
}

/**
 * The media library: the photos and videos the hero, blog posts, home
 * features and home boxes show.
 *
 * Photos go through the vehicle photo pipeline's `ImageProcessor` — the bytes
 * decide what the file is, it is decoded once with a pixel budget, stripped
 * of every byte of metadata and stored only as responsive WebP renditions
 * under generated names. Videos arrive through the chunked upload sessions
 * and are re-encoded before anything is kept; see `PromoVideoUploadsService`.
 *
 * Content refers to library files by asset id, and the API — never the
 * browser — fills in their URLs, so a page can only ever show a file Vintrax
 * stored. An asset that content still shows cannot be deleted.
 */
@Injectable()
export class MediaLibraryService {
  private readonly logger = new Logger(MediaLibraryService.name);
  private readonly processor: ImageProcessor;
  private readonly slots: Semaphore;
  private readonly fallbackWidth: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IMAGE_STORAGE) private readonly images: ImageStorage,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.processor = new ImageProcessor(
      imageProcessorOptions({
        IMAGE_MAX_UPLOAD_BYTES: config.get('IMAGE_MAX_UPLOAD_BYTES', { infer: true }),
        IMAGE_MAX_INPUT_DIMENSION: config.get('IMAGE_MAX_INPUT_DIMENSION', { infer: true }),
        IMAGE_MAX_INPUT_PIXELS: config.get('IMAGE_MAX_INPUT_PIXELS', { infer: true }),
        IMAGE_MAX_WIDTH: config.get('IMAGE_MAX_WIDTH', { infer: true }),
        IMAGE_MAX_HEIGHT: config.get('IMAGE_MAX_HEIGHT', { infer: true }),
        IMAGE_VARIANT_WIDTHS: config.get('IMAGE_VARIANT_WIDTHS', { infer: true }),
        IMAGE_WEBP_QUALITY: config.get('IMAGE_WEBP_QUALITY', { infer: true }),
        IMAGE_AVIF_ENABLED: config.get('IMAGE_AVIF_ENABLED', { infer: true }),
        IMAGE_AVIF_QUALITY: config.get('IMAGE_AVIF_QUALITY', { infer: true }),
      }),
    );
    this.slots = new Semaphore(config.get('IMAGE_PROCESSING_CONCURRENCY', { infer: true }));
    this.fallbackWidth = config.get('IMAGE_FALLBACK_WIDTH', { infer: true });
  }

  async list(query: MediaAssetQuery): Promise<Paginated<MediaAsset>> {
    const where: Prisma.MediaAssetWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q ? { label: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.mediaAsset.count({ where }),
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toMediaAsset),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(id: string): Promise<MediaAsset> {
    return toMediaAsset(await this.row(id));
  }

  /** Validates, processes and files an uploaded photo. */
  async addImage(
    buffer: Buffer,
    { label, createdById }: { label: string; createdById: string },
  ): Promise<MediaAsset> {
    let source;
    try {
      source = await this.processor.validate(buffer);
    } catch (error) {
      if (error instanceof ImageValidationError) throw new BadRequestException(error.message);
      throw error;
    }
    if (source.width < MEDIA_IMAGE.minWidth || source.height < MEDIA_IMAGE.minHeight) {
      throw new BadRequestException(
        `This picture is ${source.width}×${source.height} pixels. Use one at least ${MEDIA_IMAGE.minWidth}×${MEDIA_IMAGE.minHeight}, or it will look blurry.`,
      );
    }

    const id = randomUUID();
    const written: string[] = [];
    try {
      const processed = await this.slots.run(() => this.processor.process(buffer));
      for (const variant of processed.variants) {
        const key = `${MEDIA_FOLDER}/${id}/${variant.width}.${variant.format}`;
        await this.images.save(key, variant.buffer, {
          contentType: variant.contentType,
          cacheControl: CACHE_CONTROL,
        });
        written.push(key);
      }
      const baseUrl = this.images.getPath(`${MEDIA_FOLDER}/${id}`);
      const optimized = buildOptimizedImage({
        baseUrl,
        widths: processed.widths,
        formats: processed.formats,
        width: processed.width,
        height: processed.height,
      })!;
      const fallback = fallbackImageSource(optimized.webp, this.fallbackWidth);
      const largest = processed.variants.filter((variant) => variant.format === 'webp').at(-1);

      const row = await this.prisma.mediaAsset.create({
        data: {
          id,
          kind: 'IMAGE',
          label,
          url: fallback.url,
          baseUrl,
          widths: processed.widths,
          formats: processed.formats,
          width: processed.width,
          height: processed.height,
          sizeBytes: largest?.buffer.byteLength ?? 0,
          contentType: 'image/webp',
          storageKeys: written,
          createdById,
        },
      });
      return toMediaAsset(row);
    } catch (error) {
      await Promise.all(written.map((key) => this.images.delete(key)));
      if (error instanceof ImageValidationError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Files a video the upload sessions already optimised and stored; returns the asset id. */
  async addVideo(
    stored: StoredVideoUpload,
    { label, createdById }: { label: string; createdById: string },
  ): Promise<string> {
    const row = await this.prisma.mediaAsset.create({
      data: {
        kind: 'VIDEO',
        label,
        url: stored.result.videoUrl,
        posterUrl: stored.result.posterUrl,
        smallUrl: stored.smallUrl,
        width: stored.result.width,
        height: stored.result.height,
        durationSeconds: stored.result.durationSeconds,
        sizeBytes: stored.result.sizeBytes,
        contentType: 'video/mp4',
        storageKeys: stored.keys,
        createdById,
      },
      select: { id: true },
    });
    return row.id;
  }

  async update(id: string, input: UpdateMediaAssetInput): Promise<MediaAsset> {
    await this.row(id);
    const row = await this.prisma.mediaAsset.update({ where: { id }, data: input });
    return toMediaAsset(row);
  }

  /**
   * Deletes an asset and its files — unless content still shows it, in which
   * case the answer names that content so the administrator can change it
   * first. Deleting it anyway would leave a hole on the home page.
   */
  async remove(id: string): Promise<void> {
    const row = await this.row(id);
    const usages = await this.usages(row);
    if (usages.length > 0) {
      throw new ConflictException({
        message: `This ${row.kind === 'VIDEO' ? 'video' : 'picture'} is still shown on the site. Remove it from ${usages
          .map((usage) => `“${usage.title}”`)
          .join(', ')} first.`,
        usages,
      });
    }
    await this.prisma.mediaAsset.delete({ where: { id } });
    // Image renditions were written through ImageStorage, videos through
    // StorageService; both delete by key and ignore a key already gone.
    await Promise.all(
      row.storageKeys.map((key) =>
        row.kind === 'IMAGE' ? this.images.delete(key) : this.storage.delete(key),
      ),
    );
    this.logger.log(`Deleted media asset ${id} (${row.storageKeys.length} files)`);
  }

  /** Every piece of content that shows the asset, by id or by one of its URLs. */
  async usages(assetOrId: MediaAssetRow | string): Promise<MediaUsage[]> {
    const asset = typeof assetOrId === 'string' ? await this.row(assetOrId) : assetOrId;
    const urls = [asset.url, asset.posterUrl, asset.smallUrl].filter(Boolean) as string[];
    const mentions = (...values: unknown[]) =>
      values.some((value) => {
        if (value === null || value === undefined) return false;
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return text.includes(asset.id) || urls.some((url) => text.includes(url));
      });

    const [hero, articles, features, tiles] = await Promise.all([
      this.prisma.homeHero.findMany({ select: { id: true, title: true, media: true } }),
      this.prisma.article.findMany({
        select: { id: true, title: true, media: true, heroImageUrl: true },
      }),
      this.prisma.homeFeature.findMany({
        select: { id: true, title: true, media: true, imageUrl: true },
      }),
      this.prisma.promoTile.findMany({
        select: {
          id: true,
          slot: true,
          title: true,
          media: true,
          imageUrl: true,
          videoUrl: true,
          videoPosterUrl: true,
        },
      }),
    ]);

    return [
      ...hero
        .filter((row) => mentions(row.media))
        .map((row) => ({
          type: 'HOME_HERO' as const,
          id: String(row.id),
          title: `Home hero: ${row.title}`,
        })),
      ...articles
        .filter((row) => mentions(row.media, row.heroImageUrl))
        .map((row) => ({ type: 'ARTICLE' as const, id: row.id, title: row.title })),
      ...features
        .filter((row) => mentions(row.media, row.imageUrl))
        .map((row) => ({ type: 'HOME_FEATURE' as const, id: row.id, title: row.title })),
      ...tiles
        .filter((row) => mentions(row.media, row.imageUrl, row.videoUrl, row.videoPosterUrl))
        .map((row) => ({
          type: 'HOME_BOX' as const,
          id: row.id,
          title: row.title ? `Home box ${row.slot}: ${row.title}` : `Home box ${row.slot}`,
        })),
    ];
  }

  /**
   * Turns what an administrator sent into what content stores: library assets
   * resolved to their URLs here, plain URLs (content from before the library)
   * checked to be Vintrax's own. `undefined` means "not sent" and stays so.
   */
  async resolve(
    input: ParsedMediaPresentationInput | null | undefined,
  ): Promise<MediaPresentation | null | undefined> {
    if (input === undefined) return undefined;
    if (input === null) return null;

    const desktop = await this.source(input.desktop, input.kind);
    const mobile = input.mobile ? await this.source(input.mobile, input.kind) : null;
    return {
      kind: input.kind,
      desktop: desktop.source,
      mobile: mobile?.source ?? null,
      alt: input.alt ?? desktop.alt ?? null,
      fit: input.fit,
      position: input.position,
      autoplay: input.autoplay,
      loop: input.loop,
      animation: input.animation,
    };
  }

  private async source(
    input: MediaSourceInput,
    kind: MediaKind,
  ): Promise<{ source: MediaSource; alt: string | null }> {
    if ('assetId' in input) {
      const row = await this.prisma.mediaAsset.findUnique({ where: { id: input.assetId } });
      if (!row) {
        throw new BadRequestException(
          'That picture or video is no longer in the media library. Choose another.',
        );
      }
      if (row.kind !== kind) {
        throw new BadRequestException(
          kind === 'VIDEO'
            ? 'Choose a video from the library, or switch the media to Picture.'
            : 'Choose a picture from the library, or switch the media to Video.',
        );
      }
      return { source: mediaSourceFromAsset(toMediaAsset(row)), alt: row.alt };
    }

    for (const url of [input.url, input.posterUrl, input.smallUrl]) {
      if (url && !this.storage.isOwnUrl(url)) {
        throw new BadRequestException(
          'Media must be uploaded to Vintrax first. An address on another server is not accepted.',
        );
      }
    }
    return {
      source: {
        assetId: null,
        url: input.url,
        posterUrl: input.posterUrl ?? null,
        smallUrl: input.smallUrl ?? null,
        width: null,
        height: null,
        image: null,
      },
      alt: null,
    };
  }

  private async row(id: string): Promise<MediaAssetRow> {
    const row = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Media not found');
    return row;
  }
}

/** The public shape: storage keys stay in the API. */
export function toMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    alt: row.alt,
    url: row.url,
    posterUrl: row.posterUrl,
    smallUrl: row.smallUrl,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    image: row.baseUrl
      ? buildOptimizedImage({
          baseUrl: row.baseUrl,
          widths: row.widths,
          formats: row.formats,
          width: row.width,
          height: row.height,
        })
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
