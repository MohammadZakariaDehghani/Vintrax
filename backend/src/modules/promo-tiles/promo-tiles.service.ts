import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PROMO_TILE_HEIGHT,
  PROMO_TILE_SLOTS,
  promoTileHasMedia,
  type PromoTile,
  type PromoTileWidth,
  type SavePromoTileInput,
} from '@vintrax/shared';
import type { PromoTile as PromoTileRow } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';

/** Read on every home page render, written rarely; every write drops the key. */
const CACHE_KEY = 'site:promo-tiles';
const CACHE_TTL = 600;

/** A slot nobody has saved yet: a third of the row, the default height, no picture. */
function emptySlot(slot: number): PromoTile {
  return {
    slot,
    imageUrl: null,
    imageAlt: null,
    linkUrl: null,
    widthSpan: 4,
    heightPx: PROMO_TILE_HEIGHT.default,
    enabled: true,
    mediaType: 'IMAGE',
    videoUrl: null,
    videoPosterUrl: null,
    updatedAt: null,
  };
}

function toPromoTile(row: PromoTileRow): PromoTile {
  return {
    slot: row.slot,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    linkUrl: row.linkUrl,
    widthSpan: row.widthSpan as PromoTileWidth,
    heightPx: row.heightPx,
    enabled: row.enabled,
    mediaType: row.mediaType,
    videoUrl: row.videoUrl,
    videoPosterUrl: row.videoPosterUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A slot number from the URL, 1 to `PROMO_TILE_SLOTS`. */
export function isPromoTileSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= PROMO_TILE_SLOTS;
}

/**
 * The three promo tiles under the last-search card on the home page: a
 * photograph each, a link, and a size the administrator chooses.
 */
@Injectable()
export class PromoTilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  /** Every slot, 1 to 3, saved or not. */
  async all(): Promise<PromoTile[]> {
    const rows = await this.prisma.promoTile.findMany({
      where: { slot: { gte: 1, lte: PROMO_TILE_SLOTS } },
    });
    const bySlot = new Map(rows.map((row) => [row.slot, toPromoTile(row)]));
    return Array.from(
      { length: PROMO_TILE_SLOTS },
      (_, index) => bySlot.get(index + 1) ?? emptySlot(index + 1),
    );
  }

  /**
   * What the home page shows: switched-on tiles that have their media — a
   * photo for an image tile, a video for a video tile — in slot order.
   */
  async published(): Promise<PromoTile[]> {
    return this.redis.remember(CACHE_KEY, CACHE_TTL, async () =>
      (await this.all()).filter((tile) => tile.enabled && promoTileHasMedia(tile)),
    );
  }

  async save(slot: number, input: SavePromoTileInput, actorId: string): Promise<PromoTile> {
    if (!isPromoTileSlot(slot)) {
      throw new NotFoundException(`There are ${PROMO_TILE_SLOTS} promo tiles, numbered from 1`);
    }
    if (input.imageUrl && !this.storage.isOwnUrl(input.imageUrl)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/promo-tiles first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }
    for (const url of [input.videoUrl, input.videoPosterUrl]) {
      if (url && !this.storage.isOwnUrl(url)) {
        throw new BadRequestException(
          'Upload the video through POST /uploads/promo-tiles/video first, then pass the URLs it returns. An address on another server is not accepted.',
        );
      }
    }

    const data = {
      imageUrl: input.imageUrl,
      imageAlt: input.imageAlt ?? null,
      linkUrl: input.linkUrl,
      widthSpan: input.widthSpan,
      heightPx: input.heightPx,
      enabled: input.enabled,
      // The layout above is the tile's, whichever medium fills it. A client
      // that does not send the video fields leaves them as they were.
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
      ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
      ...(input.videoPosterUrl !== undefined ? { videoPosterUrl: input.videoPosterUrl } : {}),
      updatedById: actorId,
    };
    const row = await this.prisma.promoTile.upsert({
      where: { slot },
      create: { slot, ...data },
      update: data,
    });
    await this.redis.del(CACHE_KEY);
    return toPromoTile(row);
  }
}
