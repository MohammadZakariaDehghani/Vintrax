import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HARD_SUPPRESSIONS, type CampaignAudience, type CampaignInput } from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit } from '../core/audit';
import { systemContext, type CrmContext } from '../core/context';
import { OutboxService } from './outbox.service';

/**
 * Marketing campaigns. A campaign is marketing by definition, so it only
 * ever reaches leads with current consent and no suppression; everyone else
 * in the audience is counted as skipped, never emailed. Launching queues the
 * emails in the outbox; the dispatcher sends them in the background.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async list(ctx: CrmContext) {
    const campaigns = await this.prisma.crmCampaign.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { id: true, name: true } } },
    });
    const stats = await this.stats(campaigns.map((campaign) => campaign.id));
    return campaigns.map((campaign) => ({
      ...campaign,
      stats: stats.get(campaign.id) ?? emptyStats(),
    }));
  }

  async get(ctx: CrmContext, id: string) {
    const campaign = await this.prisma.crmCampaign.findFirst({
      where: { id, dealerId: ctx.dealerId },
      include: { template: { select: { id: true, name: true, subject: true, purpose: true } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const stats = await this.stats([id]);
    return { ...campaign, stats: stats.get(id) ?? emptyStats() };
  }

  async create(ctx: CrmContext, input: CampaignInput) {
    await this.checkTemplate(ctx, input.templateId);
    const campaign = await this.prisma.crmCampaign.create({
      data: {
        dealerId: ctx.dealerId,
        name: input.name,
        type: input.type,
        templateId: input.templateId,
        subject: input.subject,
        audience: input.audience as Prisma.InputJsonValue,
        costCents: input.cost,
        createdById: ctx.userId,
      },
    });
    await crmAudit(this.prisma, ctx, {
      action: 'campaign.created',
      entityType: 'CrmCampaign',
      entityId: campaign.id,
      after: input,
    });
    return campaign;
  }

  async update(ctx: CrmContext, id: string, input: CampaignInput) {
    const campaign = await this.get(ctx, id);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new BadRequestException('A campaign that has started cannot be edited');
    }
    await this.checkTemplate(ctx, input.templateId);
    const updated = await this.prisma.crmCampaign.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type,
        templateId: input.templateId,
        subject: input.subject,
        audience: input.audience as Prisma.InputJsonValue,
        costCents: input.cost,
      },
    });
    await crmAudit(this.prisma, ctx, {
      action: 'campaign.updated',
      entityType: 'CrmCampaign',
      entityId: id,
      after: input,
    });
    return updated;
  }

  /** Schedules the campaign (now, or at a time); the scheduler launches it. */
  async schedule(ctx: CrmContext, id: string, at: Date | null) {
    const campaign = await this.get(ctx, id);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new BadRequestException('This campaign has already been sent');
    }
    const settings = await this.prisma.crmSettings.findUnique({
      where: { dealerId: ctx.dealerId },
    });
    if (!settings?.businessAddress?.trim()) {
      throw new BadRequestException(
        'Add your business mailing address in CRM settings before sending marketing email',
      );
    }
    const preview = await this.audience(ctx.dealerId, campaign.audience as CampaignAudience);
    if (preview.eligible === 0)
      throw new BadRequestException('No one in this audience can receive marketing email');
    const updated = await this.prisma.crmCampaign.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduledAt: at ?? new Date() },
    });
    await crmAudit(this.prisma, ctx, {
      action: 'campaign.scheduled',
      entityType: 'CrmCampaign',
      entityId: id,
      after: { scheduledAt: updated.scheduledAt, eligible: preview.eligible },
    });
    return updated;
  }

  async cancel(ctx: CrmContext, id: string) {
    const campaign = await this.get(ctx, id);
    if (campaign.status === 'SENT' || campaign.status === 'CANCELLED') {
      throw new BadRequestException('This campaign can no longer be cancelled');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.crmCampaign.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await tx.crmEmail.updateMany({
        where: { campaignId: id, status: { in: ['SCHEDULED', 'QUEUED'] } },
        data: { status: 'CANCELLED' },
      });
      await crmAudit(tx, ctx, {
        action: 'campaign.cancelled',
        entityType: 'CrmCampaign',
        entityId: id,
      });
    });
    return { id, status: 'CANCELLED' };
  }

  async remove(ctx: CrmContext, id: string) {
    const campaign = await this.get(ctx, id);
    if (campaign.status !== 'DRAFT') throw new BadRequestException('Only a draft can be deleted');
    await this.prisma.crmCampaign.delete({ where: { id } });
    await crmAudit(this.prisma, ctx, {
      action: 'campaign.deleted',
      entityType: 'CrmCampaign',
      entityId: id,
      before: { name: campaign.name },
    });
  }

  /** Who the audience is, and who of them may receive marketing. */
  async audience(dealerId: string, audience: CampaignAudience, sample = 0) {
    const leads = await this.prisma.crmLead.findMany({
      where: audienceWhere(dealerId, audience),
      select: { id: true, number: true, firstName: true, lastName: true, emailNormalized: true },
      take: 20_000,
    });
    const emails = [
      ...new Set(leads.map((lead) => lead.emailNormalized).filter((e): e is string => !!e)),
    ];
    const now = new Date();
    const [consents, suppressions] = await Promise.all([
      this.prisma.crmConsent.findMany({
        where: {
          dealerId,
          email: { in: emails },
          withdrawnAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { email: true },
      }),
      this.prisma.crmSuppression.findMany({
        where: { email: { in: emails }, OR: [{ dealerId }, { dealerId: null }] },
        select: { email: true, reason: true, dealerId: true },
      }),
    ]);
    const consented = new Set(consents.map((row) => row.email));
    const suppressed = new Set(
      suppressions
        .filter((row) => row.reason === 'UNSUBSCRIBED' || HARD_SUPPRESSIONS.includes(row.reason))
        .map((row) => row.email),
    );
    const seen = new Set<string>();
    const eligible: typeof leads = [];
    const skipped = { noEmail: 0, noConsent: 0, suppressed: 0, duplicateEmail: 0 };
    for (const lead of leads) {
      if (!lead.emailNormalized) skipped.noEmail += 1;
      else if (suppressed.has(lead.emailNormalized)) skipped.suppressed += 1;
      else if (!consented.has(lead.emailNormalized)) skipped.noConsent += 1;
      else if (seen.has(lead.emailNormalized)) skipped.duplicateEmail += 1;
      else {
        seen.add(lead.emailNormalized);
        eligible.push(lead);
      }
    }
    return {
      matched: leads.length,
      eligible: eligible.length,
      skipped,
      sample: eligible.slice(0, sample).map(({ emailNormalized: _email, ...lead }) => lead),
      leads: eligible,
    };
  }

  async preview(ctx: CrmContext, audience: CampaignAudience) {
    const { leads: _leads, ...result } = await this.audience(ctx.dealerId, audience, 20);
    return result;
  }

  /** Scheduler: launches every campaign whose time has come. */
  async launchDue(now = new Date()): Promise<number> {
    const due = await this.prisma.crmCampaign.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      select: { id: true },
      take: 10,
    });
    let launched = 0;
    for (const { id } of due) {
      // Claim: only one scheduler run moves it to SENDING.
      const claim = await this.prisma.crmCampaign.updateMany({
        where: { id, status: 'SCHEDULED' },
        data: { status: 'SENDING', startedAt: now },
      });
      if (claim.count === 0) continue;
      try {
        await this.launch(id);
        launched += 1;
      } catch (error) {
        this.logger.error(`Campaign ${id} failed to launch: ${String(error)}`);
        await this.prisma.crmCampaign.update({
          where: { id },
          data: { status: 'SCHEDULED', scheduledAt: new Date(now.getTime() + 5 * 60_000) },
        });
      }
    }
    return launched;
  }

  private async launch(id: string) {
    const campaign = await this.prisma.crmCampaign.findUniqueOrThrow({
      where: { id },
      include: { template: true, dealer: { select: { ownerId: true } } },
    });
    if (!campaign.template) throw new Error('The campaign has no template');
    const ctx = systemContext(campaign.dealerId, campaign.dealer.ownerId);
    const audience = await this.audience(campaign.dealerId, campaign.audience as CampaignAudience);
    let queued = 0;
    for (const lead of audience.leads) {
      const result = await this.outbox.queueLeadEmail(ctx, {
        leadId: lead.id,
        subject: campaign.subject ?? campaign.template.subject,
        bodyHtml: campaign.template.bodyHtml,
        purpose: 'MARKETING',
        templateId: campaign.template.id,
        campaignId: id,
        idempotencyKey: `campaign:${id}:${lead.id}`,
      });
      if (result.status !== 'SUPPRESSED') queued += 1;
    }
    const skipped = audience.matched - queued;
    await this.prisma.crmCampaign.update({
      where: { id },
      data: {
        status: 'SENT',
        completedAt: new Date(),
        recipientCount: queued,
        skippedCount: skipped,
      },
    });
  }

  private async checkTemplate(ctx: CrmContext, templateId: string) {
    const template = await this.prisma.crmEmailTemplate.findFirst({
      where: { id: templateId, scope: 'DEALER', dealerId: ctx.dealerId, isActive: true },
      select: { id: true },
    });
    if (!template)
      throw new BadRequestException({
        message: 'Choose an active template',
        details: { templateId: ['Choose an active template'] },
      });
  }

  private async stats(ids: string[]) {
    const map = new Map<string, ReturnType<typeof emptyStats>>();
    if (!ids.length) return map;
    const rows = await this.prisma.$queryRaw<
      Array<{
        campaignId: string;
        total: bigint;
        sent: bigint;
        delivered: bigint;
        opened: bigint;
        clicked: bigint;
        replied: bigint;
        bounced: bigint;
        unsubscribed: bigint;
        failed: bigint;
      }>
    >`
      SELECT "campaignId",
        count(*) AS total,
        count("sentAt") AS sent,
        count("deliveredAt") AS delivered,
        count("openedAt") AS opened,
        count("clickedAt") AS clicked,
        count("repliedAt") AS replied,
        count("bouncedAt") AS bounced,
        count("unsubscribedAt") AS unsubscribed,
        count(*) FILTER (WHERE status = 'FAILED') AS failed
      FROM "CrmEmail" WHERE "campaignId" = ANY(${ids}::uuid[])
      GROUP BY "campaignId"`;
    for (const row of rows) {
      map.set(row.campaignId, {
        total: Number(row.total),
        sent: Number(row.sent),
        delivered: Number(row.delivered),
        opened: Number(row.opened),
        clicked: Number(row.clicked),
        replied: Number(row.replied),
        bounced: Number(row.bounced),
        unsubscribed: Number(row.unsubscribed),
        failed: Number(row.failed),
      });
    }
    return map;
  }
}

