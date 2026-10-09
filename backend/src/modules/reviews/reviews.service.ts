import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Prisma, type ListingStatus, type VehicleReviewStatus } from '@prisma/client';
import {
  ANONYMOUS_REVIEWER,
  REVIEW_EXISTS_MESSAGE,
  REVIEW_REPORTED_MESSAGE,
  REVIEW_SUBMITTED_MESSAGE,
  type MyReview,
  type PublicReview,
  type PublicReviewPage,
  type ReviewCreateInput,
  type ReviewFlag,
  type ReviewListQuery,
  type ReviewRatingSummary,
  type ReviewReportInput,
  type ReviewSubmitted,
  type ReviewUpdateInput,
} from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { Env } from '../../config/env';
import {
  afterCursor,
  contentFlags,
  contentHash,
  decodeCursor,
  encodeCursor,
  sortOrder,
  sourceHash,
} from './review-signals';

/** Listing states the public can see — the same rule as the vehicle page. */
const PUBLICLY_VISIBLE: ListingStatus[] = ['ACTIVE', 'IN_AUCTION', 'SOLD'];
const HOUR = 3_600_000;
const SUMMARY_TTL_SECONDS = 300;

/** Who is sending: the account if signed in, and the hashed address either way. */
export interface ReviewSource {
  user?: AuthUser;
  ip: string;
  userAgent?: string | null;
}

/** Only what the public may see. Never the author, address, status or moderation detail. */
const publicSelect = {
  id: true,
  rating: true,
  content: true,
  displayName: true,
  verifiedPurchase: true,
  createdAt: true,
  editedAt: true,
} satisfies Prisma.VehicleReviewSelect;

export function summaryCacheKey(vehicleId: string): string {
  return `reviews:summary:${vehicleId}`;
}

