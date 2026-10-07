import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CRM_NOTIFICATION_EVENTS,
  DEALER_STAFF_ROLE_LABELS,
  SCORE_SIGNALS,
  type AssignmentRuleInput,
  type CrmSettingsInput,
  type LeadSourceInput,
  type LeadStatusConfigInput,
  type NotificationPrefsInput,
  type ScoringInput,
  type TagInput,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ScoringService } from '../leads/scoring.service';
import { crmAudit } from './audit';
import type { CrmContext } from './context';

/**
 * CRM → Settings: statuses, sources, tags, scoring, assignment, teams,
 * business hours, consent and sender identity, and each person's
 * notification preferences.
 */
@Injectable()
export class CrmConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
  ) {}

  async overview(ctx: CrmContext) {
    const [settings, statuses, sources, tags, staff] = await Promise.all([
      this.prisma.crmSettings.findUniqueOrThrow({ where: { dealerId: ctx.dealerId } }),
      this.statuses(ctx),
      this.sources(ctx),
      this.tags(ctx),
      this.staff(ctx),
    ]);
    const dealer = await this.prisma.dealer.findUniqueOrThrow({
      where: { id: ctx.dealerId },
      select: { id: true, name: true, phone: true, city: true, province: true },
    });
    return {
      dealer,
      settings,
      statuses,
      sources,
      tags,
      staff,
      me: { userId: ctx.userId, role: ctx.role, permissions: [...ctx.permissions] },
    };
  }

  /** The owner and staff, for assignee pickers. */
  async staff(ctx: CrmContext) {
    const dealer = await this.prisma.dealer.findUniqueOrThrow({
      where: { id: ctx.dealerId },
      select: { owner: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    const members = await this.prisma.dealerMember.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    const teams = await this.prisma.crmTeamMember.findMany({ where: { dealerId: ctx.dealerId } });
    const teamOf = new Map(teams.map((row) => [row.userId, row.team]));
    return [
      { ...dealer.owner, role: 'OWNER' as const, roleLabel: DEALER_STAFF_ROLE_LABELS.OWNER, team: teamOf.get(dealer.owner.id) ?? null },
      ...members
        .filter((member) => member.user.id !== dealer.owner.id)
        .map((member) => ({
          ...member.user,
          role: member.role,
          roleLabel: DEALER_STAFF_ROLE_LABELS[member.role],
          team: teamOf.get(member.user.id) ?? null,
        })),
    ];
  }

  async updateSettings(ctx: CrmContext, input: CrmSettingsInput) {
    const before = await this.prisma.crmSettings.findUniqueOrThrow({ where: { dealerId: ctx.dealerId } });
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.crmSettings.update({ where: { dealerId: ctx.dealerId }, data: input });
      await crmAudit(tx, ctx, { action: 'settings.updated', entityType: 'CrmSettings', entityId: ctx.dealerId, before, after: input });
      return after;
    });
  }

  // --- Statuses ------------------------------------------------------------------

  statuses(ctx: CrmContext) {
    return this.prisma.crmLeadStatus.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: { position: 'asc' },
      include: { _count: { select: { leads: { where: { mergedIntoId: null } } } } },
    });
  }

  async createStatus(ctx: CrmContext, input: LeadStatusConfigInput) {
    const key = input.key ?? keyOf(input.label);
    const last = await this.prisma.crmLeadStatus.aggregate({ where: { dealerId: ctx.dealerId }, _max: { position: true } });
    try {
      return await this.prisma.crmLeadStatus.create({
        data: {
          dealerId: ctx.dealerId,
          key,
          label: input.label,
          kind: input.kind,
          inPipeline: input.inPipeline,
          isActive: input.isActive,
          position: (last._max.position ?? -1) + 1,
        },
      });
    } catch {
      throw new ConflictException('A status with that name already exists');
    }
  }

  async updateStatus(ctx: CrmContext, id: string, input: LeadStatusConfigInput) {
    const status = await this.prisma.crmLeadStatus.findFirst({ where: { id, dealerId: ctx.dealerId } });
    if (!status) throw new NotFoundException('Status not found');
    // The engine relies on these keys; their meaning cannot change.
    if (['NEW', 'WON', 'LOST'].includes(status.key) && input.kind !== status.kind) {
      throw new BadRequestException(`The ${status.label} status keeps its kind`);
    }
    return this.prisma.crmLeadStatus.update({
      where: { id },
      data: { label: input.label, kind: input.kind, inPipeline: input.inPipeline, isActive: input.isActive },
    });
  }

  async reorderStatuses(ctx: CrmContext, ids: string[]) {
    const statuses = await this.prisma.crmLeadStatus.findMany({ where: { dealerId: ctx.dealerId }, select: { id: true } });
    const known = new Set(statuses.map((row) => row.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new BadRequestException('List every status exactly once');
    }
    await this.prisma.$transaction(
      ids.map((id, position) => this.prisma.crmLeadStatus.update({ where: { id }, data: { position } })),
    );
    return this.statuses(ctx);
  }

  async deleteStatus(ctx: CrmContext, id: string) {
    const status = await this.prisma.crmLeadStatus.findFirst({
      where: { id, dealerId: ctx.dealerId },
      include: { _count: { select: { leads: true } } },
    });
    if (!status) throw new NotFoundException('Status not found');
    if (['NEW', 'CONTACTED', 'WON', 'LOST', 'NURTURE'].includes(status.key)) {
      throw new BadRequestException(`${status.label} is used by automations; switch it off instead`);
    }
    if (status._count.leads > 0) {
      throw new ConflictException(`${status._count.leads} lead(s) have this status; move them first or switch it off`);
    }
    await this.prisma.crmLeadStatus.delete({ where: { id } });
  }

  // --- Sources -------------------------------------------------------------------

  sources(ctx: CrmContext) {
    return this.prisma.crmLeadSource.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: { label: 'asc' },
      include: { _count: { select: { leads: { where: { mergedIntoId: null } } } } },
    });
  }

  async createSource(ctx: CrmContext, input: LeadSourceInput) {
    try {
      return await this.prisma.crmLeadSource.create({
        data: {
          dealerId: ctx.dealerId,
          key: input.key ?? keyOf(input.label),
          label: input.label,
          monthlyCostCents: input.monthlyCost,
          isActive: input.isActive,
        },
      });
    } catch {
      throw new ConflictException('A source with that name already exists');
    }
  }

  async updateSource(ctx: CrmContext, id: string, input: LeadSourceInput) {
    const source = await this.prisma.crmLeadSource.findFirst({ where: { id, dealerId: ctx.dealerId } });
    if (!source) throw new NotFoundException('Source not found');
    return this.prisma.crmLeadSource.update({
      where: { id },
      data: { label: input.label, monthlyCostCents: input.monthlyCost, isActive: input.isActive },
    });
  }

  // --- Tags ------------------------------------------------------------------------

  tags(ctx: CrmContext) {
    return this.prisma.crmTag.findMany({
      where: { scope: 'DEALER', dealerId: ctx.dealerId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { leads: true } } },
    });
  }

  async createTag(ctx: CrmContext, input: TagInput) {
    const existing = await this.prisma.crmTag.findFirst({
      where: { scope: 'DEALER', dealerId: ctx.dealerId, name: { equals: input.name, mode: 'insensitive' } },
    });
    if (existing) throw new ConflictException('That tag already exists');
    return this.prisma.crmTag.create({ data: { scope: 'DEALER', dealerId: ctx.dealerId, ...input } });
  }

  async updateTag(ctx: CrmContext, id: string, input: TagInput) {
    const tag = await this.prisma.crmTag.findFirst({ where: { id, scope: 'DEALER', dealerId: ctx.dealerId } });
    if (!tag) throw new NotFoundException('Tag not found');
    return this.prisma.crmTag.update({ where: { id }, data: input });
  }

  async deleteTag(ctx: CrmContext, id: string) {
    const tag = await this.prisma.crmTag.findFirst({ where: { id, scope: 'DEALER', dealerId: ctx.dealerId } });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.prisma.crmTag.delete({ where: { id } });
  }

  // --- Scoring ---------------------------------------------------------------------

  async scoringRules(ctx: CrmContext) {
    const [rules, settings] = await Promise.all([
      this.prisma.crmScoringRule.findMany({ where: { dealerId: ctx.dealerId } }),
      this.prisma.crmSettings.findUniqueOrThrow({ where: { dealerId: ctx.dealerId } }),
    ]);
    const bySignal = new Map(rules.map((rule) => [rule.signal, rule]));
    return {
      rules: SCORE_SIGNALS.map((signal) => ({
        signal,
        points: bySignal.get(signal)?.points ?? 0,
        isActive: bySignal.get(signal)?.isActive ?? false,
      })),
      hotThreshold: settings.hotThreshold,
      warmThreshold: settings.warmThreshold,
    };
  }

  async updateScoring(ctx: CrmContext, input: ScoringInput) {
    const before = await this.scoringRules(ctx);
    await this.prisma.$transaction(async (tx) => {
      for (const rule of input.rules) {
        await tx.crmScoringRule.upsert({
          where: { dealerId_signal: { dealerId: ctx.dealerId, signal: rule.signal } },
          update: { points: rule.points, isActive: rule.isActive },
          create: { dealerId: ctx.dealerId, ...rule },
        });
      }
      await tx.crmSettings.update({
        where: { dealerId: ctx.dealerId },
        data: { hotThreshold: input.hotThreshold, warmThreshold: input.warmThreshold },
      });
      await crmAudit(tx, ctx, { action: 'scoring.updated', entityType: 'CrmScoringRule', before, after: input });
    });
    if (before.hotThreshold !== input.hotThreshold || before.warmThreshold !== input.warmThreshold) {
      await this.scoring.retemper(ctx.dealerId, input.hotThreshold, input.warmThreshold);
    }
    return this.scoringRules(ctx);
  }

  // --- Assignment ---------------------------------------------------------------------

  async assignment(ctx: CrmContext) {
    const [rules, teams, settings] = await Promise.all([
      this.prisma.crmAssignmentRule.findMany({ where: { dealerId: ctx.dealerId }, orderBy: { position: 'asc' } }),
      this.prisma.crmTeamMember.findMany({ where: { dealerId: ctx.dealerId } }),
      this.prisma.crmSettings.findUniqueOrThrow({ where: { dealerId: ctx.dealerId }, select: { assignmentMode: true } }),
    ]);
    return { mode: settings.assignmentMode, rules, teams };
  }

  async createRule(ctx: CrmContext, input: AssignmentRuleInput) {
    const last = await this.prisma.crmAssignmentRule.aggregate({ where: { dealerId: ctx.dealerId }, _max: { position: true } });
    const rule = await this.prisma.crmAssignmentRule.create({
      data: { dealerId: ctx.dealerId, position: (last._max.position ?? -1) + 1, ...input },
    });
    await crmAudit(this.prisma, ctx, { action: 'assignment_rule.created', entityType: 'CrmAssignmentRule', entityId: rule.id, after: input });
    return rule;
  }

  async updateRule(ctx: CrmContext, id: string, input: AssignmentRuleInput) {
    const rule = await this.prisma.crmAssignmentRule.findFirst({ where: { id, dealerId: ctx.dealerId } });
    if (!rule) throw new NotFoundException('Rule not found');
    return this.prisma.crmAssignmentRule.update({ where: { id }, data: input });
  }

  async deleteRule(ctx: CrmContext, id: string) {
    const rule = await this.prisma.crmAssignmentRule.findFirst({ where: { id, dealerId: ctx.dealerId } });
    if (!rule) throw new NotFoundException('Rule not found');
    await this.prisma.crmAssignmentRule.delete({ where: { id } });
  }

  async setTeam(ctx: CrmContext, userId: string, team: string | null) {
    const staff = await this.staff(ctx);
    if (!staff.some((member) => member.id === userId)) throw new BadRequestException('Not on this dealership’s staff');
    if (!team) {
      await this.prisma.crmTeamMember.deleteMany({ where: { dealerId: ctx.dealerId, userId } });
      return null;
    }
    return this.prisma.crmTeamMember.upsert({
      where: { dealerId_userId: { dealerId: ctx.dealerId, userId } },
      update: { team },
      create: { dealerId: ctx.dealerId, userId, team },
    });
  }

  // --- Notification preferences ---------------------------------------------------------

  async notificationPrefs(userId: string) {
    const rows = await this.prisma.crmNotificationPreference.findMany({ where: { userId } });
    const byEvent = new Map(rows.map((row) => [row.event, row]));
    return CRM_NOTIFICATION_EVENTS.map((event) => ({
      event,
      inApp: byEvent.get(event)?.inApp ?? true,
      email: byEvent.get(event)?.email ?? false,
    }));
  }

  async setNotificationPrefs(userId: string, input: NotificationPrefsInput) {
    await this.prisma.$transaction(
      input.preferences.map((preference) =>
        this.prisma.crmNotificationPreference.upsert({
          where: { userId_event: { userId, event: preference.event } },
          update: { inApp: preference.inApp, email: preference.email },
          create: { userId, ...preference },
        }),
      ),
    );
    return this.notificationPrefs(userId);
  }
}

function keyOf(label: string): string {
  return (
    label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'CUSTOM'
  );
}