function emptyStats() {
  return {
    total: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    replied: 0,
    bounced: 0,
    unsubscribed: 0,
    failed: 0,
  };
}

export function audienceWhere(
  dealerId: string,
  audience: CampaignAudience,
): Prisma.CrmLeadWhereInput {
  const and: Prisma.CrmLeadWhereInput[] = [
    { dealerId, mergedIntoId: null, emailNormalized: { not: null } },
  ];
  if (audience.statusIds.length) and.push({ statusId: { in: audience.statusIds } });
  if (audience.sourceIds.length) and.push({ sourceId: { in: audience.sourceIds } });
  if (audience.tags.length) {
    and.push({ tags: { some: { tag: { name: { in: audience.tags, mode: 'insensitive' } } } } });
  }
  if (audience.provinces.length) and.push({ province: { in: audience.provinces } });
  if (audience.temperatures.length) and.push({ temperature: { in: audience.temperatures } });
  if (audience.makes.length) {
    and.push({
      OR: audience.makes.map((make) => ({
        vehicle: { make: { equals: make, mode: 'insensitive' as const } },
      })),
    });
  }
  if (audience.minBudget !== null && audience.minBudget !== undefined)
    and.push({ budgetCents: { gte: audience.minBudget } });
  if (audience.maxBudget !== null && audience.maxBudget !== undefined)
    and.push({ budgetCents: { lte: audience.maxBudget } });
  if (audience.customers === 'ONLY') and.push({ customerId: { not: null } });
  if (audience.customers === 'EXCLUDE') and.push({ customerId: null });
  if (audience.activeAfter)
    and.push({ lastActivityAt: { gte: new Date(`${audience.activeAfter}T00:00:00Z`) } });
  if (audience.inactiveSince) {
    and.push({
      OR: [
        { lastActivityAt: null },
        { lastActivityAt: { lt: new Date(`${audience.inactiveSince}T00:00:00Z`) } },
      ],
    });
  }
  return { AND: and };
}
