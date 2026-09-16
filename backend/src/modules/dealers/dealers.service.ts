import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DealerAnalytics,
  DealerDetail,
  DealerSummary,
  Paginated,
  VerifyDealerInput,
} from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { toVehicleSummary, vehicleSummarySelect } from '../vehicles/vehicles.mapper';

const dealerSummarySelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  verified: true,
  logoUrl: true,
  city: true,
  province: true,
} satisfies Prisma.DealerSelect;

@Injectable()
export class DealersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  async findBySlug(slug: string): Promise<DealerDetail> {
    const dealer = await this.prisma.dealer.findUnique({
      where: { slug },
      select: {
        ...dealerSummarySelect,
        businessNumber: true,
        licenceNumber: true,
        description: true,
        websiteUrl: true,
        phone: true,
        createdAt: true,
        ownerId: true,
      },
    });
    if (!dealer) throw new NotFoundException('Dealer not found');

    const [activeListingCount, completedSaleCount] = await Promise.all([
      this.prisma.vehicle.count({
        where: { sellerId: dealer.ownerId, status: { in: ['ACTIVE', 'IN_AUCTION'] } },
      }),
      this.prisma.transactionRecord.count({
        where: { sellerId: dealer.ownerId, status: 'COMPLETED' },
      }),
    ]);

