import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BODY_TYPES,
  type AdminAnalytics,
  type BodyType,
  type BodyTypeImage,
  type BodyTypeImageInput,
  type TimeSeriesPoint,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';

/** Analytics are expensive and rarely need to be to-the-second fresh. */
const ANALYTICS_CACHE_TTL_SECONDS = 120;

/**
 * Body-type photographs change when an operator changes them, which is close
 * to never, and are read on every home page render. The writes invalidate the
 * key, so the long window costs nothing in freshness.
 */
const BODY_TYPE_IMAGE_CACHE_KEY = 'site:body-type-images';
const BODY_TYPE_IMAGE_CACHE_TTL = 600;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async analytics(): Promise<AdminAnalytics> {
    return this.redis.remember('admin:analytics', ANALYTICS_CACHE_TTL_SECONDS, async () => {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [
        totalUsers,
        newUsersThisMonth,
        pendingDealers,
        activeListings,
        listingsPendingReview,
        liveAuctions,
        gmv,
        revenue,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
        this.prisma.dealer.count({ where: { status: 'PENDING' } }),
        this.prisma.vehicle.count({ where: { status: { in: ['ACTIVE', 'IN_AUCTION'] } } }),
        this.prisma.vehicle.count({ where: { status: 'PENDING_REVIEW' } }),
        this.prisma.auction.count({ where: { status: 'LIVE' } }),
        this.prisma.transactionRecord.aggregate({
          where: { status: 'COMPLETED' },
          _sum: { salePriceCad: true },
        }),
        this.prisma.transactionRecord.aggregate({
          where: { status: 'COMPLETED' },
          _sum: { platformFeeCad: true },
        }),
      ]);

      const [usersSeries, listingsSeries, salesSeries] = await Promise.all([
        this.dailySeries('User', 'createdAt'),
        this.dailySeries('Vehicle', 'publishedAt'),
        this.salesSeries(),
      ]);

      return {
        totalUsers,
        newUsersThisMonth,
        pendingDealers,
        activeListings,
        listingsPendingReview,
        liveAuctions,
        grossMerchandiseValueCad: gmv._sum.salePriceCad ?? 0,
        platformRevenueCad: revenue._sum.platformFeeCad ?? 0,
        usersSeries,
        listingsSeries,
        salesSeries,
      };
    });
  }

  /**
   * Daily counts over the last 30 days.
   *
   * The table and column are interpolated rather than parameterised, which is
   * only safe because both are chosen from this file's own literals — no
   * caller-supplied value ever reaches here.
   */
  private async dailySeries(
    table: 'User' | 'Vehicle',
    column: 'createdAt' | 'publishedAt',
  ): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ day: Date; value: bigint }>>(
      `SELECT date_trunc('day', "${column}") AS day, COUNT(*)::bigint AS value
       FROM "${table}"
       WHERE "${column}" >= NOW() - INTERVAL '30 days'
       GROUP BY day
       ORDER BY day ASC`,
    );
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      value: Number(row.value),
    }));
  }

  /**
   * Every body type, with its photograph if one is set.
   *
   * Returns all nine rather than only the rows that exist, so the admin screen
   * lists the shortcuts a shopper will actually see — including the empty ones,
   * which are the whole reason to open the page.
   */
  async bodyTypeImages(): Promise<BodyTypeImage[]> {
    const rows = await this.prisma.bodyTypeImage.findMany();
    const byType = new Map(rows.map((row) => [row.bodyType, row]));

    return BODY_TYPES.map((bodyType) => {
      const row = byType.get(bodyType);
      return {
        bodyType,
        imageUrl: row?.imageUrl ?? null,
        alt: row?.alt ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async setBodyTypeImage(
    bodyType: BodyType,
    input: BodyTypeImageInput,
    actorId: string,
  ): Promise<BodyTypeImage> {
    if (!this.storage.isOwnUrl(input.imageUrl)) {
      throw new BadRequestException(
        'Upload the image through POST /uploads/body-type-images first, then pass the URL it returns. An address on another server is not accepted.',
      );
    }

    const row = await this.prisma.bodyTypeImage.upsert({
      where: { bodyType },
      create: { bodyType, imageUrl: input.imageUrl, alt: input.alt ?? null, updatedById: actorId },
      update: { imageUrl: input.imageUrl, alt: input.alt ?? null, updatedById: actorId },
    });

    await this.redis.del(BODY_TYPE_IMAGE_CACHE_KEY);

    return {
      bodyType: row.bodyType,
      imageUrl: row.imageUrl,
      alt: row.alt,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Drops the row, so the shortcut falls back to an inventory photo. The file
   * itself is left in storage: an operator who removes the wrong picture can
   * re-point at it, and an orphaned image costs bytes rather than correctness.
   */
  async clearBodyTypeImage(bodyType: BodyType): Promise<BodyTypeImage> {
    await this.prisma.bodyTypeImage.deleteMany({ where: { bodyType } });
    await this.redis.del(BODY_TYPE_IMAGE_CACHE_KEY);
    return { bodyType, imageUrl: null, alt: null, updatedAt: null };
  }

  /**
   * The public view, for the home page.
   *
   * Cached because every visitor's first paint reads it and it changes when an
   * administrator saves, which is rarely. Both writes above drop the key, so
   * the change is visible immediately rather than at the end of the window.
   */
  async publicBodyTypeImages(): Promise<BodyTypeImage[]> {
    return this.redis.remember(BODY_TYPE_IMAGE_CACHE_KEY, BODY_TYPE_IMAGE_CACHE_TTL, () =>
      this.bodyTypeImages(),
    );
  }

  private async salesSeries(): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; value: bigint }>>`
      SELECT date_trunc('day', "completedAt") AS day, SUM("salePriceCad")::bigint AS value
      FROM "TransactionRecord"
      WHERE "status" = 'COMPLETED' AND "completedAt" >= NOW() - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      value: Number(row.value),
    }));
  }
}
