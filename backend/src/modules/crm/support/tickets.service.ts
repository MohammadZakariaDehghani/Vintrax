import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TICKET_OPEN_STATUSES,
  type CrmPriority,
  type PortalTicketInput,
  type TicketInput,
  type TicketListQuery,
  type TicketMessageInput,
  type TicketStatus,
  type TicketUpdateInput,
} from '@vintrax/shared';
import type { Prisma, TicketSource } from '@prisma/client';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthUser } from '../../../common/auth/auth-user';
import { supportAudit } from '../core/audit';
import { CrmBus } from '../core/bus';
import { CrmNotifyService } from '../core/notify.service';
import { CrmSetupService } from '../core/setup.service';
import { OutboxService } from '../email/outbox.service';
import { escapeHtml } from '../email/sanitizer';

export interface SupportActor {
  id: string | null;
  email: string | null;
}

export const SYSTEM_ACTOR: SupportActor = { id: null, email: 'system' };

const person = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

const ticketListSelect = {
  id: true,
  number: true,
  subject: true,
  status: true,
  priority: true,
  source: true,
  requesterEmail: true,
  requesterName: true,
  dueAt: true,
  firstResponseDueAt: true,
  firstResponseAt: true,
  lastPublicReplyAt: true,
  lastPublicReplyBy: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  requester: person,
  assignedTo: person,
  dealer: { select: { id: true, name: true } },
  category: { select: { id: true, key: true, label: true } },
  team: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.SupportTicketSelect;

/**
 * The Admin support CRM's tickets (D-066). Public messages reach the
 * requester; internal notes never leave the admin team — the requester-facing
 * methods below select PUBLIC messages only, and nothing else returns a
 * ticket to a non-admin.
 */
@Injectable()
export class TicketsService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notify: CrmNotifyService,
    private readonly bus: CrmBus,
    private readonly setup: CrmSetupService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- Admin --------------------------------------------------------------------------

  async list(query: TicketListQuery, actorId: string) {
    const now = new Date();
    const and: Prisma.SupportTicketWhereInput[] = [];
    switch (query.view) {
      case 'OPEN':
        and.push({ status: { in: [...TICKET_OPEN_STATUSES] } });
        break;
      case 'MINE':
        and.push({ assignedToId: actorId, status: { in: [...TICKET_OPEN_STATUSES] } });
        break;
      case 'UNASSIGNED':
        and.push({ assignedToId: null, status: { in: [...TICKET_OPEN_STATUSES] } });
        break;
      case 'OVERDUE':
        and.push({ status: { in: [...TICKET_OPEN_STATUSES] }, dueAt: { lt: now } });
        break;
      case 'WAITING':
        and.push({ status: { in: ['WAITING_FOR_USER', 'WAITING_FOR_DEALER'] } });
        break;
      case 'ESCALATED':
        and.push({ status: 'ESCALATED' });
        break;
      case 'RESOLVED':
        and.push({ status: { in: ['RESOLVED', 'CLOSED'] } });
        break;
      default:
        break;
    }
    if (query.status) and.push({ status: query.status });
    if (query.priority) and.push({ priority: query.priority });
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.dealerId) and.push({ dealerId: query.dealerId });
    if (query.requesterId) and.push({ requesterId: query.requesterId });
    if (query.q) {
      const number = /^#?(\d{1,9})$/.exec(query.q.trim())?.[1];
      and.push({
        OR: [
          { subject: { contains: query.q, mode: 'insensitive' } },
          { requesterEmail: { contains: query.q.toLowerCase() } },
          { requesterName: { contains: query.q, mode: 'insensitive' } },
          { dealer: { name: { contains: query.q, mode: 'insensitive' } } },
          ...(number ? [{ number: Number(number) }] : []),
        ],
      });
    }
    const where = { AND: and };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: ticketListSelect,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        tags: row.tags.map((entry) => entry.tag),
        overdue: TICKET_OPEN_STATUSES.includes(row.status) && !!row.dueAt && row.dueAt < now,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Everything about a ticket, internal notes included. Admins only. */
  async get(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: {
        ...ticketListSelect,
        description: true,
        resolution: true,
        closedAt: true,
        reopenedCount: true,
        waitingSince: true,
        supportChatId: true,
        contactMessageId: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
        },
        events: { orderBy: { createdAt: 'asc' } },
        tasks: { orderBy: { createdAt: 'desc' }, include: { assignedTo: person } },
        emails: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, subject: true, status: true, sentAt: true, createdAt: true, toEmail: true, lastError: true },
        },
        enrollments: {
          orderBy: { startedAt: 'desc' },
          include: { automation: { select: { id: true, name: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return { ...ticket, tags: ticket.tags.map((entry) => entry.tag) };
  }

  async create(actor: SupportActor, input: TicketInput, source: TicketSource = 'ADMIN', extra: { contactMessageId?: string; supportChatId?: string } = {}) {
    await this.setup.ensureSupport();
    const requester = input.requesterId
      ? await this.prisma.user.findUnique({ where: { id: input.requesterId }, select: { id: true, email: true, firstName: true, lastName: true } })
      : await this.prisma.user.findUnique({ where: { email: input.requesterEmail }, select: { id: true, email: true, firstName: true, lastName: true } });
    if (input.requesterId && !requester) throw new BadRequestException('Unknown user');
    const dealerId = input.dealerId ?? (requester ? await this.dealerOf(requester.id) : null);
    if (input.dealerId && !(await this.prisma.dealer.findUnique({ where: { id: input.dealerId }, select: { id: true } }))) {
      throw new BadRequestException('Unknown dealer');
    }
    if (input.categoryId && !(await this.prisma.supportCategory.findUnique({ where: { id: input.categoryId } }))) {
      throw new BadRequestException('Unknown category');
    }
    if (input.assignedToId) await this.assertAdmin(input.assignedToId);
    const sla = await this.slaFor(input.priority, new Date());

    const ticket = await this.prisma.$transaction(async (tx) => {
      const row = await tx.supportTicket.create({
        data: {
          requesterId: requester?.id ?? null,
          requesterEmail: requester?.email ?? input.requesterEmail,
          requesterName: input.requesterName ?? (requester ? `${requester.firstName} ${requester.lastName}`.trim() : null),
          dealerId,
          subject: input.subject,
          description: input.description,
          categoryId: input.categoryId,
          priority: input.priority,
          source,
          assignedToId: input.assignedToId,
          teamId: input.teamId,
          dueAt: input.dueAt ?? sla.dueAt,
          firstResponseDueAt: sla.firstResponseDueAt,
          contactMessageId: extra.contactMessageId ?? null,
          supportChatId: extra.supportChatId ?? null,
          createdById: actor.id,
          lastPublicReplyAt: new Date(),
          lastPublicReplyBy: 'REQUESTER',
        },
        select: { id: true, number: true, assignedToId: true, subject: true },
      });
      await tx.supportTicketMessage.create({
        data: {
          ticketId: row.id,
          authorId: source === 'ADMIN' ? null : requester?.id ?? null,
          authorRole: 'REQUESTER',
          visibility: 'PUBLIC',
          body: input.description,
        },
      });
      await tx.supportTicketEvent.create({
        data: { ticketId: row.id, actorId: actor.id, type: 'CREATED', toValue: 'NEW', detail: source },
      });
      if (input.tags.length) await this.applyTags(tx, row.id, input.tags);
      await supportAudit(tx, actor, {
        action: 'ticket.created',
        entityType: 'SupportTicket',
        entityId: row.id,
        dealerId,
        after: { number: row.number, subject: input.subject, source, priority: input.priority },
      });
      return row;
    });
    if (ticket.assignedToId) await this.notifyAssigned(ticket.id, ticket.assignedToId);
    await this.bus.publish({ type: 'TICKET_CREATED', scope: 'SUPPORT', ticketId: ticket.id });
    return ticket;
  }

  async update(actor: SupportActor, id: string, input: TicketUpdateInput) {
    const before = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Ticket not found');
    const assignedToId = input.assignedToId === '' ? null : input.assignedToId;
    const teamId = input.teamId === '' ? null : input.teamId;
    if (assignedToId) await this.assertAdmin(assignedToId);
    if (teamId && !(await this.prisma.supportTeam.findUnique({ where: { id: teamId } }))) {
      throw new BadRequestException('Unknown team');
    }
    if (input.categoryId && !(await this.prisma.supportCategory.findUnique({ where: { id: input.categoryId } }))) {
      throw new BadRequestException('Unknown category');
    }
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.SupportTicketUncheckedUpdateInput = {};
      if (input.priority && input.priority !== before.priority) {
        data.priority = input.priority;
        await tx.supportTicketEvent.create({
          data: { ticketId: id, actorId: actor.id, type: 'PRIORITY_CHANGED', fromValue: before.priority, toValue: input.priority },
        });
      }
      if (input.categoryId !== undefined && input.categoryId !== before.categoryId) {
        data.categoryId = input.categoryId;
        await tx.supportTicketEvent.create({ data: { ticketId: id, actorId: actor.id, type: 'CATEGORY_CHANGED', toValue: input.categoryId } });
      }
      if (assignedToId !== undefined && assignedToId !== before.assignedToId) {
        data.assignedToId = assignedToId;
        await tx.supportTicketEvent.create({
          data: { ticketId: id, actorId: actor.id, type: 'ASSIGNED', fromValue: before.assignedToId, toValue: assignedToId },
        });
      }
      if (teamId !== undefined && teamId !== before.teamId) {
        data.teamId = teamId;
        await tx.supportTicketEvent.create({ data: { ticketId: id, actorId: actor.id, type: 'TEAM_CHANGED', toValue: teamId } });
      }
      if (input.dueAt !== undefined) data.dueAt = input.dueAt ? new Date(input.dueAt) : null;
      if (input.resolution !== undefined) data.resolution = input.resolution || null;
      if (Object.keys(data).length) await tx.supportTicket.update({ where: { id }, data });
      if (input.tags) await this.applyTags(tx, id, input.tags, true);
      await supportAudit(tx, actor, {
        action: 'ticket.updated',
        entityType: 'SupportTicket',
        entityId: id,
        dealerId: before.dealerId,
        before: { priority: before.priority, assignedToId: before.assignedToId, categoryId: before.categoryId },
        after: input,
      });
    });
    if (assignedToId && assignedToId !== before.assignedToId) await this.notifyAssigned(id, assignedToId);
    if (input.status && input.status !== before.status) await this.setStatus(actor, id, input.status);
    return this.get(id);
  }

  /** Every status change goes through here, so the timestamps and automations stay right. */
  async setStatus(actor: SupportActor, id: string, status: TicketStatus) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === status) return;
    const now = new Date();
    const reopened = (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && TICKET_OPEN_STATUSES.includes(status);
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id },
        data: {
          status,
          waitingSince: status === 'WAITING_FOR_USER' || status === 'WAITING_FOR_DEALER' ? now : null,
          resolvedAt: status === 'RESOLVED' ? now : status === 'CLOSED' ? (ticket.resolvedAt ?? now) : null,
          closedAt: status === 'CLOSED' ? now : null,
          reopenedCount: reopened ? { increment: 1 } : undefined,
        },
      });
      await tx.supportTicketEvent.create({
        data: { ticketId: id, actorId: actor.id, type: reopened ? 'REOPENED' : 'STATUS_CHANGED', fromValue: ticket.status, toValue: status },
      });
      await supportAudit(tx, actor, {
        action: 'ticket.status_changed',
        entityType: 'SupportTicket',
        entityId: id,
        dealerId: ticket.dealerId,
        before: { status: ticket.status },
        after: { status },
      });
    });
    const signal = { scope: 'SUPPORT' as const, ticketId: id };
    await this.bus.publish({ ...signal, type: 'TICKET_STATUS_CHANGED' });
    if (status === 'RESOLVED') await this.bus.publish({ ...signal, type: 'TICKET_RESOLVED' });
    if (status === 'CLOSED') await this.bus.publish({ ...signal, type: 'TICKET_CLOSED' });
    if (status === 'ESCALATED') {
      const admins = await this.teamOrAdmins(ticket.teamId);
      for (const adminId of admins) {
        await this.notify.notify(adminId, 'TICKET_ESCALATED', {
          title: `Ticket #${ticket.number} escalated`,
          body: ticket.subject,
          link: `/admin/crm/tickets/${id}`,
        });
      }
    }
    if (ticket.requesterId && (status === 'RESOLVED' || reopened)) {
      await this.notify.notify(ticket.requesterId, 'TICKET_UPDATED', {
        title: `Ticket #${ticket.number} ${status === 'RESOLVED' ? 'resolved' : 'reopened'}`,
        body: ticket.subject,
        link: `/dashboard/support/${id}`,
      });
    }
  }

  /**
   * An admin adds to the conversation. A PUBLIC reply is emailed to the
   * requester and shown in their portal; an INTERNAL note is stored for the
   * admin team only and is never sent or shown to anyone else.
   */
  async addMessage(actor: SupportActor & { id: string }, id: string, input: TicketMessageInput) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const row = await tx.supportTicketMessage.create({
        data: { ticketId: id, authorId: actor.id, authorRole: 'ADMIN', visibility: input.visibility, body: input.body },
      });
      if (input.visibility === 'PUBLIC') {
        await tx.supportTicket.update({
          where: { id },
          data: {
            lastPublicReplyAt: now,
            lastPublicReplyBy: 'ADMIN',
            firstResponseAt: ticket.firstResponseAt ?? now,
          },
        });
      }
      await tx.supportTicketEvent.create({
        data: { ticketId: id, actorId: actor.id, type: input.visibility === 'PUBLIC' ? 'REPLIED' : 'INTERNAL_NOTE' },
      });
      await supportAudit(tx, actor, {
        action: input.visibility === 'PUBLIC' ? 'ticket.replied' : 'ticket.internal_note',
        entityType: 'SupportTicket',
        entityId: id,
        dealerId: ticket.dealerId,
        after: { messageId: row.id },
      });
      return row;
    });
    if (input.visibility === 'PUBLIC') {
      const email = await this.outbox.queueTicketEmail({
        ticketId: id,
        subject: `Re: ${ticket.subject} (#${ticket.number})`,
        bodyHtml: replyHtml(input.body, ticket.number, `${this.appUrl}/dashboard/support/${ticket.id}`),
        actorId: actor.id,
        idempotencyKey: `ticket-reply:${message.id}`,
        raw: true,
      });
      await this.prisma.supportTicketMessage.update({ where: { id: message.id }, data: { emailId: email.id } });
      if (ticket.requesterId) {
        await this.notify.notify(ticket.requesterId, 'TICKET_UPDATED', {
          title: `New reply on ticket #${ticket.number}`,
          body: ticket.subject,
          link: `/dashboard/support/${id}`,
        });
      }
      const next = input.status ?? (ticket.status === 'NEW' || ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS' ? 'WAITING_FOR_USER' : undefined);
      if (next) await this.setStatus(actor, id, next);
    } else if (input.status) {
      await this.setStatus(actor, id, input.status);
    }
    return message;
  }

  /** Assigns automatically: round-robin within the ticket's team (or the default one), else the least busy admin. */
  async autoAssign(id: string): Promise<string | null> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket || ticket.assignedToId) return ticket?.assignedToId ?? null;
    const settings = await this.prisma.supportSettings.findUnique({ where: { id: 1 } });
    const teamId = ticket.teamId ?? settings?.defaultTeamId ?? null;
    let assignee: string | null = null;
    if (teamId) {
      const [row] = await this.prisma.$queryRaw<Array<{ members: string[]; cursor: number }>>`
        UPDATE "SupportTeam" SET cursor = cursor + 1 WHERE id = ${teamId}::uuid AND "isActive"
        RETURNING "memberIds"::text[] AS members, cursor - 1 AS cursor`;
      const members = row?.members ?? [];
      if (members.length) assignee = members[row!.cursor % members.length] ?? null;
    }
    if (!assignee) {
      const admins = await this.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
        select: { id: true, _count: { select: { supportTicketsAssigned: { where: { status: { in: [...TICKET_OPEN_STATUSES] } } } } } },
      });
      admins.sort((a, b) => a._count.supportTicketsAssigned - b._count.supportTicketsAssigned || a.id.localeCompare(b.id));
      assignee = admins[0]?.id ?? null;
    }
    if (!assignee) return null;
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id }, data: { assignedToId: assignee, teamId, status: ticket.status === 'NEW' ? 'OPEN' : undefined } });
      await tx.supportTicketEvent.create({ data: { ticketId: id, type: 'ASSIGNED', toValue: assignee, detail: 'Automatic' } });
    });
    await this.notifyAssigned(id, assignee);
    return assignee;
  }

  // --- Requester portal ----------------------------------------------------------------

  /** The caller's own tickets, without anything internal. */
  listMine(user: AuthUser) {
    return this.prisma.supportTicket.findMany({
      where: { OR: [{ requesterId: user.id }, { requesterId: null, requesterEmail: user.email.toLowerCase() }] },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lastPublicReplyAt: true,
        lastPublicReplyBy: true,
        category: { select: { label: true } },
      },
    });
  }

  async getMine(user: AuthUser, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, OR: [{ requesterId: user.id }, { requesterId: null, requesterEmail: user.email.toLowerCase() }] },
      select: {
        id: true,
        number: true,
        subject: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        category: { select: { label: true } },
        // Public only. Internal notes and the event log stay with the admins.
        messages: {
          where: { visibility: 'PUBLIC' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, authorRole: true, body: true, createdAt: true, author: { select: { firstName: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return {
      ...ticket,
      messages: ticket.messages.map((message) => ({
        id: message.id,
        from: message.authorRole === 'REQUESTER' ? 'YOU' : 'SUPPORT',
        // Agents are shown by first name only.
        name: message.authorRole === 'REQUESTER' ? null : (message.author?.firstName ?? 'Vintrax Support'),
        body: message.body,
        createdAt: message.createdAt,
      })),
    };
  }

  async createFromPortal(user: AuthUser, input: PortalTicketInput) {
    const ticket = await this.create(
      { id: user.id, email: user.email },
      {
        requesterId: user.id,
        requesterEmail: user.email,
        requesterName: `${user.firstName} ${user.lastName}`.trim(),
        dealerId: null,
        subject: input.subject,
        description: input.description,
        categoryId: input.categoryId,
        priority: 'MEDIUM',
        assignedToId: null,
        teamId: null,
        dueAt: null,
        tags: [],
      },
      'USER_PORTAL',
    );
    return { id: ticket.id, number: ticket.number };
  }

  async replyAsRequester(user: AuthUser, id: string, body: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, OR: [{ requesterId: user.id }, { requesterId: null, requesterEmail: user.email.toLowerCase() }] },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'CLOSED' && ticket.closedAt && Date.now() - ticket.closedAt.getTime() > 30 * 86_400_000) {
      throw new ForbiddenException('This ticket was closed over 30 days ago; open a new one');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: { ticketId: id, authorId: user.id, authorRole: 'REQUESTER', visibility: 'PUBLIC', body },
      });
      await tx.supportTicket.update({ where: { id }, data: { lastPublicReplyAt: now, lastPublicReplyBy: 'REQUESTER' } });
      await tx.supportTicketEvent.create({ data: { ticketId: id, actorId: user.id, type: 'REQUESTER_REPLIED' } });
    });
    await this.bus.publish({ type: 'TICKET_USER_REPLIED', scope: 'SUPPORT', ticketId: id });
    if (['WAITING_FOR_USER', 'WAITING_FOR_DEALER', 'RESOLVED', 'CLOSED'].includes(ticket.status)) {
      await this.setStatus({ id: user.id, email: user.email }, id, 'OPEN');
    }
    if (ticket.assignedToId) {
      await this.notify.notify(ticket.assignedToId, 'TICKET_UPDATED', {
        title: `Reply on ticket #${ticket.number}`,
        body: ticket.subject,
        link: `/admin/crm/tickets/${id}`,
      });
    }
    return { id };
  }

  // --- Intake from other parts of Vintrax ------------------------------------------------

  /** A Contact-page message becomes a ticket (once). */
  async fromContactMessage(contactMessageId: string) {
    const existing = await this.prisma.supportTicket.findUnique({ where: { contactMessageId }, select: { id: true } });
    if (existing) return existing;
    const message = await this.prisma.contactMessage.findUnique({ where: { id: contactMessageId } });
    if (!message) return null;
    return this.create(
      SYSTEM_ACTOR,
      {
        requesterId: null,
        requesterEmail: message.email.toLowerCase(),
        requesterName: message.name,
        dealerId: null,
        subject: message.subject,
        description: message.message + (message.phone ? `\n\nPhone: ${message.phone}` : ''),
        categoryId: null,
        priority: 'MEDIUM',
        assignedToId: null,
        teamId: null,
        dueAt: null,
        tags: [],
      },
      'CONTACT_FORM',
      { contactMessageId },
    );
  }

  /** An admin turns a site-chat conversation into a ticket, transcript included. */
  async fromSupportChat(actor: SupportActor & { id: string }, chatId: string) {
    const chat = await this.prisma.supportChat.findUnique({
      where: { id: chatId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 }, user: { select: { id: true, email: true } } },
    });
    if (!chat) throw new NotFoundException('Chat not found');
    const email = chat.user?.email ?? chat.visitorEmail;
    if (!email) throw new BadRequestException('The visitor left no email address; ask for one in the chat first');
    const transcript = chat.messages
      .map((message) => `${message.role.toLowerCase()}: ${message.body}`)
      .join('\n');
    return this.create(
      actor,
      {
        requesterId: chat.user?.id ?? null,
        requesterEmail: email.toLowerCase(),
        requesterName: chat.visitorName,
        dealerId: null,
        subject: `Site chat${chat.pagePath ? ` from ${chat.pagePath}` : ''}`,
        description: transcript || 'Conversation from the site chat.',
        categoryId: null,
        priority: 'MEDIUM',
        assignedToId: actor.id,
        teamId: null,
        dueAt: null,
        tags: [],
      },
      'SUPPORT_CHAT',
      { supportChatId: chatId },
    );
  }

  // --- Helpers -------------------------------------------------------------------------

  private async slaFor(priority: CrmPriority, from: Date) {
    await this.setup.ensureSupport();
    const settings = await this.prisma.supportSettings.findUniqueOrThrow({ where: { id: 1 } });
    const first = (settings.firstResponseHours as Record<string, number>)[priority] ?? 24;
    const resolve = (settings.resolutionHours as Record<string, number>)[priority] ?? 72;
    return {
      firstResponseDueAt: new Date(from.getTime() + first * 3_600_000),
      dueAt: new Date(from.getTime() + resolve * 3_600_000),
    };
  }

  private async dealerOf(userId: string): Promise<string | null> {
    const owned = await this.prisma.dealer.findUnique({ where: { ownerId: userId }, select: { id: true } });
    if (owned) return owned.id;
    const member = await this.prisma.dealerMember.findFirst({ where: { userId }, select: { dealerId: true } });
    return member?.dealerId ?? null;
  }

  async assertAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      throw new BadRequestException('Tickets can only be assigned to administrators');
    }
  }

  async teamOrAdmins(teamId: string | null): Promise<string[]> {
    if (teamId) {
      const team = await this.prisma.supportTeam.findUnique({ where: { id: teamId } });
      if (team?.memberIds.length) return team.memberIds;
    }
    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
      select: { id: true },
      take: 50,
    });
    return admins.map((admin) => admin.id);
  }

  private async notifyAssigned(ticketId: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { number: true, subject: true } });
    if (!ticket) return;
    await this.notify.notify(userId, 'TICKET_ASSIGNED', {
      title: `Ticket #${ticket.number} assigned to you`,
      body: ticket.subject,
      link: `/admin/crm/tickets/${ticketId}`,
    });
  }

  private async applyTags(tx: Prisma.TransactionClient, ticketId: string, names: string[], replace = false) {
    const tagIds: string[] = [];
    for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
      const tag =
        (await tx.crmTag.findFirst({ where: { scope: 'SUPPORT', dealerId: null, name: { equals: name, mode: 'insensitive' } } })) ??
        (await tx.crmTag.create({ data: { scope: 'SUPPORT', dealerId: null, name } }));
      tagIds.push(tag.id);
    }
    if (replace) await tx.supportTicketTag.deleteMany({ where: { ticketId, tagId: { notIn: tagIds } } });
    if (tagIds.length) {
      await tx.supportTicketTag.createMany({ data: tagIds.map((tagId) => ({ ticketId, tagId })), skipDuplicates: true });
    }
  }
}

function replyHtml(body: string, number: number, url: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `${paragraphs}\n<p>— Vintrax Support · <a href="${escapeHtml(url)}">Ticket #${number}</a></p>`;
}