    return {
      id: dealer.id,
      name: dealer.name,
      slug: dealer.slug,
      status: dealer.status,
      verified: dealer.verified,
      logoUrl: dealer.logoUrl,
      city: dealer.city,
      province: dealer.province,
      businessNumber: dealer.businessNumber,
      licenceNumber: dealer.licenceNumber,
      description: dealer.description,
      websiteUrl: dealer.websiteUrl,
      phone: dealer.phone,
      activeListingCount,
      completedSaleCount,
      memberSince: dealer.createdAt.toISOString(),
    };
  }

  async list(
    page: number,
    pageSize: number,
    filters: { status?: string; verifiedOnly?: boolean; q?: string } = {},
  ): Promise<Paginated<DealerSummary>> {
    // A plain `contains` over the few fields a dealership is looked up by.
    // Terms are ANDed so that typing more narrows the list.
    const terms = (filters.q ?? '')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 6);

    const where: Prisma.DealerWhereInput = {
      ...(filters.status
        ? { status: filters.status as Prisma.EnumDealerStatusFilter['equals'] }
        : {}),
      ...(filters.verifiedOnly ? { verified: true } : {}),
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { city: { contains: term, mode: 'insensitive' as const } },
                { description: { contains: term, mode: 'insensitive' as const } },
              ],
            })),
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.dealer.count({ where }),
      this.prisma.dealer.findMany({
        where,
        select: dealerSummarySelect,
        orderBy: [{ verified: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Admin decision on a dealer's verification application. */
  async verify(dealerId: string, input: VerifyDealerInput, actor: AuthUser): Promise<DealerDetail> {
    const dealer = await this.prisma.dealer.findUnique({
      where: { id: dealerId },
      select: { id: true, slug: true, ownerId: true },
    });
    if (!dealer) throw new NotFoundException('Dealer not found');

    await this.prisma.dealer.update({
      where: { id: dealerId },
      data: {
        status: input.approved ? 'VERIFIED' : 'REJECTED',
        verified: input.approved,
        verifiedAt: input.approved ? new Date() : null,
        verificationNote: input.notes ?? null,
      },
    });

    await this.queue.enqueue(QUEUE_NAMES.notifications, 'dealer-verified', {
      userId: dealer.ownerId,
      approved: input.approved,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: input.approved ? 'dealer.verified' : 'dealer.rejected',
      entityType: 'Dealer',
      entityId: dealerId,
      metadata: { notes: input.notes ?? null },
    });

    return this.findBySlug(dealer.slug);
  }

  /** The vehicles a dealer currently has published. */
  async listInventory(slug: string, page: number, pageSize: number) {
    const dealer = await this.prisma.dealer.findUnique({
      where: { slug },
      select: { ownerId: true },
    });
    if (!dealer) throw new NotFoundException('Dealer not found');

    const where: Prisma.VehicleWhereInput = {
      sellerId: dealer.ownerId,
      status: { in: ['ACTIVE', 'IN_AUCTION'] },
    };

    const [total, rows] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        select: vehicleSummarySelect,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => toVehicleSummary(row, new Set())),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Dashboard metrics for the calling seller.
   *
   * Works for private sellers too — the numbers are keyed on the user, not on
   * the presence of a dealership.
   */
  async analytics(user: AuthUser): Promise<DealerAnalytics> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      activeListings,
      draftListings,
      soldThisMonth,
      salesAggregate,
      viewsAggregate,
      enquiryCount,
      topRows,
      soldVehicles,
    ] = await Promise.all([
      this.prisma.vehicle.count({
        where: { sellerId: user.id, status: { in: ['ACTIVE', 'IN_AUCTION'] } },
      }),
      this.prisma.vehicle.count({ where: { sellerId: user.id, status: 'DRAFT' } }),
      this.prisma.transactionRecord.count({
        where: { sellerId: user.id, status: 'COMPLETED', completedAt: { gte: monthStart } },
      }),
      this.prisma.transactionRecord.aggregate({
        where: { sellerId: user.id, status: 'COMPLETED', completedAt: { gte: monthStart } },
        _sum: { salePriceCad: true },
      }),
      this.prisma.vehicle.aggregate({
        where: { sellerId: user.id },
        _sum: { viewCount: true },
      }),
      this.prisma.conversation.count({ where: { sellerId: user.id } }),
      this.prisma.vehicle.findMany({
        where: { sellerId: user.id, status: { in: ['ACTIVE', 'IN_AUCTION'] } },
        select: {
          ...vehicleSummarySelect,
          viewCount: true,
          _count: { select: { images: true, conversations: true } },
        },
        orderBy: { viewCount: 'desc' },
        take: 5,
      }),
      this.prisma.vehicle.findMany({
        where: { sellerId: user.id, status: 'SOLD', soldAt: { not: null } },
        select: { publishedAt: true, soldAt: true },
        take: 100,
      }),
    ]);

    // Average days from publication to sale, over the vehicles that have both
    // timestamps. Null rather than zero when there is nothing to average.
    const durations = soldVehicles
      .filter((row) => row.publishedAt && row.soldAt)
      .map((row) => (row.soldAt!.getTime() - row.publishedAt!.getTime()) / 86_400_000);
    const averageDaysToSell =
      durations.length > 0
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null;

    return {
      activeListings,
      draftListings,
      soldThisMonth,
      grossSalesCadThisMonth: salesAggregate._sum.salePriceCad ?? 0,
      totalViews: viewsAggregate._sum.viewCount ?? 0,
      totalEnquiries: enquiryCount,
      averageDaysToSell,
      viewsSeries: await this.viewsSeries(user.id),
      salesSeries: await this.salesSeries(user.id),
      topVehicles: topRows.map((row) => ({
        vehicle: toVehicleSummary(row, new Set()),
        views: row.viewCount,
        enquiries: row._count.conversations,
      })),
    };
  }

  /**
   * Listings published per day over the last 30 days.
   *
   * Per-view timestamps are not stored — `viewCount` is a running total — so
   * this series reports publishing activity rather than traffic. Real traffic
   * analytics need an events table.
   */
  private async viewsSeries(sellerId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; value: bigint }>>`
      SELECT date_trunc('day', "publishedAt") AS day, COUNT(*)::bigint AS value
      FROM "Vehicle"
      WHERE "sellerId" = ${sellerId}::uuid
        AND "publishedAt" >= NOW() - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      value: Number(row.value),
    }));
  }

  private async salesSeries(sellerId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; value: bigint }>>`
      SELECT date_trunc('day', "completedAt") AS day, SUM("salePriceCad")::bigint AS value
      FROM "TransactionRecord"
      WHERE "sellerId" = ${sellerId}::uuid
        AND "status" = 'COMPLETED'
        AND "completedAt" >= NOW() - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      value: Number(row.value),
    }));
  }
}
