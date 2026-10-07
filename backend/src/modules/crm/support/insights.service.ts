import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TICKET_OPEN_STATUSES, type CrmRangeQuery, type DirectMessageInput } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { supportAudit } from '../core/audit';
import { resolveRange } from '../core/time';
import { OutboxService } from '../email/outbox.service';
import { escapeHtml } from '../email/sanitizer';
import type { SupportActor } from './tickets.service';

const SUPPORT_TIMEZONE = 'America/Toronto';

/**
 * The support desk's views of the platform: its overview and reports, the
 * Dealer 360 and User 360 pages, and direct messages to users and dealers.
 * Only what support needs is shown: no password data, no financial records,
 * no dealer's leads.
 */
@Injectable()
export class SupportInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
  ) {}

  async overview(actorId: string) {
    const now = new Date();
    const open = { in: [...TICKET_OPEN_STATUSES] };
    const [byStatus, mine, unassigned, overdue, breached, tasksOpen, tasksOverdue, recent] = await Promise.all([
      this.prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.supportTicket.count({ where: { assignedToId: actorId, status: open } }),
      this.prisma.supportTicket.count({ where: { assignedToId: null, status: open } }),
      this.prisma.supportTicket.count({ where: { status: open, dueAt: { lt: now } } }),
      this.prisma.supportTicket.count({ where: { status: open, firstResponseAt: null, firstResponseDueAt: { lt: now } } }),
      this.prisma.adminTask.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.adminTask.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: now } } }),
      this.prisma.supportTicket.findMany({
        where: { status: open },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: { id: true, number: true, subject: true, status: true, priority: true, updatedAt: true, requesterEmail: true },
      }),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      open: byStatus.filter((row) => TICKET_OPEN_STATUSES.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0),
      mine,
      unassigned,
      overdue,
      firstResponseBreached: breached,
      tasksOpen,
      tasksOverdue,
      recent,
    };
  }

  async reports(range: CrmRangeQuery) {
    const { from, to } = resolveRange(range.preset, SUPPORT_TIMEZONE, range);
    const created = { createdAt: { gte: from, lt: to } };
    const [total, resolved, byCategory, byPriority, byDealer, byAdmin, bySource, reopened, durations, messages, emails, openNow, overdueNow] =
      await Promise.all([
        this.prisma.supportTicket.count({ where: created }),
        this.prisma.supportTicket.count({ where: { resolvedAt: { gte: from, lt: to } } }),
        this.prisma.supportTicket.groupBy({ by: ['categoryId'], where: created, _count: { _all: true } }),
        this.prisma.supportTicket.groupBy({ by: ['priority'], where: created, _count: { _all: true } }),
        this.prisma.supportTicket.groupBy({ by: ['dealerId'], where: { ...created, dealerId: { not: null } }, _count: { _all: true }, orderBy: { _count: { dealerId: 'desc' } }, take: 10 }),
        this.prisma.supportTicket.groupBy({ by: ['assignedToId'], where: created, _count: { _all: true } }),
        this.prisma.supportTicket.groupBy({ by: ['source'], where: created, _count: { _all: true } }),
        this.prisma.supportTicket.count({ where: { ...created, reopenedCount: { gt: 0 } } }),
        this.prisma.$queryRaw<Array<{ resolution: number | null; first_response: number | null }>>`
          SELECT
            avg(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600)::float AS resolution,
            avg(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 3600)::float AS first_response
          FROM "SupportTicket" WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`,
        this.prisma.supportTicketMessage.groupBy({ by: ['visibility', 'authorRole'], where: created, _count: { _all: true } }),
        this.prisma.crmEmail.count({ where: { scope: 'SUPPORT', ...created } }),
        this.prisma.supportTicket.count({ where: { status: { in: [...TICKET_OPEN_STATUSES] } } }),
        this.prisma.supportTicket.count({ where: { status: { in: [...TICKET_OPEN_STATUSES] }, dueAt: { lt: new Date() } } }),
      ]);
    const [categories, dealers, admins] = await Promise.all([
      this.prisma.supportCategory.findMany({ select: { id: true, label: true, key: true } }),
      this.prisma.dealer.findMany({ where: { id: { in: byDealer.map((row) => row.dealerId!) } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({
        where: { id: { in: byAdmin.map((row) => row.assignedToId).filter((id): id is string => !!id) } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const categoryOf = new Map(categories.map((row) => [row.id, row]));
    const count = (key: string) => byCategory.find((row) => categoryOf.get(row.categoryId ?? '')?.key === key)?._count._all ?? 0;
    return {
      range: { from, to },
      created: total,
      resolved,
      openNow,
      overdueNow,
      reopened,
      averageResolutionHours: durations[0]?.resolution ?? null,
      averageFirstResponseHours: durations[0]?.first_response ?? null,
      userIssues: count('USER_ISSUE') + count('ACCOUNT'),
      dealerIssues: count('DEALER_ISSUE') + count('VERIFICATION'),
      featureRequests: count('FEATURE_REQUEST'),
      byCategory: byCategory.map((row) => ({ label: categoryOf.get(row.categoryId ?? '')?.label ?? 'Uncategorised', count: row._count._all })),
      byPriority: byPriority.map((row) => ({ label: row.priority, count: row._count._all })),
      bySource: bySource.map((row) => ({ label: row.source, count: row._count._all })),
      byDealer: byDealer.map((row) => ({ label: dealers.find((d) => d.id === row.dealerId)?.name ?? 'Unknown', id: row.dealerId, count: row._count._all })),
      byAdmin: byAdmin.map((row) => {
        const admin = admins.find((a) => a.id === row.assignedToId);
        return { label: admin ? `${admin.firstName} ${admin.lastName}` : 'Unassigned', count: row._count._all };
      }),
      communication: {
        emails,
        publicReplies: messages.filter((row) => row.visibility === 'PUBLIC' && row.authorRole === 'ADMIN').reduce((s, r) => s + r._count._all, 0),
        requesterMessages: messages.filter((row) => row.authorRole === 'REQUESTER').reduce((s, r) => s + r._count._all, 0),
        internalNotes: messages.filter((row) => row.visibility === 'INTERNAL').reduce((s, r) => s + r._count._all, 0),
      },
    };
  }

  // --- 360 views --------------------------------------------------------------------

  async dealers(q?: string) {
    return this.prisma.dealer.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { owner: { email: { contains: q.toLowerCase() } } },
              { city: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: { name: 'asc' },
      take: 100,
      select: {
        id: true,
        name: true,
        status: true,
        verified: true,
        city: true,
        province: true,
        createdAt: true,
        owner: { select: { id: true, email: true, firstName: true, lastName: true } },
        _count: { select: { supportTickets: { where: { status: { in: [...TICKET_OPEN_STATUSES] } } }, staff: true } },
      },
    });
  }

  async dealer360(dealerId: string) {
    const dealer = await this.prisma.dealer.findUnique({
      where: { id: dealerId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        verified: true,
        verifiedAt: true,
        verificationNote: true,
        phone: true,
        websiteUrl: true,
        city: true,
        province: true,
        createdAt: true,
        owner: { select: { id: true, email: true, firstName: true, lastName: true, status: true, lastLoginAt: true, emailVerified: true } },
        staff: { select: { role: true, createdAt: true, user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } } } },
      },
    });
    if (!dealer) throw new NotFoundException('Dealer not found');
    const userIds = [dealer.owner.id, ...dealer.staff.map((member) => member.user.id)];
    const [inventory, tickets, tasks, emails, notes, activity, audit] = await Promise.all([
      this.prisma.vehicle.groupBy({ by: ['status'], where: { sellerId: dealer.owner.id }, _count: { _all: true } }),
      this.prisma.supportTicket.findMany({
        where: { OR: [{ dealerId }, { requesterId: { in: userIds } }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true, resolvedAt: true },
      }),
      this.prisma.adminTask.findMany({
        where: { dealerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.crmEmail.findMany({
        where: { scope: 'SUPPORT', OR: [{ userId: { in: userIds } }, { ticket: { dealerId } }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, subject: true, status: true, toEmail: true, sentAt: true, createdAt: true, ticketId: true },
      }),
      this.prisma.supportTicketMessage.findMany({
        where: { visibility: 'INTERNAL', ticket: { OR: [{ dealerId }, { requesterId: { in: userIds } }] } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, body: true, createdAt: true, ticket: { select: { id: true, number: true } }, author: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { OR: [{ actorId: { in: userIds } }, { entityId: dealerId }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, action: true, entityType: true, actorEmail: true, createdAt: true },
      }),
      this.prisma.crmAuditLog.findMany({
        where: { scope: 'SUPPORT', dealerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, action: true, entityType: true, actorEmail: true, createdAt: true },
      }),
    ]);
    return {
      dealer,
      inventory: Object.fromEntries(inventory.map((row) => [row.status, row._count._all])),
      tickets: {
        open: tickets.filter((t) => TICKET_OPEN_STATUSES.includes(t.status)),
        closed: tickets.filter((t) => !TICKET_OPEN_STATUSES.includes(t.status)),
      },
      tasks,
      communication: emails,
      notes,
      activity,
      audit,
    };
  }

  async users(q?: string) {
    return this.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q.toLowerCase() } },
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { username: { contains: q.toLowerCase() } },
            ],
          }
        : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        _count: { select: { supportTicketsRequested: true } },
      },
    });
  }

  async user360(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        city: true,
        role: true,
        status: true,
        emailVerified: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        dealer: { select: { id: true, name: true, status: true, verified: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const [memberships, tickets, tasks, emails, notifications, activity, listings] = await Promise.all([
      this.prisma.dealerMember.findMany({
        where: { userId },
        select: { role: true, dealer: { select: { id: true, name: true } } },
      }),
      this.prisma.supportTicket.findMany({
        where: { OR: [{ requesterId: userId }, { requesterEmail: user.email }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true },
      }),
      this.prisma.adminTask.findMany({
        where: { subjectUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.crmEmail.findMany({
        where: { scope: 'SUPPORT', OR: [{ userId }, { toEmail: user.email }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, subject: true, status: true, sentAt: true, createdAt: true, ticketId: true },
      }),
      this.prisma.notification.findMany({
        where: { userId, type: 'SUPPORT_TICKET' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, title: true, createdAt: true, readAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { OR: [{ actorId: userId }, { entityId: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, action: true, entityType: true, actorEmail: true, createdAt: true },
      }),
      this.prisma.vehicle.count({ where: { sellerId: userId } }),
    ]);
    return {
      user,
      memberships,
      listings,
      tickets: {
        open: tickets.filter((t) => TICKET_OPEN_STATUSES.includes(t.status)),
        closed: tickets.filter((t) => !TICKET_OPEN_STATUSES.includes(t.status)),
      },
      tasks,
      communication: { emails, notifications },
      activity,
    };
  }

  // --- Communication ------------------------------------------------------------------

  /** A message from support to a user or to a dealer (its owner), by email and/or in the app. */
  async directMessage(actor: SupportActor & { id: string }, input: DirectMessageInput) {
    let recipient: { id: string; email: string; firstName: string; lastName: string } | null = null;
    if (input.userId) {
      recipient = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, firstName: true, lastName: true } });
    } else if (input.dealerId) {
      const dealer = await this.prisma.dealer.findUnique({
        where: { id: input.dealerId },
        select: { owner: { select: { id: true, email: true, firstName: true, lastName: true } } },
      });
      recipient = dealer?.owner ?? null;
    }
    if (!recipient) throw new BadRequestException('Choose a user or a dealer');
    if (input.ticketId && !(await this.prisma.supportTicket.findUnique({ where: { id: input.ticketId }, select: { id: true } }))) {
      throw new BadRequestException('Unknown ticket');
    }
    const result: { emailId?: string; emailStatus?: string; inApp?: boolean } = {};
    if (input.channels.includes('EMAIL')) {
      const html = input.body
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
      const email = await this.outbox.queueDirectEmail({
        toEmail: recipient.email,
        toName: `${recipient.firstName} ${recipient.lastName}`.trim(),
        userId: recipient.id,
        subject: input.subject,
        bodyHtml: `<p>Hi ${escapeHtml(recipient.firstName)},</p>\n${html}\n<p>— Vintrax Support</p>`,
        ticketId: input.ticketId,
        actorId: actor.id,
      });
      result.emailId = email.id;
      result.emailStatus = email.status;
    }
    if (input.channels.includes('IN_APP')) {
      await this.notifications.notify({
        userId: recipient.id,
        type: 'SUPPORT_TICKET',
        title: input.subject,
        body: input.body.slice(0, 500),
        link: input.ticketId ? `/dashboard/support/${input.ticketId}` : '/dashboard/support',
      });
      result.inApp = true;
    }
    if (input.ticketId) {
      await this.prisma.supportTicketEvent.create({
        data: { ticketId: input.ticketId, actorId: actor.id, type: 'MESSAGE_SENT', detail: `${input.channels.join(', ')}: ${input.subject}` },
      });
    }
    await supportAudit(this.prisma, actor, {
      action: 'support.message_sent',
      entityType: 'User',
      entityId: recipient.id,
      dealerId: input.dealerId,
      after: { subject: input.subject, channels: input.channels, ticketId: input.ticketId },
    });
    return result;
  }

  communicationLog(page: number, pageSize: number) {
    return this.prisma.crmEmail.findMany({
      where: { scope: 'SUPPORT' },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        toEmail: true,
        toName: true,
        subject: true,
        status: true,
        sentAt: true,
        createdAt: true,
        lastError: true,
        ticket: { select: { id: true, number: true } },
      },
    });
  }

  audit(page: number, pageSize: number) {
    return this.prisma.crmAuditLog.findMany({
      where: { scope: 'SUPPORT' },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }
}
