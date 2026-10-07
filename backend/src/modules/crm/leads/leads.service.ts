import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CONSENT_DURATION_DAYS,
  JOURNEY_STAGES,
  normalizeEmail,
  normalizePhone,
  type ActivityInput,
  type ConsentType,
  type LeadAssignInput,
  type LeadBulkInput,
  type LeadInput,
  type LeadListQuery,
  type LeadStatusChangeInput,
  type ScoreSignal,
} from '@vintrax/shared';
import { Prisma, type CrmTimelineType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit } from '../core/audit';
import { CrmBus, type CrmSignal } from '../core/bus';
import { assertCrm, can, leadScope, type CrmContext } from '../core/context';
import { CrmNotifyService } from '../core/notify.service';
import { addDaysLocal, startOfLocalDay } from '../core/time';
import { AssignmentService } from './assignment.service';
import { ScoringService } from './scoring.service';
import { recordTimeline } from './timeline';

type Db = Prisma.TransactionClient;

export const leadListSelect = {
  id: true,
  number: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  preferredContact: true,
  city: true,
  province: true,
  score: true,
  temperature: true,
  campaign: true,
  budgetCents: true,
  financingInterest: true,
  tradeInInterest: true,
  interestedVin: true,
  firstContactAt: true,
  lastContactAt: true,
  lastActivityAt: true,
  nextFollowUpAt: true,
  lastRepliedAt: true,
  wonAt: true,
  lostAt: true,
  customerId: true,
  createdAt: true,
  updatedAt: true,
  status: { select: { id: true, key: true, label: true, kind: true } },
  source: { select: { id: true, key: true, label: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
  vehicle: {
    select: { id: true, title: true, year: true, make: true, model: true, trim: true, priceCad: true, vin: true },
  },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.CrmLeadSelect;

/** Activity types that count as the dealership reaching the customer. */
const CONTACT_TYPES = new Set<CrmTimelineType>(['CALL', 'EMAIL', 'SMS', 'MEETING', 'FOLLOW_UP', 'EMAIL_SENT']);

export interface CreateLeadOptions {
  /** Look the source up by key when no id was given (inbound events). */
  sourceKey?: string;
  /** The marketplace account the lead came from. */
  userId?: string | null;
  conversationId?: string | null;
  financeApplicationId?: string | null;
  /** Scoring signals to apply on creation (e.g. an inquiry, a finance request). */
  signals?: ScoreSignal[];
  /** Extra triggers to publish after LEAD_CREATED. */
  triggers?: CrmSignal['type'][];
  /** Timeline entries to add after "Lead created". */
  events?: Array<{ type: CrmTimelineType; title: string; notes?: string | null; vehicleId?: string | null }>;
  /** Consent implied by how the lead arrived (an inquiry). */
  impliedConsent?: { type: ConsentType; source: string; evidence: string } | null;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly assignment: AssignmentService,
    private readonly notify: CrmNotifyService,
    private readonly bus: CrmBus,
  ) {}

  // --- Reading -------------------------------------------------------------------

  async list(ctx: CrmContext, query: LeadListQuery) {
    const where = await this.listWhere(ctx, query);
    const orderBy: Prisma.CrmLeadOrderByWithRelationInput[] =
      query.sort === 'oldest'
        ? [{ createdAt: 'asc' }]
        : query.sort === 'score'
          ? [{ score: 'desc' }, { createdAt: 'desc' }]
          : query.sort === 'next_follow_up'
            ? [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]
            : query.sort === 'last_activity'
              ? [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }]
              : [{ createdAt: 'desc' }];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.crmLead.count({ where }),
      this.prisma.crmLead.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: leadListSelect,
      }),
    ]);
    return {
      items: rows.map(flattenTags),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async listWhere(ctx: CrmContext, query: Partial<LeadListQuery>): Promise<Prisma.CrmLeadWhereInput> {
    const and: Prisma.CrmLeadWhereInput[] = [leadScope(ctx)];
    const now = new Date();
    const timezone = await this.timezone(ctx.dealerId);
    switch (query.view) {
      case 'NEW':
        and.push({ status: { key: 'NEW' } });
        break;
      case 'UNCONTACTED':
        and.push({ firstContactAt: null, status: { kind: 'OPEN' } });
        break;
      case 'FOLLOW_UP_TODAY': {
        const start = startOfLocalDay(now, timezone);
        and.push({
          nextFollowUpAt: { gte: start, lt: addDaysLocal(start, 1, timezone) },
          status: { kind: { in: ['OPEN', 'NURTURE'] } },
        });
        break;
      }
      case 'OVERDUE':
        and.push({ nextFollowUpAt: { lt: now }, status: { kind: { in: ['OPEN', 'NURTURE'] } } });
        break;
      case 'HOT':
        and.push({ temperature: 'HOT', status: { kind: 'OPEN' } });
        break;
      case 'MINE':
        and.push({ assignedToId: ctx.userId });
        break;
      case 'UNASSIGNED':
        and.push({ assignedToId: null });
        break;
      case 'WON':
        and.push({ status: { kind: 'WON' } });
        break;
      case 'LOST':
        and.push({ status: { kind: 'LOST' } });
        break;
      default:
        break;
    }
    if (query.statusId) and.push({ statusId: query.statusId });
    if (query.sourceId) and.push({ sourceId: query.sourceId });
    if (query.assignedToId === 'unassigned') and.push({ assignedToId: null });
    else if (query.assignedToId) and.push({ assignedToId: query.assignedToId });
    if (query.temperature) and.push({ temperature: query.temperature });
    if (query.province) and.push({ province: query.province });
    if (query.tag) and.push({ tags: { some: { tag: { name: { equals: query.tag, mode: 'insensitive' } } } } });
    if (query.from) and.push({ createdAt: { gte: new Date(`${query.from}T00:00:00Z`) } });
    if (query.to) and.push({ createdAt: { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + 86_400_000) } });
    if (query.q) and.push(searchFilter(query.q));
    return { AND: and };
  }

  /** One lead, or 404 when it is not this caller's to see. */
  async findVisible(ctx: CrmContext, id: string, db: Db = this.prisma) {
    const lead = await db.crmLead.findFirst({
      where: { id, ...leadScope(ctx) },
      select: { id: true, dealerId: true, assignedToId: true, statusId: true, mergedIntoId: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async get(ctx: CrmContext, id: string) {
    await this.findVisible(ctx, id);
    const lead = await this.prisma.crmLead.findUniqueOrThrow({
      where: { id },
      select: {
        ...leadListSelect,
        address: true,
        postalCode: true,
        vehicleUrl: true,
        tradeInVehicle: true,
        preferredAppointmentAt: true,
        notes: true,
        lostReason: true,
        team: true,
        assignedAt: true,
        convertedAt: true,
        emailNormalized: true,
        userId: true,
        conversationId: true,
        financeApplicationId: true,
        customer: { select: { id: true, name: true, email: true, phone: true } },
        mergedFrom: { select: { id: true, number: true, firstName: true, lastName: true } },
      },
    });
    const [tasks, appointments, enrollments, consents, suppressed, journey, sales, deposits, emailStats] =
      await Promise.all([
        this.prisma.crmTask.findMany({
          where: { leadId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }],
          take: 20,
          include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
        }),
        this.prisma.crmAppointment.findMany({
          where: { leadId: id },
          orderBy: { startsAt: 'desc' },
          take: 20,
          include: {
            salesperson: { select: { id: true, firstName: true, lastName: true } },
            vehicle: { select: { id: true, title: true } },
          },
        }),
        this.prisma.crmAutomationEnrollment.findMany({
          where: { leadId: id },
          orderBy: { startedAt: 'desc' },
          take: 20,
          include: { automation: { select: { id: true, name: true, key: true } } },
        }),
        this.prisma.crmConsent.findMany({ where: { leadId: id }, orderBy: { grantedAt: 'desc' } }),
        lead.emailNormalized
          ? this.prisma.crmSuppression.findMany({
              where: {
                email: lead.emailNormalized,
                OR: [{ dealerId: ctx.dealerId }, { dealerId: null }],
              },
              select: { reason: true, dealerId: true, createdAt: true },
            })
          : Promise.resolve([]),
        this.journey(id),
        lead.customerId
          ? this.prisma.vehicleSale.findMany({
              where: { dealerId: ctx.dealerId, customerId: lead.customerId },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                number: true,
                status: true,
                saleDate: true,
                totalAmount: true,
                vehicle: { select: { id: true, title: true } },
              },
            })
          : Promise.resolve([]),
        lead.customerId
          ? this.prisma.customerDeposit.findMany({
              where: { dealerId: ctx.dealerId, customerId: lead.customerId },
              orderBy: { createdAt: 'desc' },
              select: { id: true, number: true, status: true, date: true, amount: true },
            })
          : Promise.resolve([]),
        this.prisma.crmEmail.groupBy({ by: ['status'], where: { leadId: id }, _count: { _all: true } }),
      ]);
    return {
      ...flattenTags(lead),
      tasks,
      appointments,
      enrollments,
      consents,
      suppressions: suppressed,
      journey,
      sales,
      deposits,
      emailCounts: Object.fromEntries(emailStats.map((row) => [row.status, row._count._all])),
      marketingAllowed: await this.marketingAllowed(ctx.dealerId, lead.emailNormalized),
    };
  }

  /** Where the customer is in the purchase journey: each stage and when it was first reached. */
  async journey(leadId: string) {
    const types = [...new Set(JOURNEY_STAGES.flatMap((stage) => stage.events))] as CrmTimelineType[];
    const firsts = await this.prisma.crmActivity.groupBy({
      by: ['type'],
      where: { leadId, type: { in: types } },
      _min: { occurredAt: true },
    });
    const at = new Map(firsts.map((row) => [row.type as string, row._min.occurredAt]));
    return JOURNEY_STAGES.map((stage) => {
      const dates = stage.events
        .map((event) => at.get(event))
        .filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime());
      return { key: stage.key, label: stage.label, reachedAt: dates[0] ?? null };
    });
  }

  async timeline(
    ctx: CrmContext,
    leadId: string,
    query: { type?: string; cursor?: string; limit: number },
  ) {
    await this.findVisible(ctx, leadId);
    const rows = await this.prisma.crmActivity.findMany({
      where: {
        leadId,
        ...(query.type ? { type: query.type as CrmTimelineType } : {}),
        ...(query.cursor ? { occurredAt: { lt: new Date(query.cursor) } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: query.limit + 1,
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    const more = rows.length > query.limit;
    const items = more ? rows.slice(0, query.limit) : rows;
    return { items, nextCursor: more ? items[items.length - 1]!.occurredAt.toISOString() : null };
  }

  // --- Writing -------------------------------------------------------------------

  async create(ctx: CrmContext, input: LeadInput, options: CreateLeadOptions = {}) {
    const refs = await this.validateRefs(ctx, input);
    if (!can(ctx, 'crm.manage') && input.assignedToId && input.assignedToId !== ctx.userId) {
      throw new ForbiddenException('Only a manager can assign a lead to someone else');
    }
    const emailNormalized = normalizeEmail(input.email);
    const phoneNormalized = normalizePhone(input.phone);
    let sourceId = input.sourceId;
    let sourceLabel = refs.sourceLabel;
    if (!sourceId && options.sourceKey) {
      const source = await this.prisma.crmLeadSource.findUnique({
        where: { dealerId_key: { dealerId: ctx.dealerId, key: options.sourceKey } },
        select: { id: true, label: true },
      });
      sourceId = source?.id ?? null;
      sourceLabel = source?.label ?? null;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // One number at a time per dealership.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'crm-lead-' + ctx.dealerId}))`;
      const last = await tx.crmLead.aggregate({ where: { dealerId: ctx.dealerId }, _max: { number: true } });
      const statusId = input.statusId ?? refs.defaultStatusId;

      let assignedToId = input.assignedToId;
      let team = input.team;
      if (!assignedToId) {
        if (!can(ctx, 'crm.manage') && !ctx.system) {
          // A salesperson's own walk-in is theirs.
          assignedToId = ctx.userId;
        } else {
          const picked = await this.assignment.pick(
            {
              dealerId: ctx.dealerId,
              sourceId,
              province: input.province,
              vehicleMake: refs.vehicleMake,
            },
            tx,
          );
          assignedToId = picked.userId;
          team = team ?? picked.team;
        }
      }

      const lead = await tx.crmLead.create({
        data: {
          dealerId: ctx.dealerId,
          number: (last._max.number ?? 1000) + 1,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          emailNormalized,
          phone: input.phone,
          phoneNormalized,
          preferredContact: input.preferredContact,
          address: input.address,
          city: input.city,
          province: input.province,
          postalCode: input.postalCode,
          sourceId,
          campaign: input.campaign,
          vehicleId: input.vehicleId,
          interestedVin: input.interestedVin?.toUpperCase() ?? refs.vehicleVin,
          vehicleUrl: input.vehicleUrl,
          budgetCents: input.budget,
          financingInterest: input.financingInterest,
          tradeInInterest: input.tradeInInterest,
          tradeInVehicle: input.tradeInVehicle,
          preferredAppointmentAt: input.preferredAppointmentAt,
          notes: input.notes,
          statusId,
          assignedToId,
          team,
          assignedAt: assignedToId ? new Date() : null,
          nextFollowUpAt: input.nextFollowUpAt,
          userId: options.userId ?? null,
          conversationId: options.conversationId ?? null,
          financeApplicationId: options.financeApplicationId ?? null,
          createdById: ctx.system ? null : ctx.userId,
          lastActivityAt: new Date(),
        },
        select: { id: true, number: true, firstName: true, lastName: true, assignedToId: true },
      });

      await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId: lead.id,
        type: 'LEAD_CREATED',
        title: sourceLabel ? `Lead created from ${sourceLabel}` : 'Lead created',
        userId: ctx.system ? null : ctx.userId,
        vehicleId: input.vehicleId,
      });
      for (const event of options.events ?? []) {
        await recordTimeline(tx, { dealerId: ctx.dealerId, leadId: lead.id, ...event });
      }
      if (assignedToId) {
        await recordTimeline(tx, {
          dealerId: ctx.dealerId,
          leadId: lead.id,
          type: 'LEAD_ASSIGNED',
          title: `Assigned to ${await this.userName(tx, assignedToId)}`,
          userId: ctx.system ? null : ctx.userId,
        });
      }
      if (input.tags.length) await this.applyTags(tx, ctx, lead.id, input.tags, false);
      const consent = input.consent ?? options.impliedConsent ?? null;
      if (consent && emailNormalized) {
        await this.recordConsent(tx, ctx, lead.id, emailNormalized, consent);
      }
      for (const signal of options.signals ?? []) await this.scoring.apply(lead.id, signal, tx);
      await crmAudit(tx, ctx, {
        action: 'lead.created',
        entityType: 'CrmLead',
        entityId: lead.id,
        after: { number: lead.number, firstName: lead.firstName, assignedToId, sourceId },
      });
      return lead;
    });

    if (created.assignedToId) await this.afterAssignment(ctx, created.id, created.assignedToId);
    await this.bus.publish({ type: 'LEAD_CREATED', scope: 'DEALER', dealerId: ctx.dealerId, leadId: created.id });
    if (created.assignedToId) {
      await this.bus.publish({ type: 'LEAD_ASSIGNED', scope: 'DEALER', dealerId: ctx.dealerId, leadId: created.id });
    }
    for (const trigger of options.triggers ?? []) {
      await this.bus.publish({ type: trigger, scope: 'DEALER', dealerId: ctx.dealerId, leadId: created.id });
    }
    return created;
  }

  async update(ctx: CrmContext, id: string, input: LeadInput) {
    const current = await this.findVisible(ctx, id);
    const refs = await this.validateRefs(ctx, input);
    const before = await this.prisma.crmLead.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction(async (tx) => {
      await tx.crmLead.update({
        where: { id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          emailNormalized: normalizeEmail(input.email),
          phone: input.phone,
          phoneNormalized: normalizePhone(input.phone),
          preferredContact: input.preferredContact,
          address: input.address,
          city: input.city,
          province: input.province,
          postalCode: input.postalCode,
          sourceId: input.sourceId,
          campaign: input.campaign,
          vehicleId: input.vehicleId,
          interestedVin: input.interestedVin?.toUpperCase() ?? refs.vehicleVin,
          vehicleUrl: input.vehicleUrl,
          budgetCents: input.budget,
          financingInterest: input.financingInterest,
          tradeInInterest: input.tradeInInterest,
          tradeInVehicle: input.tradeInVehicle,
          preferredAppointmentAt: input.preferredAppointmentAt,
          notes: input.notes,
          nextFollowUpAt: input.nextFollowUpAt,
          team: input.team,
        },
      });
      await this.applyTags(tx, ctx, id, input.tags, true);
      await crmAudit(tx, ctx, {
        action: 'lead.updated',
        entityType: 'CrmLead',
        entityId: id,
        before: pick(before, ['firstName', 'lastName', 'email', 'phone', 'sourceId', 'vehicleId']),
        after: pick(input, ['firstName', 'lastName', 'email', 'phone', 'sourceId', 'vehicleId']),
      });
    });
    if (input.statusId && input.statusId !== current.statusId) {
      await this.changeStatus(ctx, id, { statusId: input.statusId, lostReason: null });
    }
    if (input.assignedToId !== undefined && input.assignedToId !== current.assignedToId && can(ctx, 'crm.manage')) {
      await this.assign(ctx, id, { assignedToId: input.assignedToId, team: input.team });
    }
    return this.get(ctx, id);
  }

  async changeStatus(ctx: CrmContext, id: string, input: LeadStatusChangeInput) {
    const lead = await this.findVisible(ctx, id);
    const status = await this.prisma.crmLeadStatus.findFirst({
      where: { id: input.statusId, dealerId: ctx.dealerId },
    });
    if (!status) throw new BadRequestException('Unknown status');
    if (status.kind === 'LOST' && !input.lostReason) {
      throw new BadRequestException({
        message: 'Say why the lead was lost',
        details: { lostReason: ['Required when marking a lead lost'] },
      });
    }
    if (lead.statusId === status.id) return { id, changed: false };
    const previous = await this.prisma.crmLeadStatus.findUniqueOrThrow({ where: { id: lead.statusId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.crmLead.update({
        where: { id },
        data: {
          statusId: status.id,
          lostReason: status.kind === 'LOST' ? input.lostReason : null,
          wonAt: status.kind === 'WON' ? new Date() : previous.kind === 'WON' ? null : undefined,
          lostAt: status.kind === 'LOST' ? new Date() : previous.kind === 'LOST' ? null : undefined,
        },
      });
      await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId: id,
        type: 'STATUS_CHANGED',
        title: `${previous.label} → ${status.label}`,
        notes: status.kind === 'LOST' ? input.lostReason : null,
        userId: ctx.system ? null : ctx.userId,
        metadata: { from: previous.key, to: status.key },
      });
      await crmAudit(tx, ctx, {
        action: 'lead.status_changed',
        entityType: 'CrmLead',
        entityId: id,
        before: { status: previous.key },
        after: { status: status.key, lostReason: input.lostReason },
      });
    });

    const signal = { scope: 'DEALER' as const, dealerId: ctx.dealerId, leadId: id };
    await this.bus.publish({ ...signal, type: 'LEAD_STATUS_CHANGED', statusKey: status.key });
    if (status.kind === 'WON') await this.bus.publish({ ...signal, type: 'DEAL_WON' });
    if (status.kind === 'LOST') await this.bus.publish({ ...signal, type: 'DEAL_LOST' });
    return { id, changed: true };
  }

  /** Moves a lead to the status with this key (automations, inbound events). */
  async setStatusByKey(ctx: CrmContext, id: string, key: string, lostReason: string | null = null) {
    const status = await this.prisma.crmLeadStatus.findUnique({
      where: { dealerId_key: { dealerId: ctx.dealerId, key } },
    });
    if (!status) return { id, changed: false };
    return this.changeStatus(ctx, id, { statusId: status.id, lostReason: lostReason ?? (status.kind === 'LOST' ? 'Closed automatically' : null) });
  }

  async assign(ctx: CrmContext, id: string, input: LeadAssignInput) {
    const lead = await this.findVisible(ctx, id);
    const claimingForSelf =
      input.assignedToId === ctx.userId && (lead.assignedToId === null || lead.assignedToId === ctx.userId);
    if (!can(ctx, 'crm.manage') && !claimingForSelf) {
      throw new ForbiddenException('Only a manager can reassign leads');
    }
    if (input.assignedToId && !(await this.assignment.isSalesStaff(this.prisma, ctx.dealerId, input.assignedToId))) {
      throw new BadRequestException('That person is not on this dealership’s sales staff');
    }
    if (lead.assignedToId === input.assignedToId) return { id, changed: false };

    await this.prisma.$transaction(async (tx) => {
      await tx.crmLead.update({
        where: { id },
        data: { assignedToId: input.assignedToId, team: input.team, assignedAt: input.assignedToId ? new Date() : null },
      });
      await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId: id,
        type: 'LEAD_ASSIGNED',
        title: input.assignedToId ? `Assigned to ${await this.userName(tx, input.assignedToId)}` : 'Unassigned',
        userId: ctx.system ? null : ctx.userId,
      });
      await crmAudit(tx, ctx, {
        action: 'lead.assigned',
        entityType: 'CrmLead',
        entityId: id,
        before: { assignedToId: lead.assignedToId },
        after: { assignedToId: input.assignedToId, team: input.team },
      });
    });
    if (input.assignedToId) {
      await this.afterAssignment(ctx, id, input.assignedToId);
      await this.bus.publish({ type: 'LEAD_ASSIGNED', scope: 'DEALER', dealerId: ctx.dealerId, leadId: id });
    }
    return { id, changed: true };
  }

  /** On assignment: tell the salesperson, and give them a first-contact task. */
  private async afterAssignment(ctx: CrmContext, leadId: string, userId: string) {
    const lead = await this.prisma.crmLead.findUniqueOrThrow({
      where: { id: leadId },
      select: { number: true, firstName: true, lastName: true, firstContactAt: true },
    });
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
    const settings = await this.prisma.crmSettings.findUnique({ where: { dealerId: ctx.dealerId } });
    if ((settings?.createFollowUpTask ?? true) && !lead.firstContactAt) {
      const existing = await this.prisma.crmTask.findFirst({
        where: { leadId, assignedToId: userId, status: { in: ['OPEN', 'IN_PROGRESS'] }, title: { startsWith: 'First contact' } },
        select: { id: true },
      });
      if (!existing) {
        const minutes = settings?.responseTargetMinutes ?? 5;
        await this.prisma.$transaction(async (tx) => {
          const task = await tx.crmTask.create({
            data: {
              dealerId: ctx.dealerId,
              leadId,
              assignedToId: userId,
              title: `First contact: ${name}`,
              description: 'Reach the customer by their preferred method and log the call or email.',
              dueAt: new Date(Date.now() + minutes * 60_000),
              priority: 'HIGH',
              createdById: ctx.system ? null : ctx.userId,
            },
          });
          await recordTimeline(tx, {
            dealerId: ctx.dealerId,
            leadId,
            type: 'TASK_CREATED',
            title: task.title,
            metadata: { taskId: task.id },
          });
        });
      }
    }
    if (userId !== ctx.userId || ctx.system) {
      await this.notify.notify(userId, 'LEAD_ASSIGNED', {
        title: `New lead: ${name}`,
        body: `Lead #${lead.number} (${name}) has been assigned to you.`,
        link: `/dealer/crm/leads/${leadId}`,
      });
    }
  }

  async setTags(ctx: CrmContext, id: string, tags: string[]) {
    await this.findVisible(ctx, id);
    await this.prisma.$transaction((tx) => this.applyTags(tx, ctx, id, tags, true));
    return { id };
  }

  async remove(ctx: CrmContext, id: string) {
    assertCrm(ctx, 'crm.manage');
    await this.findVisible(ctx, id);
    const before = await this.prisma.crmLead.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction(async (tx) => {
      await tx.crmEmail.updateMany({
        where: { leadId: id, status: { in: ['SCHEDULED', 'QUEUED'] } },
        data: { status: 'CANCELLED' },
      });
      await tx.crmLead.delete({ where: { id } });
      await crmAudit(tx, ctx, {
        action: 'lead.deleted',
        entityType: 'CrmLead',
        entityId: id,
        before: pick(before, ['number', 'firstName', 'lastName', 'email', 'phone']),
      });
    });
  }

  async logActivity(ctx: CrmContext, leadId: string, input: ActivityInput) {
    await this.findVisible(ctx, leadId);
    const lead = await this.prisma.crmLead.findUniqueOrThrow({
      where: { id: leadId },
      select: { firstContactAt: true },
    });
    const at = input.occurredAt ?? new Date();
    const activity = await this.prisma.$transaction(async (tx) => {
      const row = await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId,
        type: input.type,
        title: input.title,
        notes: input.notes,
        status: input.status,
        outcome: input.outcome,
        nextAction: input.nextAction,
        vehicleId: input.vehicleId,
        occurredAt: at,
        userId: ctx.userId,
      });
      await this.markContactedIf(tx, ctx, leadId, input.type, at, lead.firstContactAt);
      if (input.nextFollowUpAt) {
        await tx.crmLead.update({ where: { id: leadId }, data: { nextFollowUpAt: input.nextFollowUpAt } });
      }
      if (input.type === 'TEST_DRIVE') await this.scoring.apply(leadId, 'TEST_DRIVE', tx);
      if (input.type === 'TRADE_IN') await this.scoring.apply(leadId, 'TRADE_IN_SUBMITTED', tx);
      if (input.type === 'FINANCE') await this.scoring.apply(leadId, 'FINANCING_REQUEST', tx);
      return row;
    });
    const signal = { scope: 'DEALER' as const, dealerId: ctx.dealerId, leadId };
    if (input.type === 'TEST_DRIVE') await this.bus.publish({ ...signal, type: 'TEST_DRIVE_COMPLETED' });
    if (input.type === 'QUOTE') await this.bus.publish({ ...signal, type: 'QUOTE_CREATED' });
    if (input.type === 'TRADE_IN') await this.bus.publish({ ...signal, type: 'TRADE_IN_SUBMITTED' });
    if (input.type === 'FINANCE') await this.bus.publish({ ...signal, type: 'FINANCING_REQUESTED' });
    return activity;
  }

  /** The dealership reached the customer: first contact (once) and last contact. */
  async markContactedIf(
    db: Db,
    ctx: Pick<CrmContext, 'dealerId' | 'userId' | 'system'>,
    leadId: string,
    type: CrmTimelineType,
    at: Date,
    firstContactAt: Date | null,
  ) {
    if (!CONTACT_TYPES.has(type)) return;
    await db.crmLead.update({
      where: { id: leadId },
      data: { lastContactAt: at, ...(firstContactAt ? {} : { firstContactAt: at }) },
    });
    if (!firstContactAt) {
      await recordTimeline(db, {
        dealerId: ctx.dealerId,
        leadId,
        type: 'FIRST_CONTACT',
        title: 'First contact',
        occurredAt: at,
        userId: ctx.system ? null : ctx.userId,
      });
      // Out of "New" once someone has reached them.
      const contacted = await db.crmLeadStatus.findUnique({
        where: { dealerId_key: { dealerId: ctx.dealerId, key: 'CONTACTED' } },
      });
      if (contacted) {
        await db.crmLead.updateMany({
          where: { id: leadId, status: { key: 'NEW' } },
          data: { statusId: contacted.id },
        });
      }
    }
  }

  async duplicates(ctx: CrmContext, id: string) {
    await this.findVisible(ctx, id);
    const lead = await this.prisma.crmLead.findUniqueOrThrow({ where: { id } });
    return this.findDuplicates(ctx, {
      excludeId: id,
      emailNormalized: lead.emailNormalized,
      phoneNormalized: lead.phoneNormalized,
      firstName: lead.firstName,
      lastName: lead.lastName,
      vin: lead.interestedVin,
    });
  }

  /** Possible duplicates, strongest first: same email, same phone, same name, same VIN. */
  async findDuplicates(
    ctx: CrmContext,
    probe: {
      excludeId?: string;
      emailNormalized?: string | null;
      phoneNormalized?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      vin?: string | null;
    },
  ) {
    const or: Prisma.CrmLeadWhereInput[] = [];
    if (probe.emailNormalized) or.push({ emailNormalized: probe.emailNormalized });
    if (probe.phoneNormalized) or.push({ phoneNormalized: probe.phoneNormalized });
    if (probe.firstName && probe.lastName) {
      or.push({
        firstName: { equals: probe.firstName, mode: 'insensitive' },
        lastName: { equals: probe.lastName, mode: 'insensitive' },
      });
    }
    if (probe.vin) or.push({ interestedVin: probe.vin.toUpperCase() });
    if (!or.length) return [];
    const rows = await this.prisma.crmLead.findMany({
      where: { ...leadScope(ctx), OR: or, ...(probe.excludeId ? { id: { not: probe.excludeId } } : {}) },
      select: leadListSelect,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .map((row) => {
        const reasons: string[] = [];
        if (probe.emailNormalized && normalizeEmail(row.email) === probe.emailNormalized) reasons.push('EMAIL');
        if (probe.phoneNormalized && normalizePhone(row.phone) === probe.phoneNormalized) reasons.push('PHONE');
        if (
          probe.firstName &&
          probe.lastName &&
          row.firstName.toLowerCase() === probe.firstName.toLowerCase() &&
          row.lastName?.toLowerCase() === probe.lastName.toLowerCase()
        ) {
          reasons.push('NAME');
        }
        if (probe.vin && row.interestedVin === probe.vin.toUpperCase()) reasons.push('VIN');
        return { ...flattenTags(row), reasons };
      })
      .sort((a, b) => rank(b.reasons) - rank(a.reasons));
  }

  /**
   * Folds a duplicate into this lead. Every activity, email, task,
   * appointment, consent and score event moves across, so no history is
   * lost; blank fields are filled from the duplicate; the duplicate stays,
   * hidden, pointing here.
   */
  async merge(ctx: CrmContext, targetId: string, duplicateId: string) {
    assertCrm(ctx, 'crm.manage');
    if (targetId === duplicateId) throw new BadRequestException('A lead cannot be merged into itself');
    await this.findVisible(ctx, targetId);
    await this.findVisible(ctx, duplicateId);
    const [target, duplicate] = await Promise.all([
      this.prisma.crmLead.findUniqueOrThrow({ where: { id: targetId }, include: { tags: true } }),
      this.prisma.crmLead.findUniqueOrThrow({ where: { id: duplicateId }, include: { tags: true } }),
    ]);
    if (target.customerId && duplicate.customerId && target.customerId !== duplicate.customerId) {
      throw new ConflictException(
        'Both leads are linked to different customers in accounting; merge the customers there first',
      );
    }
    const fill = <K extends keyof typeof target>(key: K) =>
      (target[key] === null || target[key] === undefined || target[key] === '') && duplicate[key] !== null
        ? duplicate[key]
        : target[key];

    await this.prisma.$transaction(async (tx) => {
      const moved = { leadId: targetId };
      await tx.crmActivity.updateMany({ where: { leadId: duplicateId }, data: moved });
      await tx.crmTask.updateMany({ where: { leadId: duplicateId }, data: moved });
      await tx.crmAppointment.updateMany({ where: { leadId: duplicateId }, data: moved });
      await tx.crmEmail.updateMany({ where: { leadId: duplicateId }, data: moved });
      await tx.crmLeadScoreEvent.updateMany({ where: { leadId: duplicateId }, data: moved });
      await tx.crmConsent.updateMany({ where: { leadId: duplicateId }, data: moved });
      // A merged lead's running sequences stop; the surviving lead's continue.
      await tx.crmAutomationEnrollment.updateMany({
        where: { leadId: duplicateId, status: { in: ['ACTIVE', 'WAITING'] } },
        data: { status: 'STOPPED', stopReason: 'MERGED', finishedAt: new Date(), nextRunAt: null },
      });
      const haveTags = new Set(target.tags.map((tag) => tag.tagId));
      const newTags = duplicate.tags.filter((tag) => !haveTags.has(tag.tagId));
      if (newTags.length) {
        await tx.crmLeadTag.createMany({
          data: newTags.map((tag) => ({ leadId: targetId, tagId: tag.tagId })),
          skipDuplicates: true,
        });
      }
      const earliest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);
      const latest = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
      await tx.crmLead.update({
        where: { id: targetId },
        data: {
          lastName: fill('lastName') as string | null,
          email: fill('email') as string | null,
          emailNormalized: fill('emailNormalized') as string | null,
          phone: fill('phone') as string | null,
          phoneNormalized: fill('phoneNormalized') as string | null,
          address: fill('address') as string | null,
          city: fill('city') as string | null,
          province: fill('province') as typeof target.province,
          postalCode: fill('postalCode') as string | null,
          sourceId: fill('sourceId') as string | null,
          vehicleId: fill('vehicleId') as string | null,
          interestedVin: fill('interestedVin') as string | null,
          budgetCents: fill('budgetCents') as number | null,
          userId: fill('userId') as string | null,
          customerId: fill('customerId') as string | null,
          financingInterest: target.financingInterest || duplicate.financingInterest,
          tradeInInterest: target.tradeInInterest || duplicate.tradeInInterest,
          score: Math.max(target.score, duplicate.score),
          firstContactAt: earliest(target.firstContactAt, duplicate.firstContactAt),
          lastContactAt: latest(target.lastContactAt, duplicate.lastContactAt),
          lastActivityAt: latest(target.lastActivityAt, duplicate.lastActivityAt),
          lastRepliedAt: latest(target.lastRepliedAt, duplicate.lastRepliedAt),
          notes: [target.notes, duplicate.notes].filter(Boolean).join('\n\n') || null,
        },
      });
      await tx.crmLeadTag.deleteMany({ where: { leadId: duplicateId } });
      await tx.crmLead.update({
        where: { id: duplicateId },
        data: { mergedIntoId: targetId, assignedToId: null, nextFollowUpAt: null },
      });
      await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId: targetId,
        type: 'MERGED',
        title: `Merged with lead #${duplicate.number}`,
        userId: ctx.userId,
        metadata: { duplicateId, duplicateNumber: duplicate.number },
      });
      await crmAudit(tx, ctx, {
        action: 'lead.merged',
        entityType: 'CrmLead',
        entityId: targetId,
        before: { duplicateId, duplicateNumber: duplicate.number },
        after: { mergedInto: targetId },
      });
    });
    return this.get(ctx, targetId);
  }

  /**
   * Makes the lead a customer: the dealership's one Customer record (the
   * same one accounting uses for deals and deposits), found by email when it
   * exists and created otherwise.
   */
  async convert(ctx: CrmContext, id: string) {
    await this.findVisible(ctx, id);
    const lead = await this.prisma.crmLead.findUniqueOrThrow({ where: { id } });
    if (lead.customerId) return { id, customerId: lead.customerId, created: false };
    const customerId = await this.prisma.$transaction(async (tx) => {
      const existing = lead.emailNormalized
        ? await tx.customer.findFirst({
            where: { dealerId: ctx.dealerId, email: { equals: lead.emailNormalized, mode: 'insensitive' } },
            select: { id: true },
          })
        : null;
      const customer =
        existing ??
        (await tx.customer.create({
          data: {
            dealerId: ctx.dealerId,
            name: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
            email: lead.email,
            phone: lead.phone,
            address: lead.address,
            city: lead.city,
            province: lead.province,
            postalCode: lead.postalCode,
            userId: lead.userId,
          },
          select: { id: true },
        }));
      await tx.crmLead.update({ where: { id }, data: { customerId: customer.id, convertedAt: new Date() } });
      await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId: id,
        type: 'CONVERTED',
        title: existing ? 'Linked to an existing customer' : 'Converted to a customer',
        userId: ctx.system ? null : ctx.userId,
        metadata: { customerId: customer.id },
      });
      await crmAudit(tx, ctx, {
        action: 'lead.converted',
        entityType: 'CrmLead',
        entityId: id,
        after: { customerId: customer.id, linkedExisting: !!existing },
      });
      return customer.id;
    });
    await this.bus.publish({ type: 'CUSTOMER_CREATED', scope: 'DEALER', dealerId: ctx.dealerId, leadId: id });
    return { id, customerId, created: true };
  }

  async bulk(ctx: CrmContext, input: LeadBulkInput) {
    assertCrm(ctx, 'crm.manage');
    const leads = await this.prisma.crmLead.findMany({
      where: { id: { in: input.leadIds }, ...leadScope(ctx) },
      select: { id: true },
    });
    let done = 0;
    for (const { id } of leads) {
      if (input.action === 'ASSIGN') await this.assign(ctx, id, { assignedToId: input.assignedToId ?? null, team: null });
      else if (input.action === 'SET_STATUS' && input.statusId) {
        await this.changeStatus(ctx, id, { statusId: input.statusId, lostReason: 'Bulk update' });
      } else if (input.action === 'ADD_TAG' && input.tag) {
        await this.prisma.$transaction((tx) => this.applyTags(tx, ctx, id, [input.tag!], false));
      } else if (input.action === 'DELETE') await this.remove(ctx, id);
      done += 1;
    }
    return { updated: done };
  }

  // --- Consent -----------------------------------------------------------------------

  async recordConsent(
    db: Db,
    ctx: Pick<CrmContext, 'dealerId' | 'userId' | 'system' | 'actorEmail'>,
    leadId: string | null,
    email: string,
    consent: { type: ConsentType; source: string; evidence?: string | null },
  ) {
    const days = CONSENT_DURATION_DAYS[consent.type];
    const grantedAt = new Date();
    const row = await db.crmConsent.create({
      data: {
        dealerId: ctx.dealerId,
        leadId,
        email,
        type: consent.type,
        source: consent.source,
        evidence: consent.evidence ?? null,
        grantedAt,
        expiresAt: days === null ? null : new Date(grantedAt.getTime() + days * 86_400_000),
        recordedById: ctx.system ? null : ctx.userId,
      },
    });
    if (leadId) {
      await recordTimeline(db, {
        dealerId: ctx.dealerId,
        leadId,
        type: 'CONSENT_CHANGED',
        title: `Consent recorded: ${consent.type.replace('_', ' ').toLowerCase()}`,
        notes: consent.source,
        userId: ctx.system ? null : ctx.userId,
        metadata: { consentId: row.id },
      });
    }
    await crmAudit(db, ctx, {
      action: 'consent.recorded',
      entityType: 'CrmConsent',
      entityId: row.id,
      after: { email, type: consent.type, source: consent.source, expiresAt: row.expiresAt },
    });
    return row;
  }

  /**
   * Whether marketing may go to this address for this dealer: a consent that
   * has not expired or been withdrawn, and no suppression. Express consent
   * lasts until withdrawn; implied consent until its CASL period ends.
   */
  async marketingAllowed(dealerId: string, email: string | null | undefined): Promise<boolean> {
    if (!email) return false;
    const now = new Date();
    const [consent, suppression] = await Promise.all([
      this.prisma.crmConsent.findFirst({
        where: {
          dealerId,
          email,
          withdrawnAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      }),
      this.prisma.crmSuppression.findFirst({
        where: { email, OR: [{ dealerId }, { dealerId: null }] },
        select: { id: true },
      }),
    ]);
    return !!consent && !suppression;
  }

  // --- Helpers ---------------------------------------------------------------------

  private async validateRefs(ctx: CrmContext, input: LeadInput) {
    const [status, defaultStatus, source, vehicle, assignee] = await Promise.all([
      input.statusId
        ? this.prisma.crmLeadStatus.findFirst({ where: { id: input.statusId, dealerId: ctx.dealerId } })
        : null,
      this.prisma.crmLeadStatus.findUnique({ where: { dealerId_key: { dealerId: ctx.dealerId, key: 'NEW' } } }),
      input.sourceId
        ? this.prisma.crmLeadSource.findFirst({ where: { id: input.sourceId, dealerId: ctx.dealerId } })
        : null,
      input.vehicleId
        ? this.prisma.vehicle.findFirst({
            where: { id: input.vehicleId, sellerId: ctx.ownerUserId },
            select: { id: true, make: true, vin: true },
          })
        : null,
      input.assignedToId ? this.assignment.isSalesStaff(this.prisma, ctx.dealerId, input.assignedToId) : true,
    ]);
    if (input.statusId && !status) throw new BadRequestException({ message: 'Unknown status', details: { statusId: ['Unknown status'] } });
    if (input.sourceId && !source) throw new BadRequestException({ message: 'Unknown source', details: { sourceId: ['Unknown source'] } });
    if (input.vehicleId && !vehicle) {
      throw new BadRequestException({ message: 'That vehicle is not in your inventory', details: { vehicleId: ['Not in your inventory'] } });
    }
    if (!assignee) {
      throw new BadRequestException({ message: 'That person is not on your sales staff', details: { assignedToId: ['Not on your sales staff'] } });
    }
    let defaultStatusId = defaultStatus?.id;
    if (!defaultStatusId) {
      const first = await this.prisma.crmLeadStatus.findFirst({
        where: { dealerId: ctx.dealerId, kind: 'OPEN', isActive: true },
        orderBy: { position: 'asc' },
      });
      if (!first) throw new ConflictException('This dealership has no lead statuses');
      defaultStatusId = first.id;
    }
    return {
      defaultStatusId,
      sourceLabel: source?.label ?? null,
      vehicleMake: vehicle?.make ?? null,
      vehicleVin: vehicle?.vin ?? null,
    };
  }

  async applyTags(db: Db, ctx: Pick<CrmContext, 'dealerId' | 'userId' | 'system'>, leadId: string, names: string[], replace: boolean) {
    const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    const tags = [];
    for (const name of wanted) {
      const existing = await db.crmTag.findFirst({
        where: { scope: 'DEALER', dealerId: ctx.dealerId, name: { equals: name, mode: 'insensitive' } },
      });
      tags.push(existing ?? (await db.crmTag.create({ data: { scope: 'DEALER', dealerId: ctx.dealerId, name } })));
    }
    const current = await db.crmLeadTag.findMany({ where: { leadId }, include: { tag: true } });
    const currentIds = new Set(current.map((row) => row.tagId));
    const wantedIds = new Set(tags.map((tag) => tag.id));
    const added = tags.filter((tag) => !currentIds.has(tag.id));
    const removed = replace ? current.filter((row) => !wantedIds.has(row.tagId)) : [];
    if (added.length) {
      await db.crmLeadTag.createMany({
        data: added.map((tag) => ({ leadId, tagId: tag.id })),
        skipDuplicates: true,
      });
    }
    if (removed.length) {
      await db.crmLeadTag.deleteMany({ where: { leadId, tagId: { in: removed.map((row) => row.tagId) } } });
    }
    const userId = ctx.system ? null : ctx.userId;
    for (const tag of added) {
      await recordTimeline(db, { dealerId: ctx.dealerId, leadId, type: 'TAG_ADDED', title: `Tagged ${tag.name}`, userId });
    }
    for (const row of removed) {
      await recordTimeline(db, { dealerId: ctx.dealerId, leadId, type: 'TAG_REMOVED', title: `Untagged ${row.tag.name}`, userId });
    }
  }

  async timezone(dealerId: string): Promise<string> {
    const settings = await this.prisma.crmSettings.findUnique({ where: { dealerId }, select: { timezone: true } });
    return settings?.timezone ?? 'America/Toronto';
  }

  private async userName(db: Db, userId: string): Promise<string> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    return user ? `${user.firstName} ${user.lastName}`.trim() : 'a salesperson';
  }
}

