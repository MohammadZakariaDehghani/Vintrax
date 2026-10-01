import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PROMO_TILE_HEIGHT,
  PROMO_TILE_MAX_SLOTS,
  PROMO_TILE_SLOTS,
  parseMediaPresentation,
  promoTileHasMedia,
  type PromoTile,
  type PromoTileWidth,
  type ReorderPromoTilesInput,
  type SavePromoTileInput,
} from '@vintrax/shared';
import type { PromoTile as PromoTileRow } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaLibraryService, presentationJson } from '../media/media-library.service';

/** Read on every home page render, written rarely; every write drops the key. */
const CACHE_KEY = 'site:promo-tiles';
const CACHE_TTL = 600;

/** A slot nobody has saved yet: a third of the row, the default height, no picture. */
function emptySlot(slot: number): PromoTile {
  return {
    slot,
    title: null,
    body: null,
    ctaLabel: null,
    media: null,
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
    title: row.title,
    body: row.body,
    ctaLabel: row.ctaLabel,
    media: parseMediaPresentation(row.media),
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

/** A slot number from the URL, 1 to `PROMO_TILE_MAX_SLOTS`. */
export function isPromoTileSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= PROMO_TILE_MAX_SLOTS;
}

/**
 * The home boxes under the last-search card on the home page: a photograph
 * or a video each, optional words over it, a link, and a size the
 * administrator chooses. Three to start with, more if added; a box's slot is
 * its place in the row.
 */
@Injectable()
export class PromoTilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly media: MediaLibraryService,
  ) {}

  /**
   * Every saved box in slot order, plus empty ones so there are always at
   * least `PROMO_TILE_SLOTS` — the three the page has always had.
   */
  async all(): Promise<PromoTile[]> {
    const rows = await this.prisma.promoTile.findMany({
      where: { slot: { gte: 1, lte: PROMO_TILE_MAX_SLOTS } },
      orderBy: { slot: 'asc' },
    });
    const bySlot = new Map(rows.map((row) => [row.slot, toPromoTile(row)]));
    const last = Math.max(PROMO_TILE_SLOTS, ...rows.map((row) => row.slot));
    return Array.from(
      { length: last },
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
      throw new NotFoundException(`Home boxes are numbered from 1 to ${PROMO_TILE_MAX_SLOTS}`);
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

    const media = await this.media.resolve(input.media);

    const data = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.ctaLabel !== undefined ? { ctaLabel: input.ctaLabel } : {}),
      ...(media !== undefined ? { media: presentationJson(media) } : {}),
      // Media from the library sets the medium too, so an older client
      // reading only `mediaType` still describes the box correctly.
      ...(media ? { mediaType: media.kind } : {}),
      imageUrl: input.imageUrl,
      imageAlt: input.imageAlt ?? null,
      linkUrl: input.linkUrl,
      widthSpan: input.widthSpan,
      heightPx: input.heightPx,
      enabled: input.enabled,
      // The layout above is the tile's, whichever medium fills it. A client
      // that does not send the video fields leaves them as they were.
      ...(input.mediaType && !media ? { mediaType: input.mediaType } : {}),
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

  /**
   * Deletes a box. Boxes after it move up a place, so the row has no gap and
   * the slots stay a plain 1, 2, 3… sequence.
   */
  async remove(slot: number): Promise<void> {
    if (!isPromoTileSlot(slot)) throw new NotFoundException('Home box not found');
    const { count } = await this.prisma.promoTile.deleteMany({ where: { slot } });
    if (count === 0) throw new NotFoundException('Home box not found');
    const after = await this.prisma.promoTile.findMany({
      where: { slot: { gt: slot } },
      orderBy: { slot: 'asc' },
      select: { id: true, slot: true },
    });
    await this.renumber(
      after.map((row) => row.id),
      slot,
    );
    await this.redis.del(CACHE_KEY);
  }

  /**
   * Puts the saved boxes in a new order, given as their current slot numbers
   * top to bottom. Every saved box must be listed exactly once: a box left
   * out would keep a slot that collides with the new order.
   */
  async reorder(input: ReorderPromoTilesInput): Promise<PromoTile[]> {
    const rows = await this.prisma.promoTile.findMany({ select: { id: true, slot: true } });
    const idBySlot = new Map(rows.map((row) => [row.slot, row.id]));
    if (
      input.slots.length !== rows.length ||
      new Set(input.slots).size !== input.slots.length ||
      !input.slots.every((slot) => idBySlot.has(slot))
    ) {
      throw new BadRequestException('Send every saved box exactly once, in the new order');
    }
    await this.renumber(
      input.slots.map((slot) => idBySlot.get(slot)!),
      1,
    );
    await this.redis.del(CACHE_KEY);
    return this.all();
  }

  /**
   * Gives `ids` consecutive slots. Two passes because `slot` is unique: every
   * row first moves out of the way, past any slot in use, then into place.
   */
  private async renumber(ids: string[], start: number): Promise<void> {
    if (ids.length === 0) return;
    const offset = 10_000;
    await this.prisma.$transaction([
      ...ids.map((id, index) =>
        this.prisma.promoTile.update({ where: { id }, data: { slot: offset + index } }),
      ),
      ...ids.map((id, index) =>
        this.prisma.promoTile.update({ where: { id }, data: { slot: start + index } }),
      ),
    ]);
  }
}