/**
 * Vehicle reviews as the public and their authors use them. Every new or
 * edited review is PENDING and invisible until an administrator approves it;
 * only APPROVED reviews are listed or counted in the rating.
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger('Reviews');
  private readonly hashKey: string;
  private readonly limits: {
    perIpPerHour: number;
    pendingPerIp: number;
    reportsPerIpPerHour: number;
    duplicateWindowMs: number;
    flagThreshold: number;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    // A key of its own, derived from the server secret, so a leaked hash
    // cannot be matched against hashes made anywhere else.
    this.hashKey = createHash('sha256')
      .update(`vintrax:reviews:${config.get('JWT_ACCESS_SECRET', { infer: true })}`)
      .digest('hex');
    this.limits = {
      perIpPerHour: config.get('REVIEW_MAX_PER_IP_PER_HOUR', { infer: true }),
      pendingPerIp: config.get('REVIEW_MAX_PENDING_PER_IP', { infer: true }),
      reportsPerIpPerHour: config.get('REVIEW_MAX_REPORTS_PER_IP_PER_HOUR', { infer: true }),
      duplicateWindowMs: config.get('REVIEW_DUPLICATE_WINDOW_HOURS', { infer: true }) * HOUR,
      flagThreshold: config.get('REVIEW_AUTO_FLAG_REPORT_THRESHOLD', { infer: true }),
    };
  }

  // --- Reading -------------------------------------------------------------------------

  async list(vehicleId: string, query: ReviewListQuery): Promise<PublicReviewPage> {
    await this.publicVehicle(vehicleId);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.vehicleReview.findMany({
      where: {
        vehicleId,
        status: 'APPROVED',
        ...(cursor ? afterCursor(query.sort, cursor) : {}),
      },
      orderBy: sortOrder(query.sort),
      take: query.limit + 1,
      select: publicSelect,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      reviews: page.map(toPublic),
      pagination: {
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last) : null,
      },
      ...(cursor ? {} : { summary: await this.summary(vehicleId) }),
    };
  }

  /** Average, count and distribution of APPROVED ratings, by one grouped query. */
  summary(vehicleId: string): Promise<ReviewRatingSummary> {
    return this.redis.remember(summaryCacheKey(vehicleId), SUMMARY_TTL_SECONDS, async () => {
      const groups = await this.prisma.vehicleReview.groupBy({
        by: ['rating'],
        where: { vehicleId, status: 'APPROVED' },
        _count: { _all: true },
      });
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as ReviewRatingSummary['distribution'];
      let total = 0;
      let points = 0;
      for (const group of groups) {
        const stars = group.rating as 1 | 2 | 3 | 4 | 5;
        distribution[stars] = group._count._all;
        total += group._count._all;
        points += group.rating * group._count._all;
      }
      return {
        average: total ? Math.round((points / total) * 10) / 10 : null,
        total,
        distribution,
      };
    });
  }

  /** The signed-in author's live review of this vehicle, in any state, or null. */
  async mine(vehicleId: string, user: AuthUser): Promise<MyReview | null> {
    const review = await this.prisma.vehicleReview.findFirst({
      where: { vehicleId, userId: user.id, status: { not: 'DELETED' } },
      select: {
        id: true,
        rating: true,
        content: true,
        displayName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!review) return null;
    return {
      ...review,
      displayName: review.displayName === ANONYMOUS_REVIEWER ? null : review.displayName,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  // --- Writing -------------------------------------------------------------------------

  async create(vehicleId: string, input: ReviewCreateInput, source: ReviewSource): Promise<ReviewSubmitted> {
    const vehicle = await this.publicVehicle(vehicleId);
    if (input.website) {
      // A filled honeypot is a bot. It gets the same answer as everyone, so it
      // has nothing to learn, and nothing is stored.
      this.logger.warn(`review.dropped reason=honeypot vehicle=${vehicleId}`);
      return { id: null, status: 'PENDING', message: REVIEW_SUBMITTED_MESSAGE };
    }
    const user = source.user;
    if (user) await this.assertNotSeller(vehicle, user.id);

    const ipHash = sourceHash(this.hashKey, `ip:${source.ip}`);
    const now = Date.now();
    await this.assertWithinLimits(ipHash, user?.id ?? null, now);

    const hash = contentHash(input.content);
    if (user) {
      const existing = await this.prisma.vehicleReview.findFirst({
        where: { vehicleId, userId: user.id, status: { not: 'DELETED' } },
        select: { id: true },
      });
      if (existing) throw new ConflictException({ message: REVIEW_EXISTS_MESSAGE, code: 'REVIEW_EXISTS' });
    } else {
      // Anonymous: one review waiting for moderation per vehicle per address.
      const waiting = await this.prisma.vehicleReview.count({
        where: { vehicleId, ipHash, status: 'PENDING', createdAt: { gte: new Date(now - this.limits.duplicateWindowMs) } },
      });
      if (waiting) throw new ConflictException({ message: REVIEW_EXISTS_MESSAGE, code: 'REVIEW_EXISTS' });
    }
    const duplicate = await this.prisma.vehicleReview.count({
      where: {
        vehicleId,
        contentHash: hash,
        status: { not: 'DELETED' },
        createdAt: { gte: new Date(now - this.limits.duplicateWindowMs) },
      },
    });
    if (duplicate) {
      throw new ConflictException({ message: 'This review has already been submitted.', code: 'REVIEW_DUPLICATE' });
    }

    const flags: ReviewFlag[] = contentFlags(input.content);
    const recentFromSource = await this.prisma.vehicleReview.count({
      where: { ipHash, createdAt: { gte: new Date(now - 24 * HOUR) } },
    });
    if (recentFromSource >= 2) flags.push('REPEATED_SOURCE');

    try {
      const review = await this.prisma.$transaction(async (tx) => {
        const created = await tx.vehicleReview.create({
          data: {
            vehicleId,
            userId: user?.id ?? null,
            displayName: input.displayName ?? ANONYMOUS_REVIEWER,
            rating: input.rating,
            content: input.content,
            contentHash: hash,
            flags,
            verifiedPurchase: user ? await this.isVerifiedPurchase(vehicleId, user.id, tx) : false,
            ipHash,
            userAgentHash: source.userAgent ? sourceHash(this.hashKey, `ua:${source.userAgent}`) : null,
          },
          select: { id: true },
        });
        await tx.vehicleReviewModerationLog.create({
          data: { reviewId: created.id, actorId: user?.id ?? null, action: 'SUBMITTED', newStatus: 'PENDING' },
        });
        return created;
      });
      this.logger.log(`review.created id=${review.id} vehicle=${vehicleId} anonymous=${!user} flags=${flags.join(',') || '-'}`);
      return { id: review.id, status: 'PENDING', message: REVIEW_SUBMITTED_MESSAGE };
    } catch (error) {
      // Two submissions racing past the check meet the unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: REVIEW_EXISTS_MESSAGE, code: 'REVIEW_EXISTS' });
      }
      throw error;
    }
  }

  /** The author edits their review; it leaves the public page until approved again. */
  async update(vehicleId: string, reviewId: string, input: ReviewUpdateInput, user: AuthUser): Promise<ReviewSubmitted> {
    const review = await this.ownReview(vehicleId, reviewId, user);
    const hash = contentHash(input.content);
    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleReview.update({
        where: { id: review.id },
        data: {
          rating: input.rating,
          content: input.content,
          contentHash: hash,
          displayName: input.displayName ?? ANONYMOUS_REVIEWER,
          flags: contentFlags(input.content),
          status: 'PENDING',
          editedAt: new Date(),
          approvedAt: null,
          rejectedAt: null,
          rejectionReason: null,
          rejectionNote: null,
          hiddenAt: null,
          verifiedPurchase: await this.isVerifiedPurchase(vehicleId, user.id, tx),
        },
      });
      await tx.vehicleReviewModerationLog.create({
        data: {
          reviewId: review.id,
          actorId: user.id,
          action: 'EDITED',
          previousStatus: review.status,
          newStatus: 'PENDING',
        },
      });
    });
    if (review.status === 'APPROVED') await this.redis.del(summaryCacheKey(vehicleId));
    this.logger.log(`review.edited id=${review.id} vehicle=${vehicleId}`);
    return { id: review.id, status: 'PENDING', message: REVIEW_SUBMITTED_MESSAGE };
  }

  /** The author withdraws their review. Kept, as DELETED, with its history. */
  async remove(vehicleId: string, reviewId: string, user: AuthUser): Promise<void> {
    const review = await this.ownReview(vehicleId, reviewId, user);
    await this.prisma.$transaction([
      this.prisma.vehicleReview.update({
        where: { id: review.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      }),
      this.prisma.vehicleReviewModerationLog.create({
        data: {
          reviewId: review.id,
          actorId: user.id,
          action: 'DELETED',
          previousStatus: review.status,
          newStatus: 'DELETED',
          reason: 'Withdrawn by the author',
        },
      }),
    ]);
    if (review.status === 'APPROVED') await this.redis.del(summaryCacheKey(vehicleId));
    this.logger.log(`review.deleted id=${review.id} by=author`);
  }

  /**
   * Reports a public review. It stays up: the report count rises, and enough
   * open reports flag it for an administrator. One report per account, or
   * per address for anonymous visitors.
   */
  async report(
    vehicleId: string,
    reviewId: string,
    input: ReviewReportInput,
    source: ReviewSource,
  ): Promise<{ message: string }> {
    const review = await this.prisma.vehicleReview.findFirst({
      where: { id: reviewId, vehicleId, status: 'APPROVED', vehicle: { status: { in: PUBLICLY_VISIBLE } } },
      select: { id: true, openReportCount: true, flaggedAt: true },
    });
    if (!review) throw new NotFoundException('Review not found');

    const reporterHash = sourceHash(this.hashKey, `ip:${source.ip}`);
    const lastHour = await this.prisma.vehicleReviewReport.count({
      where: { reporterHash, createdAt: { gte: new Date(Date.now() - HOUR) } },
    });
    if (lastHour >= this.limits.reportsPerIpPerHour) {
      throw new HttpException('Too many reports from this connection. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const already = await this.prisma.vehicleReviewReport.count({
      where: source.user
        ? { reviewId, userId: source.user.id }
        : { reviewId, userId: null, reporterHash },
    });
    if (already) throw new ConflictException({ message: "You've already reported this review.", code: 'REVIEW_ALREADY_REPORTED' });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.vehicleReviewReport.create({
          data: {
            reviewId,
            userId: source.user?.id ?? null,
            reporterHash,
            reason: input.reason,
            details: input.details,
          },
        });
        const updated = await tx.vehicleReview.update({
          where: { id: reviewId },
          data: { reportCount: { increment: 1 }, openReportCount: { increment: 1 } },
          select: { openReportCount: true, flaggedAt: true },
        });
        if (!updated.flaggedAt && updated.openReportCount >= this.limits.flagThreshold) {
          await tx.vehicleReview.update({ where: { id: reviewId }, data: { flaggedAt: new Date() } });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: "You've already reported this review.", code: 'REVIEW_ALREADY_REPORTED' });
      }
      throw error;
    }
    this.logger.log(`review.reported id=${reviewId} reason=${input.reason}`);
    return { message: REVIEW_REPORTED_MESSAGE };
  }

  // --- Rules ----------------------------------------------------------------------------

  /**
   * "Verified purchase" only when the books prove it: a posted sale of this
   * vehicle to a customer record linked to this account. Nothing else counts.
   */
  async isVerifiedPurchase(vehicleId: string, userId: string, db: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const sale = await db.vehicleSale.findFirst({
      where: { vehicleId, status: 'POSTED', customer: { userId } },
      select: { id: true },
    });
    return !!sale;
  }

  private async publicVehicle(vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, status: { in: PUBLICLY_VISIBLE } },
      select: { id: true, sellerId: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  /** A seller, or their dealership's staff, may not review their own listing. */
  private async assertNotSeller(vehicle: { sellerId: string }, userId: string): Promise<void> {
    if (vehicle.sellerId === userId) throw new ForbiddenException("You can't review your own listing.");
    const staff = await this.prisma.dealerMember.count({
      where: { userId, dealer: { ownerId: vehicle.sellerId } },
    });
    if (staff) throw new ForbiddenException("You can't review your own dealership's listing.");
  }

  private async assertWithinLimits(ipHash: string, userId: string | null, now: number): Promise<void> {
    const since = new Date(now - HOUR);
    const [fromAddress, waiting, fromAccount] = await Promise.all([
      this.prisma.vehicleReview.count({ where: { ipHash, createdAt: { gte: since } } }),
      this.prisma.vehicleReview.count({ where: { ipHash, status: 'PENDING' } }),
      userId ? this.prisma.vehicleReview.count({ where: { userId, createdAt: { gte: since } } }) : 0,
    ]);
    if (fromAddress >= this.limits.perIpPerHour || fromAccount >= this.limits.perIpPerHour) {
      this.logger.warn('review.rate_limited reason=hourly');
      throw new HttpException('You have sent several reviews recently. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (waiting >= this.limits.pendingPerIp) {
      this.logger.warn('review.rate_limited reason=pending');
      throw new HttpException(
        'Several reviews from this connection are already waiting for approval. Please try again once they have been reviewed.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async ownReview(vehicleId: string, reviewId: string, user: AuthUser) {
    // Someone else's review is "not found", not "forbidden": its existence is not theirs to learn.
    const review = await this.prisma.vehicleReview.findFirst({
      where: { id: reviewId, vehicleId, userId: user.id, status: { not: 'DELETED' } },
      select: { id: true, status: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    return review as { id: string; status: VehicleReviewStatus };
  }
}

function toPublic(row: {
  id: string;
  rating: number;
  content: string;
  displayName: string;
  verifiedPurchase: boolean;
  createdAt: Date;
  editedAt: Date | null;
}): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    content: row.content,
    displayName: row.displayName,
    verifiedPurchase: row.verifiedPurchase,
    createdAt: row.createdAt.toISOString(),
    edited: !!row.editedAt,
  };
}
