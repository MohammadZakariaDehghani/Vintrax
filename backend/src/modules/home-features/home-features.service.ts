import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  parseMediaPresentation,
  type CreateHomeFeatureInput,
  type HomeFeature,
  type ReorderHomeFeaturesInput,
  type UpdateHomeFeatureInput,
} from '@vintrax/shared';
import type { HomeFeature as HomeFeatureRow } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaLibraryService, presentationJson } from '../media/media-library.service';

/** Read on every home page render, written rarely; every write drops the key. */
const CACHE_KEY = 'site:home-features';
const CACHE_TTL = 600;

function toHomeFeature(row: HomeFeatureRow): HomeFeature {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    media: parseMediaPresentation(row.media),
    layout: row.layout,
    buttonLabel: row.buttonLabel,
    buttonUrl: row.buttonUrl,
    buttonPlacement: row.buttonPlacement,
    position: row.position,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Feature blocks under "Recently listed" on the home page: as many as an
 * administrator makes, stacked in order, each with an optional photograph and
 * an optional button to a page on Vintrax or another website.
 */
@Injectable()
export class HomeFeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly media: MediaLibraryService,
  ) {}

  /** Every block, hidden ones included, top to bottom. */
  async all(): Promise<HomeFeature[]> {
    const rows = await this.prisma.homeFeature.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toHomeFeature);
  }

  /** What the home page shows: the enabled blocks, in order. */
  async published(): Promise<HomeFeature[]> {
    return this.redis.remember(CACHE_KEY, CACHE_TTL, async () =>
      (await this.all()).filter((feature) => feature.enabled),
    );
  }

  async create(input: CreateHomeFeatureInput, actorId: string): Promise<HomeFeature> {
    if (input.imageUrl) this.requireOwnImage(input.imageUrl);
    const media = (await this.media.resolve(input.media)) ?? null;
    // New blocks go to the bottom, where an administrator adding one expects it.
    const last = await this.prisma.homeFeature.aggregate({ _max: { position: true } });

    const row = await this.prisma.homeFeature.create({
      data: {
        title: input.title,
        subtitle: input.subtitle ?? null,
        body: input.body ?? null,
        media: presentationJson(media),
        ...(input.layout ? { layout: input.layout } : {}),
        imageUrl: input.imageUrl ?? null,
        imageAlt: input.imageAlt ?? null,
        buttonLabel: input.buttonLabel ?? null,
        buttonUrl: input.buttonUrl ?? null,
        ...(input.buttonPlacement ? { buttonPlacement: input.buttonPlacement } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        position: (last._max.position ?? -1) + 1,
        updatedById: actorId,
      },
    });
    await this.redis.del(CACHE_KEY);
    return toHomeFeature(row);
  }

  async update(id: string, input: UpdateHomeFeatureInput, actorId: string): Promise<HomeFeature> {
    if (input.imageUrl) this.requireOwnImage(input.imageUrl);
    const existing = await this.prisma.homeFeature.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Feature block not found');

    // Half a button is refused whether it arrives in one save or is left
    // behind by clearing only one of the pair.
    const label = input.buttonLabel !== undefined ? input.buttonLabel : existing.buttonLabel;
    const url = input.buttonUrl !== undefined ? input.buttonUrl : existing.buttonUrl;
    if (!label !== !url) {
      throw new BadRequestException('Give the button both a label and a link, or neither');
    }

    const { media: mediaInput, ...fields } = input;
    const media = await this.media.resolve(mediaInput);
    const row = await this.prisma.homeFeature.update({
      where: { id },
      data: {
        ...fields,
        ...(media !== undefined ? { media: presentationJson(media) } : {}),
        updatedById: actorId,
      },
    });
    await this.redis.del(CACHE_KEY);
    return toHomeFeature(row);
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.homeFeature.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Feature block not found');
    await this.redis.del(CACHE_KEY);
  }

  /**
   * Sets the order from a full list of ids, top to bottom. A partial list is
   * refused rather than guessed at: a block left out would otherwise keep a
   * position that collides with one in the new order.
   */
  async reorder(input: ReorderHomeFeaturesInput): Promise<HomeFeature[]> {
    const existing = await this.prisma.homeFeature.findMany({ select: { id: true } });
    const known = new Set(existing.map((row) => row.id));
    if (
      input.ids.length !== known.size ||
      new Set(input.ids).size !== input.ids.length ||
      !input.ids.every((id) => known.has(id))
    ) {
      throw new BadRequestException('Send every feature block exactly once, in the new order');
    }

    await this.prisma.$transaction(
      input.ids.map((id, position) =>
        this.prisma.homeFeature.update({ where: { id }, data: { position } }),
      ),
    );
    await this.redis.del(CACHE_KEY);
    return this.all();
  }

  /** The photo loads on the home page for every visitor, so it has to be one Vintrax issued. */
  private requireOwnImage(url: string): void {
    if (!this.storage.isOwnUrl(url)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/home-features first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }
  }
}
