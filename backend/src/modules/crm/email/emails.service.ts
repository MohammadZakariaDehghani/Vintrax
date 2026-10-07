import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ConsentInput, EmailComposeInput, EmailListQuery } from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit } from '../core/audit';
import { assertCrm, can, leadScope, type CrmContext } from '../core/context';
import { LeadsService } from '../leads/leads.service';
import { recordTimeline } from '../leads/timeline';
import { ComplianceService } from './compliance.service';
import { DispatcherService } from './dispatcher.service';
import { OutboxService } from './outbox.service';

/** CRM → Emails: compose, schedule, the sent log, consent and suppression. */
@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly dispatcher: DispatcherService,
    private readonly compliance: ComplianceService,
    private readonly leads: LeadsService,
  ) {}

  private scope(ctx: CrmContext): Prisma.CrmEmailWhereInput {
    if (can(ctx, 'crm.all_leads')) return { dealerId: ctx.dealerId };
    return { dealerId: ctx.dealerId, lead: leadScope(ctx) };
  }

  async list(ctx: CrmContext, query: EmailListQuery) {
    const where: Prisma.CrmEmailWhereInput = {
      ...this.scope(ctx),
      ...(query.status ? { status: query.status } : {}),
      ...(query.purpose ? { purpose: query.purpose } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.q
        ? {
            OR: [
              { subject: { contains: query.q, mode: 'insensitive' } },
              { toEmail: { contains: query.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.crmEmail.count({ where }),
      this.prisma.crmEmail.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          toEmail: true,
          toName: true,
          subject: true,
          purpose: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          deliveredAt: true,
          openedAt: true,
          clickedAt: true,
          repliedAt: true,
          bouncedAt: true,
          attempts: true,
          lastError: true,
          provider: true,
          enrollmentId: true,
          campaignId: true,
          createdAt: true,
          lead: { select: { id: true, number: true, firstName: true, lastName: true } },
          campaign: { select: { id: true, name: true } },
        },
      }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  async get(ctx: CrmContext, id: string) {
    const email = await this.prisma.crmEmail.findFirst({
      where: { id, ...this.scope(ctx) },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        lead: { select: { id: true, number: true, firstName: true, lastName: true } },
        template: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    });
    if (!email) throw new NotFoundException('Email not found');
    const { trackingToken: _token, idempotencyKey: _key, lockedUntil: _lock, ...rest } = email;
    return rest;
  }

  async compose(ctx: CrmContext, input: EmailComposeInput) {
    assertCrm(ctx, 'crm.email');
    await this.leads.findVisible(ctx, input.leadId);
    if (input.purpose === 'MARKETING') assertCrm(ctx, 'crm.marketing');
    if (input.templateId) {
      const template = await this.prisma.crmEmailTemplate.findFirst({
        where: { id: input.templateId, scope: 'DEALER', dealerId: ctx.dealerId },
        select: { id: true },
      });
      if (!template) throw new BadRequestException('Unknown template');
    }
    const result = await this.outbox.queueLeadEmail(ctx, {
      leadId: input.leadId,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      purpose: input.purpose,
      templateId: input.templateId,
      scheduledAt: input.scheduledAt,
      respectSendWindow: input.respectSendWindow,
    });
    if (result.status === 'SUPPRESSED') {
      throw new BadRequestException({ message: `Not sent: ${result.reason}`, details: { _: [result.reason ?? 'Blocked'] } });
    }
    return result;
  }

  cancel(ctx: CrmContext, id: string) {
    return this.outbox.cancel(ctx, id);
  }

  /** A salesperson records that the customer answered (by email outside Vintrax, say). */
  async markReplied(ctx: CrmContext, id: string) {
    await this.get(ctx, id);
    await this.dispatcher.recordReply(id, `Logged by ${ctx.actorEmail}`);
    return { id };
  }

  async retry(ctx: CrmContext, id: string) {
    const email = await this.get(ctx, id);
    if (email.status !== 'FAILED') throw new BadRequestException('Only a failed email can be retried');
    await this.prisma.crmEmail.update({
      where: { id },
      data: { status: 'QUEUED', nextAttemptAt: new Date(), attempts: 0, lastError: null },
    });
    await this.prisma.crmEmailEvent.create({ data: { emailId: id, type: 'RETRY', detail: `Requeued by ${ctx.actorEmail}` } });
    return { id, status: 'QUEUED' };
  }

  // --- Consent and suppression ------------------------------------------------------------

  async consents(ctx: CrmContext, leadId: string) {
    await this.leads.findVisible(ctx, leadId);
    return this.prisma.crmConsent.findMany({ where: { leadId, dealerId: ctx.dealerId }, orderBy: { grantedAt: 'desc' } });
  }

  async recordConsent(ctx: CrmContext, input: ConsentInput) {
    await this.leads.findVisible(ctx, input.leadId);
    const lead = await this.prisma.crmLead.findUniqueOrThrow({ where: { id: input.leadId }, select: { emailNormalized: true } });
    if (!lead.emailNormalized) throw new BadRequestException('The lead has no email address');
    return this.prisma.$transaction((tx) => this.leads.recordConsent(tx, ctx, input.leadId, lead.emailNormalized!, input));
  }

  async withdrawConsent(ctx: CrmContext, consentId: string) {
    const consent = await this.prisma.crmConsent.findFirst({ where: { id: consentId, dealerId: ctx.dealerId } });
    if (!consent) throw new NotFoundException('Consent not found');
    if (consent.leadId) await this.leads.findVisible(ctx, consent.leadId);
    await this.prisma.$transaction(async (tx) => {
      await tx.crmConsent.update({ where: { id: consentId }, data: { withdrawnAt: new Date() } });
      if (consent.leadId) {
        await recordTimeline(tx, {
          dealerId: ctx.dealerId,
          leadId: consent.leadId,
          type: 'CONSENT_CHANGED',
          title: 'Marketing consent withdrawn',
          userId: ctx.userId,
        });
      }
      await crmAudit(tx, ctx, {
        action: 'consent.withdrawn',
        entityType: 'CrmConsent',
        entityId: consentId,
        before: { type: consent.type, email: consent.email },
      });
    });
    return { id: consentId };
  }

  suppressions(ctx: CrmContext, q?: string) {
    return this.compliance.list(ctx.dealerId, q);
  }

  async suppress(ctx: CrmContext, email: string, note: string | null) {
    assertCrm(ctx, 'crm.manage');
    await this.compliance.suppress({
      dealerId: ctx.dealerId,
      email,
      reason: 'MANUAL',
      source: 'Added by the dealership',
      note,
      actor: { id: ctx.userId, email: ctx.actorEmail },
    });
    return { email };
  }

  async unsuppress(ctx: CrmContext, id: string) {
    assertCrm(ctx, 'crm.manage');
    const removed = await this.compliance.unsuppress(ctx.dealerId, id, { id: ctx.userId, email: ctx.actorEmail });
    if (!removed) throw new NotFoundException('Only your own dealership’s entries can be removed');
  }
}
