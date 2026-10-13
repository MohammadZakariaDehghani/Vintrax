import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, VehicleReviewAction, VehicleReviewStatus } from '@prisma/client';
import {
  ANONYMOUS_REVIEWER,
  REVIEW_REJECTION_REASON_LABELS,
  type AdminReviewDetail,
  type AdminReviewListQuery,
  type AdminReviewRow,
  type Paginated,
  type ReviewBulkInput,
  type ReviewBulkResult,
  type ReviewFlag,
  type ReviewHistoryEntry,
  type ReviewMetrics,
  type ReviewRejectInput,
} from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { Env } from '../../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { summaryCacheKey } from './reviews.service';

const DAY = 86_400_000;
const METRICS_KEY = 'reviews:metrics';
const METRICS_TTL_SECONDS = 60;

/** Which states each moderation action may start from. Anything else is a conflict. */
const TRANSITIONS: Record<
  'approve' | 'reject' | 'hide' | 'restore' | 'delete',
  { from: VehicleReviewStatus[]; action: VehicleReviewAction }
> = {
  approve: { from: ['PENDING', 'REJECTED'], action: 'APPROVED' },
  reject: { from: ['PENDING'], action: 'REJECTED' },
  hide: { from: ['APPROVED'], action: 'HIDDEN' },
  // A hidden review goes back up; a deleted one goes back to the queue, to be looked at again.
  restore: { from: ['HIDDEN', 'DELETED'], action: 'RESTORED' },
  delete: { from: ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN'], action: 'DELETED' },
};
type Move = keyof typeof TRANSITIONS;

const rowSelect = {
  id: true,
  rating: true,
  content: true,
  displayName: true,
  status: true,
  userId: true,
  verifiedPurchase: true,
  reportCount: true,
  openReportCount: true,
  flags: true,
  createdAt: true,
  updatedAt: true,
  vehicle: { select: { id: true, slug: true, title: true } },
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
} satisfies Prisma.VehicleReviewSelect;

type Row = Prisma.VehicleReviewGetPayload<{ select: typeof rowSelect }>;

/**
 * The review moderation desk. Every status change is checked against the
 * allowed transitions, made only if the review is still in the state the
 * moderator saw, and written to the review's history and the audit log.
 */
@Injectable()
export class ReviewsAdminService {
  private readonly logger = new Logger('Reviews');
  private readonly notifyAuthor: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.notifyAuthor = config.get('REVIEW_NOTIFY_AUTHOR', { infer: true });
  }

  async list(query: AdminReviewListQuery): Promise<Paginated<AdminReviewRow>> {
    const where = this.listWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.vehicleReview.count({ where }),
      this.prisma.vehicleReview.findMany({
        where,
        orderBy: [{ createdAt: query.sort === 'OLDEST' ? 'asc' : 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: rowSelect,
      }),
    ]);
    return {
      items: rows.map(toRow),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(id: string): Promise<AdminReviewDetail> {
    const review = await this.prisma.vehicleReview.findUnique({
      where: { id },
      select: {
        ...rowSelect,
        rejectionReason: true,
        rejectionNote: true,
        approvedAt: true,
        rejectedAt: true,
        hiddenAt: true,
        deletedAt: true,
        editedAt: true,
        ipHash: true,
        reports: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            reason: true,
            details: true,
            userId: true,
            createdAt: true,
            resolvedAt: true,
          },
        },
      },
    });
    if (!review) throw new NotFoundException('Review not found');
    const sameSourceCount = review.ipHash
      ? await this.prisma.vehicleReview.count({
          where: {
            ipHash: review.ipHash,
            id: { not: id },
            createdAt: { gte: new Date(Date.now() - 30 * DAY) },
          },
        })
      : 0;
    const iso = (value: Date | null) => value?.toISOString() ?? null;
    return {
      ...toRow(review),
      rejectionReason: review.rejectionReason,
      rejectionNote: review.rejectionNote,
      approvedAt: iso(review.approvedAt),
      rejectedAt: iso(review.rejectedAt),
      hiddenAt: iso(review.hiddenAt),
      deletedAt: iso(review.deletedAt),
      editedAt: iso(review.editedAt),
      sameSourceCount,
      reports: review.reports.map((report) => ({
        id: report.id,
        reason: report.reason,
        details: report.details,
        anonymous: !report.userId,
        createdAt: report.createdAt.toISOString(),
        resolvedAt: iso(report.resolvedAt),
      })),
    };
  }

  async history(id: string): Promise<ReviewHistoryEntry[]> {
    const exists = await this.prisma.vehicleReview.count({ where: { id } });
    if (!exists) throw new NotFoundException('Review not found');
    const rows = await this.prisma.vehicleReviewModerationLog.findMany({
      where: { reviewId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        action: true,
        previousStatus: true,
        newStatus: true,
        reason: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      reason: row.reason,
      actor: row.actor
        ? {
            id: row.actor.id,
            name: `${row.actor.firstName} ${row.actor.lastName}`.trim(),
            email: row.actor.email,
          }
        : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  approve(id: string, admin: AuthUser, note?: string | null) {
    return this.move(id, 'approve', admin, { reason: note ?? null });
  }

  reject(id: string, admin: AuthUser, input: ReviewRejectInput) {
    const label = REVIEW_REJECTION_REASON_LABELS[input.reason];
    return this.move(id, 'reject', admin, {
      reason: input.note ? `${label}: ${input.note}` : label,
      rejection: input,
    });
  }

  hide(id: string, admin: AuthUser, note?: string | null) {
    return this.move(id, 'hide', admin, { reason: note ?? null });
  }

  restore(id: string, admin: AuthUser, note?: string | null) {
    return this.move(id, 'restore', admin, { reason: note ?? null });
  }

  remove(id: string, admin: AuthUser, note?: string | null) {
    return this.move(id, 'delete', admin, { reason: note ?? null });
  }

  /** Marks a review's open reports as dealt with and clears its flag. */
  async resolveReports(
    id: string,
    admin: AuthUser,
    note?: string | null,
  ): Promise<AdminReviewDetail> {
    const review = await this.prisma.vehicleReview.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    await this.prisma.$transaction([
      this.prisma.vehicleReviewReport.updateMany({
        where: { reviewId: id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      }),
      this.prisma.vehicleReview.update({
        where: { id },
        data: { openReportCount: 0, flaggedAt: null },
      }),
      this.prisma.vehicleReviewModerationLog.create({
        data: {
          reviewId: id,
          actorId: admin.id,
          action: 'REPORTS_RESOLVED',
          previousStatus: review.status,
          newStatus: review.status,
          reason: note ?? null,
        },
      }),
    ]);
    await this.redis.del(METRICS_KEY);
    await this.recordAudit(admin, 'review.reports_resolved', id);
    return this.get(id);
  }

  /** Several at once; each succeeds or fails on its own, and the outcomes say which. */
  async bulk(input: ReviewBulkInput, admin: AuthUser): Promise<ReviewBulkResult> {
    const outcomes: ReviewBulkResult['outcomes'] = [];
    for (const id of [...new Set(input.ids)]) {
      try {
        if (input.action === 'APPROVE') await this.approve(id, admin, input.note);
        else if (input.action === 'HIDE') await this.hide(id, admin, input.note);
        else if (input.action === 'DELETE') await this.remove(id, admin, input.note);
        else await this.reject(id, admin, { reason: input.reason!, note: input.note ?? null });
        outcomes.push({ id, ok: true });
      } catch (error) {
        outcomes.push({ id, ok: false, error: (error as Error).message });
      }
    }
    const succeeded = outcomes.filter((outcome) => outcome.ok).length;
    return { succeeded, failed: outcomes.length - succeeded, outcomes };
  }

  /** Dashboard numbers, from counts and one average; cached for a minute. */
  metrics(): Promise<ReviewMetrics> {
    return this.redis.remember(METRICS_KEY, METRICS_TTL_SECONDS, async () => {
      const now = Date.now();
      const live = { status: { not: 'DELETED' as const } };
      const [total, pending, approved, reported, average, last7Days, last30Days] =
        await Promise.all([
          this.prisma.vehicleReview.count({ where: live }),
          this.prisma.vehicleReview.count({ where: { status: 'PENDING' } }),
          this.prisma.vehicleReview.count({ where: { status: 'APPROVED' } }),
          this.prisma.vehicleReview.count({ where: { ...live, openReportCount: { gt: 0 } } }),
          this.prisma.vehicleReview.aggregate({
            where: { status: 'APPROVED' },
            _avg: { rating: true },
          }),
          this.prisma.vehicleReview.count({
            where: { ...live, createdAt: { gte: new Date(now - 7 * DAY) } },
          }),
          this.prisma.vehicleReview.count({
            where: { ...live, createdAt: { gte: new Date(now - 30 * DAY) } },
          }),
        ]);
      const avg = average._avg.rating;
      return {
        total,
        pending,
        approved,
        reported,
        averageRating: avg === null ? null : Math.round(avg * 10) / 10,
        last7Days,
        last30Days,
      };
    });
  }

  // --- Internals ----------------------------------------------------------------------

  private async move(
    id: string,
    move: Move,
    admin: AuthUser,
    extra: { reason: string | null; rejection?: ReviewRejectInput },
  ): Promise<AdminReviewDetail> {
    const rule = TRANSITIONS[move];
    const review = await this.prisma.vehicleReview.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        vehicleId: true,
        userId: true,
        vehicle: { select: { title: true, slug: true } },
      },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (!rule.from.includes(review.status)) {
      throw new ConflictException(
        `A ${review.status.toLowerCase()} review cannot be ${pastTense(move)}`,
      );
    }
    const now = new Date();
    const next: VehicleReviewStatus =
      move === 'approve'
        ? 'APPROVED'
        : move === 'reject'
          ? 'REJECTED'
          : move === 'hide'
            ? 'HIDDEN'
            : move === 'delete'
              ? 'DELETED'
              : review.status === 'HIDDEN'
                ? 'APPROVED'
                : 'PENDING';

    const data: Prisma.VehicleReviewUncheckedUpdateManyInput = {
      status: next,
      moderatedById: admin.id,
    };
    if (next === 'APPROVED')
      Object.assign(data, {
        approvedAt: now,
        hiddenAt: null,
        rejectedAt: null,
        rejectionReason: null,
        rejectionNote: null,
      });
    if (next === 'REJECTED') {
      Object.assign(data, {
        rejectedAt: now,
        rejectionReason: extra.rejection!.reason,
        rejectionNote: extra.rejection!.note,
      });
    }
    if (next === 'HIDDEN') Object.assign(data, { hiddenAt: now });
    if (next === 'DELETED') Object.assign(data, { deletedAt: now });
    if (move === 'restore' && review.status === 'DELETED') Object.assign(data, { deletedAt: null });

    // Only if it is still in the state this moderator saw: two moderators
    // acting at once cannot both win.
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.vehicleReview.updateMany({
        where: { id, status: review.status },
        data,
      });
      if (changed.count !== 1)
        throw new ConflictException('Someone else changed this review; reload it');
      if (move === 'approve' && review.userId) {
        const sale = await tx.vehicleSale.findFirst({
          where: {
            vehicleId: review.vehicleId,
            status: 'POSTED',
            customer: { userId: review.userId },
          },
          select: { id: true },
        });
        await tx.vehicleReview.update({ where: { id }, data: { verifiedPurchase: !!sale } });
      }
      await tx.vehicleReviewModerationLog.create({
        data: {
          reviewId: id,
          actorId: admin.id,
          action: rule.action,
          previousStatus: review.status,
          newStatus: next,
          reason: extra.reason,
        },
      });
    });

    if (review.status === 'APPROVED' || next === 'APPROVED')
      await this.redis.del(summaryCacheKey(review.vehicleId));
    await this.redis.del(METRICS_KEY);
    const event = `review.${rule.action.toLowerCase()}`;
    this.logger.log(`${event} id=${id} from=${review.status} to=${next}`);
    await this.recordAudit(admin, event, id, { from: review.status, to: next });

    if (
      this.notifyAuthor &&
      review.userId &&
      (next === 'APPROVED' || next === 'REJECTED') &&
      review.status === 'PENDING'
    ) {
      await this.notifications
        .notify({
          userId: review.userId,
          type: next === 'APPROVED' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
          title: next === 'APPROVED' ? 'Your review is live' : 'Your review was not published',
          body:
            next === 'APPROVED'
              ? `Your review of the ${review.vehicle.title} is now on the listing. Thanks for sharing it.`
              : `Your review of the ${review.vehicle.title} did not meet our review guidelines, so it was not published.`,
          link: `/vehicles/${review.vehicle.slug}#reviews`,
        })
        .catch((error: unknown) =>
          this.logger.warn(`review notification failed: ${String(error)}`),
        );
    }
    return this.get(id);
  }

  private listWhere(query: AdminReviewListQuery): Prisma.VehicleReviewWhereInput {
    const and: Prisma.VehicleReviewWhereInput[] = [];
    if (query.view === 'REPORTED')
      and.push({ openReportCount: { gt: 0 }, status: { not: 'DELETED' } });
    else if (query.view === 'ALL') and.push({ status: { not: 'DELETED' } });
    else and.push({ status: query.view });
    if (query.rating) and.push({ rating: query.rating });
    if (query.author === 'ANONYMOUS') and.push({ userId: null });
    if (query.author === 'AUTHENTICATED') and.push({ userId: { not: null } });
    if (query.vehicleId) and.push({ vehicleId: query.vehicleId });
    if (query.from) and.push({ createdAt: { gte: new Date(`${query.from}T00:00:00Z`) } });
    if (query.to)
      and.push({ createdAt: { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + DAY) } });
    if (query.q) {
      const q = query.q;
      and.push({
        OR: [
          { content: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
          { vehicle: { title: { contains: q, mode: 'insensitive' } } },
          { vehicle: { vin: { equals: q.toUpperCase() } } },
          { vehicle: { stockNumber: { equals: q } } },
        ],
      });
    }
    return { AND: and };
  }

  private recordAudit(
    admin: AuthUser,
    action: string,
    reviewId: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      actorId: admin.id,
      actorEmail: admin.email,
      action,
      entityType: 'VehicleReview',
      entityId: reviewId,
      metadata: metadata ?? null,
    });
  }
}

function toRow(row: Row): AdminReviewRow {
  return {
    id: row.id,
    rating: row.rating,
    content: row.content,
    displayName: row.displayName || ANONYMOUS_REVIEWER,
    status: row.status,
    anonymous: !row.userId,
    verifiedPurchase: row.verifiedPurchase,
    reportCount: row.reportCount,
    openReportCount: row.openReportCount,
    flags: row.flags as ReviewFlag[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    vehicle: row.vehicle,
    user: row.user,
  };
}

function pastTense(move: Move): string {
  return {
    approve: 'approved',
    reject: 'rejected',
    hide: 'hidden',
    restore: 'restored',
    delete: 'deleted',
  }[move];
}
