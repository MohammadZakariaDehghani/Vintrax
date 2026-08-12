import { Injectable } from '@nestjs/common';
import type { AdminAnalytics, TimeSeriesPoint } from '@atlas/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

/** Analytics are expensive and rarely need to be to-the-second fresh. */
const ANALYTICS_CACHE_TTL_SECONDS = 120;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
