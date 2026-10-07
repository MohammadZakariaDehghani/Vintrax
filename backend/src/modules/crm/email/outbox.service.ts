import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEALER_TEMPLATE_VARIABLES,
  SUPPORT_TEMPLATE_VARIABLES,
  type EmailPurpose,
} from '@vintrax/shared';
import { Prisma } from '@prisma/client';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit } from '../core/audit';
import type { CrmContext } from '../core/context';
import { formatLocal, nextSendTime } from '../core/time';
import { ComplianceService } from './compliance.service';
import { assertKnownVariables, renderSubject, renderTemplate, type TemplateValues } from './render';
import { htmlToText, sanitizeHtml } from './sanitizer';
import { newTrackingToken } from './tracking';

export interface LeadEmailRequest {
  leadId: string;
  subject: string;
  bodyHtml: string;
  purpose: EmailPurpose;
  templateId?: string | null;
  scheduledAt?: Date | null;
  /** Hold until the dealer's sending hours. Automations always do when asked. */
  respectSendWindow?: boolean;
  campaignId?: string | null;
  enrollmentId?: string | null;
  automationStepId?: string | null;
  appointmentId?: string | null;
  /** Send to the assigned salesperson instead of the customer (internal alerts). */
  toSalesperson?: boolean;
  /**
   * One logical email, one row: a retried job or a double-clicked button
   * with the same key returns the first email instead of sending another.
   */
  idempotencyKey?: string;
}

export interface QueueResult {
  id: string;
  status: string;
  /** False when an earlier email with the same idempotency key was returned. */
  created: boolean;
  reason?: string;
}

/**
 * The CRM email outbox. Composing an email renders it once, checks it
 * against consent and suppression, and stores it as a row; the dispatcher
 * sends rows when they are due. Nothing is sent from inside an API request.
 */
@Injectable()
export class OutboxService {
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- Variables -----------------------------------------------------------------------