function rank(reasons: string[]): number {
  return (reasons.includes('EMAIL') ? 8 : 0) + (reasons.includes('PHONE') ? 4 : 0) + (reasons.includes('NAME') ? 2 : 0) + (reasons.includes('VIN') ? 1 : 0);
}

export function searchFilter(q: string): Prisma.CrmLeadWhereInput {
  const term = q.trim();
  const or: Prisma.CrmLeadWhereInput[] = [
    { firstName: { contains: term, mode: 'insensitive' } },
    { lastName: { contains: term, mode: 'insensitive' } },
    { email: { contains: term, mode: 'insensitive' } },
    { interestedVin: { contains: term.toUpperCase() } },
    { campaign: { contains: term, mode: 'insensitive' } },
  ];
  const parts = term.split(/\s+/);
  if (parts.length >= 2) {
    or.push({
      firstName: { contains: parts[0]!, mode: 'insensitive' },
      lastName: { contains: parts.slice(1).join(' '), mode: 'insensitive' },
    });
  }
  const digits = term.replace(/\D/g, '');
  if (digits.length >= 4) or.push({ phoneNormalized: { contains: digits } });
  const number = /^#?(\d{1,9})$/.exec(term)?.[1];
  if (number) or.push({ number: Number(number) });
  return { OR: or };
}

export function flattenTags<T extends { tags: Array<{ tag: { id: string; name: string; color: string | null } }> }>(
  row: T,
): Omit<T, 'tags'> & { tags: Array<{ id: string; name: string; color: string | null }> } {
  return { ...row, tags: row.tags.map((entry) => entry.tag) };
}

function pick<T extends object>(source: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, (source as Record<string, unknown>)[key]]));
}
