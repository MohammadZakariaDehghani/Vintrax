import { Injectable } from '@nestjs/common';
import { toCsv, type CrmRangeQuery, type LeadListQuery } from '@vintrax/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit } from '../core/audit';
import { can, leadScope, type CrmContext } from '../core/context';
import { addDaysLocal, resolveRange, startOfLocalDay } from '../core/time';
import { LeadsService, searchFilter } from '../leads/leads.service';

const DAY = 86_400_000;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * The CRM overview, reports, global search and exports. Every figure is a
 * query over the CRM's own rows (and posted sales for revenue); a
 * salesperson's figures cover their own leads only.
 */
@Injectable()
export class CrmReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  private async context(ctx: CrmContext, query: CrmRangeQuery) {
    const settings = await this.prisma.crmSettings.findUniqueOrThrow({ where: { dealerId: ctx.dealerId } });
    const range = resolveRange(query.preset, settings.timezone, query);
    const scope = leadScope(ctx);
    /** Raw-SQL filter equal to `leadScope` (the lead alias is l). */
    const scopeSql = can(ctx, 'crm.all_leads')
      ? Prisma.sql`l."dealerId" = ${ctx.dealerId}::uuid AND l."mergedIntoId" IS NULL`
      : Prisma.sql`l."dealerId" = ${ctx.dealerId}::uuid AND l."mergedIntoId" IS NULL AND (l."assignedToId" = ${ctx.userId}::uuid OR l."assignedToId" IS NULL)`;
    return { settings, range, scope, scopeSql };
  }

  // --- Overview ----------------------------------------------------------------------

  async dashboard(ctx: CrmContext, query: CrmRangeQuery) {
    const { settings, range, scope, scopeSql } = await this.context(ctx, query);
    const now = new Date();
    const today = startOfLocalDay(now, settings.timezone);
    const tomorrow = addDaysLocal(today, 1, settings.timezone);
    const inRange = { gte: range.from, lt: range.to };
    const open = { kind: 'OPEN' as const };
    const mine = can(ctx, 'crm.all_leads') ? {} : { assignedToId: ctx.userId };
    const taskOpen = { in: ['OPEN', 'IN_PROGRESS'] as Array<'OPEN' | 'IN_PROGRESS'> };

    const [
      newLeads,
      previousNew,
      uncontacted,
      followUpToday,
      overdueFollowUps,
      temperatures,
      appointmentsToday,
      upcomingAppointments,
      openTasks,
      overdueTasks,
      activeOpportunities,
      won,
      lost,
      response,
    ] = await Promise.all([
      this.prisma.crmLead.count({ where: { ...scope, createdAt: inRange } }),
      this.prisma.crmLead.count({ where: { ...scope, createdAt: { gte: range.previousFrom, lt: range.from } } }),
      this.prisma.crmLead.count({ where: { ...scope, firstContactAt: null, status: open } }),
      this.prisma.crmLead.count({ where: { ...scope, nextFollowUpAt: { gte: today, lt: tomorrow }, status: { kind: { in: ['OPEN', 'NURTURE'] } } } }),
      this.prisma.crmLead.count({ where: { ...scope, nextFollowUpAt: { lt: now }, status: { kind: { in: ['OPEN', 'NURTURE'] } } } }),
      this.prisma.crmLead.groupBy({ by: ['temperature'], where: { ...scope, status: open }, _count: { _all: true } }),
      this.prisma.crmAppointment.count({ where: { dealerId: ctx.dealerId, ...this.mineAppointments(ctx), startsAt: { gte: today, lt: tomorrow }, status: { in: ['SCHEDULED', 'CONFIRMED'] } } }),
      this.prisma.crmAppointment.findMany({
        where: { dealerId: ctx.dealerId, ...this.mineAppointments(ctx), startsAt: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
        orderBy: { startsAt: 'asc' },
        take: 8,
        include: { lead: { select: { id: true, firstName: true, lastName: true } }, vehicle: { select: { title: true } } },
      }),
      this.prisma.crmTask.count({ where: { dealerId: ctx.dealerId, ...mine, status: taskOpen } }),
      this.prisma.crmTask.findMany({
        where: { dealerId: ctx.dealerId, ...mine, status: taskOpen, dueAt: { lt: now } },
        orderBy: { dueAt: 'asc' },
        take: 8,
        include: { lead: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.crmLead.count({ where: { ...scope, status: open } }),
      this.prisma.crmLead.count({ where: { ...scope, wonAt: inRange } }),
      this.prisma.crmLead.count({ where: { ...scope, lostAt: inRange } }),
      this.prisma.$queryRaw<Array<{ contacted: bigint; avg_minutes: number | null; within: bigint }>>`
        SELECT count(l."firstContactAt") AS contacted,
               avg(EXTRACT(EPOCH FROM (l."firstContactAt" - l."createdAt")) / 60)::float AS avg_minutes,
               count(*) FILTER (WHERE l."firstContactAt" - l."createdAt" <= make_interval(mins => ${settings.responseTargetMinutes}::int)) AS within
        FROM "CrmLead" l
        WHERE ${scopeSql} AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}`,
    ]);
    const [todaysTasks, hotLeads, overdueCount, wonOfNew] = await Promise.all([
      this.prisma.crmTask.findMany({
        where: { dealerId: ctx.dealerId, ...mine, status: taskOpen, dueAt: { gte: today, lt: tomorrow } },
        orderBy: { dueAt: 'asc' },
        take: 10,
        include: { lead: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      }),
      this.prisma.crmLead.findMany({
        where: { ...scope, temperature: 'HOT', status: open },
        orderBy: { score: 'desc' },
        take: 8,
        select: { id: true, number: true, firstName: true, lastName: true, score: true, phone: true, nextFollowUpAt: true, vehicle: { select: { title: true } } },
      }),
      this.prisma.crmTask.count({ where: { dealerId: ctx.dealerId, ...mine, status: taskOpen, dueAt: { lt: now } } }),
      this.prisma.crmLead.count({ where: { ...scope, createdAt: inRange, status: { kind: 'WON' } } }),
    ]);
    const r = response[0];
    const temps = Object.fromEntries(temperatures.map((row) => [row.temperature, row._count._all]));
    return {
      range: { from: range.from, to: range.to, preset: query.preset },
      responseTargetMinutes: settings.responseTargetMinutes,
      counts: {
        newLeads,
        previousNewLeads: previousNew,
        uncontacted,
        followUpToday,
        overdueFollowUps,
        hot: temps.HOT ?? 0,
        warm: temps.WARM ?? 0,
        cold: temps.COLD ?? 0,
        appointmentsToday,
        openTasks,
        overdueTasks: overdueCount,
        activeOpportunities,
        won,
        lost,
        conversionRate: pct(wonOfNew, newLeads),
        averageResponseMinutes: r?.avg_minutes === null || r?.avg_minutes === undefined ? null : Math.round(r.avg_minutes),
        contactedWithinTarget: pct(Number(r?.within ?? 0), newLeads),
      },
      todaysTasks,
      overdueTasks,
      upcomingAppointments,
      hotLeads,
      sources: await this.bySource(ctx, scopeSql, range),
      email: await this.emailPerformance(ctx, range),
      followUp: await this.followUp(ctx, range),
    };
  }

  private mineAppointments(ctx: CrmContext): Prisma.CrmAppointmentWhereInput {
    return can(ctx, 'crm.all_leads') ? {} : { salespersonId: ctx.userId };
  }

  private async bySource(ctx: CrmContext, scopeSql: Prisma.Sql, range: { from: Date; to: Date }) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string | null; label: string | null; monthly: number | null; leads: bigint; contacted: bigint; won: bigint; revenue: Prisma.Decimal | null }>
    >`
      SELECT s.id, s.label, s."monthlyCostCents" AS monthly,
             count(l.id) AS leads,
             count(l."firstContactAt") AS contacted,
             count(l."wonAt") AS won,
             (SELECT sum(v."totalAmount") FROM "VehicleSale" v
               WHERE v."dealerId" = ${ctx.dealerId}::uuid AND v.status = 'POSTED'
                 AND v."saleDate" >= ${range.from}::date AND v."saleDate" < ${range.to}::date
                 AND v."customerId" IN (
                   SELECT l2."customerId" FROM "CrmLead" l2
                   WHERE l2."dealerId" = ${ctx.dealerId}::uuid AND l2."customerId" IS NOT NULL
                     AND l2."sourceId" IS NOT DISTINCT FROM s.id)) AS revenue
      FROM "CrmLead" l LEFT JOIN "CrmLeadSource" s ON s.id = l."sourceId"
      WHERE ${scopeSql} AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}
      GROUP BY s.id, s.label, s."monthlyCostCents"
      ORDER BY leads DESC`;
    const months = Math.max(1, (range.to.getTime() - range.from.getTime()) / (30 * DAY));
    return rows.map((row) => {
      const leads = Number(row.leads);
      const wonCount = Number(row.won);
      const cost = row.monthly ? Math.round(row.monthly * months) : null;
      return {
        sourceId: row.id,
        label: row.label ?? 'No source',
        leads,
        contacted: Number(row.contacted),
        won: wonCount,
        conversionRate: pct(wonCount, leads),
        revenue: row.revenue ? Number(row.revenue) : 0,
        costCents: cost,
        costPerLeadCents: cost !== null && leads > 0 ? Math.round(cost / leads) : null,
        costPerAcquisitionCents: cost !== null && wonCount > 0 ? Math.round(cost / wonCount) : null,
      };
    });
  }

  async emailPerformance(ctx: CrmContext, range: { from: Date; to: Date }) {
    const where = {
      dealerId: ctx.dealerId,
      createdAt: { gte: range.from, lt: range.to },
      ...(can(ctx, 'crm.all_leads') ? {} : { lead: leadScope(ctx) }),
    };
    const [total, sent, delivered, opened, clicked, replied, bounced, unsubscribed, failed, suppressed, converted] = await Promise.all([
      this.prisma.crmEmail.count({ where }),
      this.prisma.crmEmail.count({ where: { ...where, sentAt: { not: null } } }),
      this.prisma.crmEmail.count({ where: { ...where, deliveredAt: { not: null } } }),
      this.prisma.crmEmail.count({ where: { ...where, openedAt: { not: null } } }),
      this.prisma.crmEmail.count({ where: { ...where, clickedAt: { not: null } } }),
      this.prisma.crmEmail.count({ where: { ...where, repliedAt: { not: null } } }),
      this.prisma.crmEmail.count({ where: { ...where, status: 'BOUNCED' } }),
      this.prisma.crmEmail.count({ where: { ...where, unsubscribedAt: { not: null } } }),
      this.prisma.crmEmail.count({ where: { ...where, status: 'FAILED' } }),
      this.prisma.crmEmail.count({ where: { ...where, status: 'SUPPRESSED' } }),
      this.prisma.crmEmail.count({ where: { ...where, sentAt: { not: null }, lead: { wonAt: { not: null } } } }),
    ]);
    return {
      total,
      sent,
      delivered,
      opened,
      clicked,
      replied,
      bounced,
      unsubscribed,
      failed,
      suppressed,
      deliveryRate: pct(sent - bounced, sent),
      openRate: pct(opened, sent),
      clickRate: pct(clicked, sent),
      replyRate: pct(replied, sent),
      bounceRate: pct(bounced, sent),
      unsubscribeRate: pct(unsubscribed, sent),
      conversionRate: pct(converted, sent),
      /** Opens come from an image pixel: blocked or pre-loaded images skew them. */
      opensApproximate: true,
      /** "Delivered" needs a provider webhook; SMTP alone cannot report it. */
      deliveryReported: delivered > 0,
    };
  }

  private async followUp(ctx: CrmContext, range: { from: Date; to: Date }) {
    const mine = can(ctx, 'crm.all_leads') ? {} : { assignedToId: ctx.userId };
    const inRange = { gte: range.from, lt: range.to };
    const [completed, completedOnTime, missed, booked, apptCompleted, noShows, contacted] = await Promise.all([
      this.prisma.crmTask.count({ where: { dealerId: ctx.dealerId, ...mine, completedAt: inRange } }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM "CrmTask"
        WHERE "dealerId" = ${ctx.dealerId}::uuid AND "completedAt" >= ${range.from} AND "completedAt" < ${range.to}
          AND ("dueAt" IS NULL OR "completedAt" <= "dueAt")
          ${can(ctx, 'crm.all_leads') ? Prisma.empty : Prisma.sql`AND "assignedToId" = ${ctx.userId}::uuid`}`,
      this.prisma.crmTask.count({
        where: { dealerId: ctx.dealerId, ...mine, dueAt: { gte: range.from, lt: new Date(Math.min(Date.now(), range.to.getTime())) }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.prisma.crmAppointment.count({ where: { dealerId: ctx.dealerId, ...this.mineAppointments(ctx), createdAt: inRange } }),
      this.prisma.crmAppointment.count({ where: { dealerId: ctx.dealerId, ...this.mineAppointments(ctx), startsAt: inRange, status: 'COMPLETED' } }),
      this.prisma.crmAppointment.count({ where: { dealerId: ctx.dealerId, ...this.mineAppointments(ctx), startsAt: inRange, status: 'NO_SHOW' } }),
      this.prisma.crmLead.count({ where: { ...leadScope(ctx), firstContactAt: inRange } }),
    ]);
    return {
      tasksCompleted: completed,
      tasksCompletedOnTime: Number(completedOnTime[0]?.count ?? 0),
      missedFollowUps: missed,
      contactedLeads: contacted,
      appointmentsBooked: booked,
      appointmentsCompleted: apptCompleted,
      noShows,
    };
  }

  // --- Reports -----------------------------------------------------------------------

  async reports(ctx: CrmContext, query: CrmRangeQuery) {
    const { range, scope, scopeSql } = await this.context(ctx, query);
    const inRange = { gte: range.from, lt: range.to };
    const [byStatus, bySalesperson, byVehicle, lostReasons, funnel, responseBuckets, campaigns, automations, reengaged] = await Promise.all([
      this.prisma.crmLead.groupBy({ by: ['statusId'], where: scope, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ id: string | null; first: string | null; last: string | null; leads: bigint; contacted: bigint; won: bigint; avg_minutes: number | null }>>`
        SELECT u.id, u."firstName" AS first, u."lastName" AS last, count(l.id) AS leads, count(l."firstContactAt") AS contacted,
               count(l."wonAt") AS won, avg(EXTRACT(EPOCH FROM (l."firstContactAt" - l."createdAt")) / 60)::float AS avg_minutes
        FROM "CrmLead" l LEFT JOIN "User" u ON u.id = l."assignedToId"
        WHERE ${scopeSql} AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}
        GROUP BY u.id, u."firstName", u."lastName" ORDER BY leads DESC`,
      this.prisma.$queryRaw<Array<{ id: string; title: string; leads: bigint; won: bigint }>>`
        SELECT v.id, v.title, count(l.id) AS leads, count(l."wonAt") AS won
        FROM "CrmLead" l JOIN "Vehicle" v ON v.id = l."vehicleId"
        WHERE ${scopeSql} AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}
        GROUP BY v.id, v.title ORDER BY leads DESC LIMIT 20`,
      this.prisma.crmLead.groupBy({ by: ['lostReason'], where: { ...scope, lostAt: inRange }, _count: { _all: true }, orderBy: { _count: { lostReason: 'desc' } }, take: 15 }),
      this.prisma.$queryRaw<Array<{ created: bigint; contacted: bigint; appointment: bigint; test_drive: bigint; won: bigint }>>`
        SELECT count(*) AS created,
               count(l."firstContactAt") AS contacted,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CrmAppointment" a WHERE a."leadId" = l.id)) AS appointment,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CrmActivity" t WHERE t."leadId" = l.id AND t.type = 'TEST_DRIVE')) AS test_drive,
               count(l."wonAt") AS won
        FROM "CrmLead" l WHERE ${scopeSql} AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}`,
      this.prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
        SELECT CASE
                 WHEN l."firstContactAt" IS NULL THEN 'not_contacted'
                 WHEN l."firstContactAt" - l."createdAt" <= interval '5 minutes' THEN 'under_5m'
                 WHEN l."firstContactAt" - l."createdAt" <= interval '1 hour' THEN 'under_1h'
                 WHEN l."firstContactAt" - l."createdAt" <= interval '1 day' THEN 'under_1d'
                 ELSE 'over_1d' END AS bucket,
               count(*) AS count
        FROM "CrmLead" l WHERE ${scopeSql} AND l."createdAt" >= ${range.from} AND l."createdAt" < ${range.to}
        GROUP BY bucket`,
      this.prisma.crmCampaign.findMany({
        where: { dealerId: ctx.dealerId, OR: [{ startedAt: inRange }, { createdAt: inRange }] },
        select: { id: true, name: true, type: true, status: true, recipientCount: true, skippedCount: true, costCents: true },
      }),
      this.prisma.$queryRaw<Array<{ id: string; name: string; enrolled: bigint; completed: bigint; stopped: bigint; failed: bigint; replied: bigint; won: bigint }>>`
        SELECT a.id, a.name, count(e.id) AS enrolled,
               count(*) FILTER (WHERE e.status = 'COMPLETED') AS completed,
               count(*) FILTER (WHERE e.status = 'STOPPED') AS stopped,
               count(*) FILTER (WHERE e.status = 'FAILED') AS failed,
               count(*) FILTER (WHERE e."stopReason" = 'REPLIED') AS replied,
               count(*) FILTER (WHERE e."stopReason" = 'WON') AS won
        FROM "CrmAutomation" a LEFT JOIN "CrmAutomationEnrollment" e ON e."automationId" = a.id AND e."startedAt" >= ${range.from} AND e."startedAt" < ${range.to}
        WHERE a.scope = 'DEALER' AND a."dealerId" = ${ctx.dealerId}::uuid
        GROUP BY a.id, a.name ORDER BY enrolled DESC`,
      // Re-engagement: leads quiet for 30+ days that replied in the range.
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(DISTINCT l.id) AS count FROM "CrmLead" l
        WHERE ${scopeSql} AND l."lastRepliedAt" >= ${range.from} AND l."lastRepliedAt" < ${range.to}
          AND l."createdAt" < ${new Date(range.from.getTime() - 30 * DAY)}`,
    ]);
    const statuses = await this.prisma.crmLeadStatus.findMany({ where: { dealerId: ctx.dealerId }, orderBy: { position: 'asc' } });
    const campaignStats = campaigns.length
      ? await this.prisma.crmEmail.groupBy({
          by: ['campaignId'],
          where: { campaignId: { in: campaigns.map((c) => c.id) } },
          _count: { sentAt: true, openedAt: true, clickedAt: true, unsubscribedAt: true },
        })
      : [];
    const f = funnel[0];
    return {
      range: { from: range.from, to: range.to, preset: query.preset },
      byStatus: statuses.map((status) => ({
        label: status.label,
        kind: status.kind,
        count: byStatus.find((row) => row.statusId === status.id)?._count._all ?? 0,
      })),
      bySource: await this.bySource(ctx, scopeSql, range),
      bySalesperson: bySalesperson.map((row) => ({
        userId: row.id,
        name: row.id ? `${row.first} ${row.last}`.trim() : 'Unassigned',
        leads: Number(row.leads),
        contacted: Number(row.contacted),
        won: Number(row.won),
        conversionRate: pct(Number(row.won), Number(row.leads)),
        averageResponseMinutes: row.avg_minutes === null ? null : Math.round(row.avg_minutes),
      })),
      byVehicle: byVehicle.map((row) => ({ vehicleId: row.id, title: row.title, leads: Number(row.leads), won: Number(row.won) })),
      funnel: {
        created: Number(f?.created ?? 0),
        contacted: Number(f?.contacted ?? 0),
        appointment: Number(f?.appointment ?? 0),
        testDrive: Number(f?.test_drive ?? 0),
        won: Number(f?.won ?? 0),
        appointmentConversion: pct(Number(f?.won ?? 0), Number(f?.appointment ?? 0)),
        testDriveConversion: pct(Number(f?.won ?? 0), Number(f?.test_drive ?? 0)),
        salesConversion: pct(Number(f?.won ?? 0), Number(f?.created ?? 0)),
      },
      lostReasons: lostReasons.map((row) => ({ reason: row.lostReason ?? 'Not given', count: row._count._all })),
      responseTime: Object.fromEntries(responseBuckets.map((row) => [row.bucket, Number(row.count)])),
      followUp: await this.followUp(ctx, range),
      email: await this.emailPerformance(ctx, range),
      campaigns: campaigns.map((campaign) => {
        const stats = campaignStats.find((row) => row.campaignId === campaign.id)?._count;
        return {
          ...campaign,
          sent: stats?.sentAt ?? 0,
          opened: stats?.openedAt ?? 0,
          clicked: stats?.clickedAt ?? 0,
          unsubscribed: stats?.unsubscribedAt ?? 0,
        };
      }),
      automations: automations.map((row) => ({
        automationId: row.id,
        name: row.name,
        enrolled: Number(row.enrolled),
        completed: Number(row.completed),
        stopped: Number(row.stopped),
        failed: Number(row.failed),
        stoppedByReply: Number(row.replied),
        stoppedByWin: Number(row.won),
      })),
      reengaged: Number(reengaged[0]?.count ?? 0),
    };
  }

  // --- Search and export -----------------------------------------------------------------

  /** One box for everything: leads (name, email, phone, VIN, number), customers, tasks, campaigns, vehicles. */
  async search(ctx: CrmContext, q: string) {
    const term = q.trim();
    if (term.length < 2) return { leads: [], customers: [], tasks: [], campaigns: [], vehicles: [] };
    const [leads, customers, tasks, campaigns, vehicles] = await Promise.all([
      this.prisma.crmLead.findMany({
        where: { AND: [leadScope(ctx), searchFilter(term)] },
        take: 10,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, number: true, firstName: true, lastName: true, email: true, phone: true, status: { select: { label: true } } },
      }),
      can(ctx, 'crm.all_leads')
        ? this.prisma.customer.findMany({
            where: {
              dealerId: ctx.dealerId,
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
              ],
            },
            take: 8,
            select: { id: true, name: true, email: true, phone: true, crmLeads: { select: { id: true }, take: 1 } },
          })
        : Promise.resolve([]),
      this.prisma.crmTask.findMany({
        where: {
          dealerId: ctx.dealerId,
          title: { contains: term, mode: 'insensitive' },
          ...(can(ctx, 'crm.all_leads') ? {} : { assignedToId: ctx.userId }),
        },
        take: 8,
        select: { id: true, title: true, status: true, dueAt: true, leadId: true },
      }),
      can(ctx, 'crm.marketing')
        ? this.prisma.crmCampaign.findMany({
            where: { dealerId: ctx.dealerId, name: { contains: term, mode: 'insensitive' } },
            take: 5,
            select: { id: true, name: true, status: true },
          })
        : Promise.resolve([]),
      this.prisma.vehicle.findMany({
        where: {
          sellerId: ctx.ownerUserId,
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { vin: { contains: term.toUpperCase() } },
            { stockNumber: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: { id: true, title: true, vin: true, stockNumber: true, _count: { select: { crmLeads: true } } },
      }),
    ]);
    return { leads, customers, tasks, campaigns, vehicles };
  }

  /** The filtered lead list as CSV. Exports are audited. */
  async exportLeads(ctx: CrmContext, query: LeadListQuery): Promise<string> {
    const where = await this.leads.listWhere(ctx, query);
    const rows = await this.prisma.crmLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10_000,
      include: {
        status: { select: { label: true } },
        source: { select: { label: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
        vehicle: { select: { title: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    });
    await crmAudit(this.prisma, ctx, { action: 'lead.exported', entityType: 'CrmLead', after: { count: rows.length, view: query.view } });
    return toCsv([
      ['Number', 'First name', 'Last name', 'Email', 'Phone', 'City', 'Province', 'Status', 'Source', 'Score', 'Temperature', 'Assigned to', 'Vehicle', 'Tags', 'Created', 'Last contact', 'Next follow-up'],
      ...rows.map((row) => [
        String(row.number),
        row.firstName,
        row.lastName ?? '',
        row.email ?? '',
        row.phone ?? '',
        row.city ?? '',
        row.province ?? '',
        row.status.label,
        row.source?.label ?? '',
        String(row.score),
        row.temperature,
        row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : '',
        row.vehicle?.title ?? '',
        row.tags.map((entry) => entry.tag.name).join('; '),
        row.createdAt.toISOString(),
        row.lastContactAt?.toISOString() ?? '',
        row.nextFollowUpAt?.toISOString() ?? '',
      ]),
    ]);
  }

  async auditLog(ctx: CrmContext, page: number, pageSize: number) {
    const where = { scope: 'DEALER' as const, dealerId: ctx.dealerId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.crmAuditLog.count({ where }),
      this.prisma.crmAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** The dealership's customers (accounting's Customer records) with their CRM lead, if any. */
  async customers(ctx: CrmContext, q: string | undefined, page: number, pageSize: number) {
    const where: Prisma.CustomerWhereInput = {
      dealerId: ctx.dealerId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
            ],
          }
        : {}),
      ...(can(ctx, 'crm.all_leads') ? {} : { crmLeads: { some: { assignedToId: ctx.userId } } }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          province: true,
          createdAt: true,
          crmLeads: {
            where: { mergedIntoId: null },
            select: { id: true, number: true, lastActivityAt: true, status: { select: { label: true } } },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          _count: { select: { sales: { where: { status: 'POSTED' } }, deposits: true } },
        },
      }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
}