  /** Everything a dealer template can mention, for one lead. */
  async leadValues(leadId: string, appointmentId?: string | null): Promise<TemplateValues> {
    const lead = await this.prisma.crmLead.findUniqueOrThrow({
      where: { id: leadId },
      include: {
        vehicle: {
          select: {
            year: true,
            make: true,
            model: true,
            trim: true,
            priceCad: true,
            vin: true,
            slug: true,
          },
        },
        assignedTo: { select: { firstName: true, lastName: true, phone: true, email: true } },
        dealer: {
          select: {
            name: true,
            phone: true,
            city: true,
            province: true,
            owner: { select: { email: true } },
          },
        },
      },
    });
    const settings = await this.prisma.crmSettings.findUnique({
      where: { dealerId: lead.dealerId },
    });
    const timezone = settings?.timezone ?? 'America/Toronto';
    const appointment = appointmentId
      ? await this.prisma.crmAppointment.findFirst({ where: { id: appointmentId, leadId } })
      : await this.prisma.crmAppointment.findFirst({
          where: {
            leadId,
            startsAt: { gte: new Date() },
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
          },
          orderBy: { startsAt: 'asc' },
        });
    const vehicle = lead.vehicle;
    return {
      'customer.first_name': lead.firstName,
      'customer.last_name': lead.lastName,
      'customer.email': lead.email,
      'dealer.name': lead.dealer.name,
      'dealer.phone': settings?.businessPhone ?? lead.dealer.phone,
      'dealer.email': settings?.businessEmail ?? settings?.replyToEmail ?? lead.dealer.owner.email,
      'dealer.address':
        settings?.businessAddress ??
        [lead.dealer.city, lead.dealer.province].filter(Boolean).join(', '),
      'vehicle.year': vehicle ? String(vehicle.year) : null,
      'vehicle.make': vehicle?.make,
      'vehicle.model': vehicle?.model,
      'vehicle.trim': vehicle?.trim,
      'vehicle.price': vehicle ? `$${vehicle.priceCad.toLocaleString('en-CA')}` : null,
      'vehicle.vin': vehicle?.vin ?? lead.interestedVin,
      'vehicle.url': vehicle ? `${this.appUrl}/vehicles/${vehicle.slug}` : lead.vehicleUrl,
      'salesperson.name': lead.assignedTo
        ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`.trim()
        : null,
      'salesperson.phone': lead.assignedTo?.phone ?? settings?.businessPhone ?? lead.dealer.phone,
      'salesperson.email': lead.assignedTo?.email,
      'appointment.date': appointment
        ? formatLocal(appointment.startsAt, timezone, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })
        : null,
      'appointment.time': appointment
        ? formatLocal(appointment.startsAt, timezone, { hour: 'numeric', minute: '2-digit' })
        : null,
      'lead.next_follow_up': lead.nextFollowUpAt
        ? formatLocal(lead.nextFollowUpAt, timezone, {
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : null,
    };
  }

  async ticketValues(ticketId: string): Promise<TemplateValues> {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { requester: { select: { firstName: true } } },
    });
    return {
      'user.first_name': ticket.requester?.firstName ?? ticket.requesterName?.split(' ')[0] ?? null,
      'ticket.number': String(ticket.number),
      'ticket.subject': ticket.subject,
      'ticket.status': ticket.status.replace(/_/g, ' ').toLowerCase(),
      'ticket.url': `${this.appUrl}/dashboard/support/${ticket.id}`,
    };
  }

  /** Sample values for previewing a template without a real lead. */
  sampleValues(): TemplateValues {
    return {
      'customer.first_name': 'Alex',
      'customer.last_name': 'Chen',
      'customer.email': 'alex@example.com',
      'dealer.name': 'Your Dealership',
      'dealer.phone': '(604) 555-0100',
      'dealer.email': 'sales@example.com',
      'dealer.address': '123 Main Street, Vancouver, BC',
      'vehicle.year': '2021',
      'vehicle.make': 'Toyota',
      'vehicle.model': 'RAV4',
      'vehicle.trim': 'XLE AWD',
      'vehicle.price': '$32,995',
      'vehicle.vin': '2T3P1RFV0MW000000',
      'vehicle.url': `${this.appUrl}/vehicles/example`,
      'salesperson.name': 'Sam Rivera',
      'salesperson.phone': '(604) 555-0101',
      'salesperson.email': 'sam@example.com',
      'appointment.date': 'Saturday, October 10',
      'appointment.time': '10:30 a.m.',
      'lead.next_follow_up': 'October 12, 9:00 a.m.',
      'ticket.number': '1042',
      'ticket.subject': 'Cannot upload photos',
      'ticket.status': 'open',
      'ticket.url': `${this.appUrl}/dashboard/support/example`,
      'user.first_name': 'Jordan',
    };
  }

  /** Renders a subject and body for preview or sending. */
  render(
    subject: string,
    bodyHtml: string,
    values: TemplateValues,
    scope: 'DEALER' | 'SUPPORT' = 'DEALER',
  ) {
    assertKnownVariables(
      scope === 'DEALER' ? DEALER_TEMPLATE_VARIABLES : SUPPORT_TEMPLATE_VARIABLES,
      subject,
      bodyHtml,
    );
    const safe = sanitizeHtml(bodyHtml);
    const html = renderTemplate(safe, values, 'html');
    return { subject: renderSubject(subject, values), html, text: htmlToText(html) };
  }

  // --- Queueing ------------------------------------------------------------------------

  async queueLeadEmail(ctx: CrmContext, request: LeadEmailRequest): Promise<QueueResult> {
    if (request.idempotencyKey) {
      const existing = await this.prisma.crmEmail.findUnique({
        where: { idempotencyKey: request.idempotencyKey },
        select: { id: true, status: true },
      });
      if (existing) return { ...existing, created: false };
    }
    const lead = await this.prisma.crmLead.findFirst({
      where: { id: request.leadId, dealerId: ctx.dealerId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        assignedTo: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    const to = request.toSalesperson ? lead.assignedTo?.email : lead.email;
    if (!to)
      throw new BadRequestException(
        request.toSalesperson ? 'The lead has no salesperson' : 'The lead has no email address',
      );
    const toName = request.toSalesperson
      ? `${lead.assignedTo!.firstName} ${lead.assignedTo!.lastName}`.trim()
      : [lead.firstName, lead.lastName].filter(Boolean).join(' ');

    const values = await this.leadValues(lead.id, request.appointmentId);
    const rendered = this.render(request.subject, request.bodyHtml, values, 'DEALER');
    // Mail to the salesperson is internal, never marketing.
    const purpose: EmailPurpose = request.toSalesperson ? 'TRANSACTIONAL' : request.purpose;
    const decision = await this.compliance.canSend(ctx.dealerId, to, purpose);

    const settings = await this.prisma.crmSettings.findUnique({
      where: { dealerId: ctx.dealerId },
    });
    let scheduledAt = request.scheduledAt ?? new Date();
    if (request.respectSendWindow && settings && !request.toSalesperson) {
      scheduledAt = nextSendTime(scheduledAt, settings);
    }
    const dealer = await this.prisma.dealer.findUniqueOrThrow({
      where: { id: ctx.dealerId },
      select: { name: true },
    });
    const replyTo =
      settings?.replyToEmail ??
      (
        await this.prisma.crmLead.findUnique({
          where: { id: lead.id },
          select: { assignedTo: { select: { email: true } } },
        })
      )?.assignedTo?.email ??
      null;

    try {
      const email = await this.prisma.$transaction(async (tx) => {
        const row = await tx.crmEmail.create({
          data: {
            scope: 'DEALER',
            dealerId: ctx.dealerId,
            leadId: lead.id,
            toEmail: to.toLowerCase(),
            toName,
            fromName: settings?.senderName ?? dealer.name,
            replyTo,
            subject: rendered.subject,
            bodyHtml: rendered.html,
            bodyText: rendered.text,
            purpose,
            templateId: request.templateId ?? null,
            campaignId: request.campaignId ?? null,
            enrollmentId: request.enrollmentId ?? null,
            automationStepId: request.automationStepId ?? null,
            status: decision.allowed
              ? scheduledAt > new Date()
                ? 'SCHEDULED'
                : 'QUEUED'
              : 'SUPPRESSED',
            lastError: decision.allowed ? null : decision.reason,
            scheduledAt,
            nextAttemptAt: scheduledAt,
            idempotencyKey: request.idempotencyKey ?? `manual:${newTrackingToken()}`,
            trackingToken: newTrackingToken(),
            createdById: ctx.system ? null : ctx.userId,
          },
          select: { id: true, status: true },
        });
        await tx.crmEmailEvent.create({
          data: {
            emailId: row.id,
            type: decision.allowed ? 'QUEUED' : 'SUPPRESSED',
            detail: decision.allowed ? `For ${scheduledAt.toISOString()}` : decision.reason,
          },
        });
        if (!ctx.system) {
          await crmAudit(tx, ctx, {
            action: 'email.queued',
            entityType: 'CrmEmail',
            entityId: row.id,
            after: {
              leadId: lead.id,
              subject: rendered.subject,
              purpose,
              scheduledAt,
              status: row.status,
            },
          });
        }
        return row;
      });
      return { ...email, created: true, reason: decision.reason };
    } catch (error) {
      // Two runs racing with one key: the loser returns the winner's email.
      if (
        request.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.crmEmail.findUniqueOrThrow({
          where: { idempotencyKey: request.idempotencyKey },
          select: { id: true, status: true },
        });
        return { ...existing, created: false };
      }
      throw error;
    }
  }

  /** A support email to a ticket's requester. Always transactional: it answers their ticket. */
  async queueTicketEmail(request: {
    ticketId: string;
    subject: string;
    bodyHtml: string;
    templateId?: string | null;
    enrollmentId?: string | null;
    automationStepId?: string | null;
    idempotencyKey?: string;
    actorId?: string | null;
    /** Rendered already (an agent's reply), rather than a template with variables. */
    raw?: boolean;
  }): Promise<QueueResult> {
    if (request.idempotencyKey) {
      const existing = await this.prisma.crmEmail.findUnique({
        where: { idempotencyKey: request.idempotencyKey },
        select: { id: true, status: true },
      });
      if (existing) return { ...existing, created: false };
    }
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({
      where: { id: request.ticketId },
      select: {
        id: true,
        requesterEmail: true,
        requesterName: true,
        requesterId: true,
        dealerId: true,
      },
    });
    const rendered = request.raw
      ? {
          subject: request.subject,
          html: sanitizeHtml(request.bodyHtml),
          text: htmlToText(sanitizeHtml(request.bodyHtml)),
        }
      : this.render(
          request.subject,
          request.bodyHtml,
          await this.ticketValues(ticket.id),
          'SUPPORT',
        );
    const decision = await this.compliance.canSend(null, ticket.requesterEmail, 'TRANSACTIONAL');
    const row = await this.prisma.crmEmail.create({
      data: {
        scope: 'SUPPORT',
        ticketId: ticket.id,
        userId: ticket.requesterId,
        toEmail: ticket.requesterEmail.toLowerCase(),
        toName: ticket.requesterName,
        fromName: 'Vintrax Support',
        subject: rendered.subject,
        bodyHtml: rendered.html,
        bodyText: rendered.text,
        purpose: 'TRANSACTIONAL',
        templateId: request.templateId ?? null,
        enrollmentId: request.enrollmentId ?? null,
        automationStepId: request.automationStepId ?? null,
        status: decision.allowed ? 'QUEUED' : 'SUPPRESSED',
        lastError: decision.allowed ? null : decision.reason,
        idempotencyKey: request.idempotencyKey ?? `support:${newTrackingToken()}`,
        trackingToken: newTrackingToken(),
        createdById: request.actorId ?? null,
        events: {
          create: {
            type: decision.allowed ? 'QUEUED' : 'SUPPRESSED',
            detail: decision.reason ?? null,
          },
        },
      },
      select: { id: true, status: true },
    });
    return { ...row, created: true, reason: decision.reason };
  }

  /** A direct email from the support team to any user (Admin CRM → Communication). */
  async queueDirectEmail(input: {
    toEmail: string;
    toName: string | null;
    userId: string | null;
    subject: string;
    bodyHtml: string;
    ticketId?: string | null;
    actorId: string;
  }): Promise<QueueResult> {
    const html = sanitizeHtml(input.bodyHtml);
    const decision = await this.compliance.canSend(null, input.toEmail, 'TRANSACTIONAL');
    const row = await this.prisma.crmEmail.create({
      data: {
        scope: 'SUPPORT',
        ticketId: input.ticketId ?? null,
        userId: input.userId,
        toEmail: input.toEmail.toLowerCase(),
        toName: input.toName,
        fromName: 'Vintrax Support',
        subject: input.subject,
        bodyHtml: html,
        bodyText: htmlToText(html),
        purpose: 'TRANSACTIONAL',
        status: decision.allowed ? 'QUEUED' : 'SUPPRESSED',
        lastError: decision.allowed ? null : decision.reason,
        idempotencyKey: `direct:${newTrackingToken()}`,
        trackingToken: newTrackingToken(),
        createdById: input.actorId,
        events: {
          create: {
            type: decision.allowed ? 'QUEUED' : 'SUPPRESSED',
            detail: decision.reason ?? null,
          },
        },
      },
      select: { id: true, status: true },
    });
    return { ...row, created: true, reason: decision.reason };
  }

  /** Cancels an email that has not gone yet. */
  async cancel(ctx: CrmContext, id: string) {
    const email = await this.prisma.crmEmail.findFirst({ where: { id, dealerId: ctx.dealerId } });
    if (!email) throw new NotFoundException('Email not found');
    const updated = await this.prisma.crmEmail.updateMany({
      where: { id, status: { in: ['SCHEDULED', 'QUEUED'] } },
      data: { status: 'CANCELLED' },
    });
    if (updated.count === 0)
      throw new BadRequestException('Only a scheduled or queued email can be cancelled');
    await this.prisma.crmEmailEvent.create({
      data: { emailId: id, type: 'CANCELLED', detail: ctx.actorEmail },
    });
    await crmAudit(this.prisma, ctx, {
      action: 'email.cancelled',
      entityType: 'CrmEmail',
      entityId: id,
    });
    return { id, status: 'CANCELLED' };
  }
}
