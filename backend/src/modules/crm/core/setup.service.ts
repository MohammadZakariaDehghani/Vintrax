import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LEAD_SOURCES,
  DEFAULT_LEAD_STATUSES,
  DEFAULT_LEAD_TAGS,
  DEFAULT_SCORING,
  DEFAULT_TICKET_CATEGORIES,
  SCORE_SIGNALS,
} from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  DEFAULT_DEALER_AUTOMATIONS,
  DEFAULT_SUPPORT_AUTOMATIONS,
  type DefaultAutomation,
} from '../automation/default-automations';
import {
  DEFAULT_DEALER_TEMPLATES,
  DEFAULT_SUPPORT_TEMPLATES,
  type DefaultTemplate,
} from '../email/default-templates';
import { htmlToText, sanitizeHtml } from '../email/sanitizer';

/**
 * Gives a dealership (and the support desk) its starting CRM: settings,
 * statuses, sources, scoring, tags, templates and automations. Idempotent —
 * every insert skips what already exists, so a dealer's edits survive and a
 * new default added in a release reaches existing dealers.
 */
@Injectable()
export class CrmSetupService {
  private readonly ready = new Set<string>();
  private supportReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async ensure(dealerId: string): Promise<void> {
    if (this.ready.has(dealerId)) return;
    const db = this.prisma;
    await db.crmSettings.upsert({ where: { dealerId }, update: {}, create: { dealerId } });
    await db.crmLeadStatus.createMany({
      data: DEFAULT_LEAD_STATUSES.map((status, position) => ({
        dealerId,
        key: status.key,
        label: status.label,
        kind: status.kind,
        position,
        // Lost, Unresponsive and Nurture are outcomes, kept off the board.
        inPipeline: status.kind === 'OPEN' || status.kind === 'WON',
      })),
      skipDuplicates: true,
    });
    await db.crmLeadSource.createMany({
      data: DEFAULT_LEAD_SOURCES.map((source) => ({ dealerId, key: source.key, label: source.label })),
      skipDuplicates: true,
    });
    await db.crmScoringRule.createMany({
      data: SCORE_SIGNALS.map((signal) => ({ dealerId, signal, points: DEFAULT_SCORING[signal] })),
      skipDuplicates: true,
    });
    await db.crmTag.createMany({
      data: DEFAULT_LEAD_TAGS.map((name) => ({ scope: 'DEALER' as const, dealerId, name })),
      skipDuplicates: true,
    });
    await db.crmEmailTemplate.createMany({
      data: DEFAULT_DEALER_TEMPLATES.map((template) => templateRow(template, 'DEALER', dealerId)),
      skipDuplicates: true,
    });
    await db.crmAutomation.createMany({
      data: DEFAULT_DEALER_AUTOMATIONS.map((automation) =>
        automationRow(automation, 'DEALER', dealerId),
      ),
      skipDuplicates: true,
    });
    this.ready.add(dealerId);
  }

  async ensureSupport(): Promise<void> {
    if (this.supportReady) return;
    const db = this.prisma;
    await db.supportSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await db.supportCategory.createMany({
      data: DEFAULT_TICKET_CATEGORIES.map((category, position) => ({
        key: category.key,
        label: category.label,
        position,
      })),
      skipDuplicates: true,
    });
    // Platform rows have no dealer, and NULLs never collide in a unique
    // index, so these are matched by key here (the migration adds a partial
    // unique index as the backstop).
    const templates = await db.crmEmailTemplate.findMany({
      where: { scope: 'SUPPORT', dealerId: null },
      select: { key: true },
    });
    const haveTemplates = new Set(templates.map((row) => row.key));
    const missingTemplates = DEFAULT_SUPPORT_TEMPLATES.filter((t) => !haveTemplates.has(t.key));
    if (missingTemplates.length) {
      await db.crmEmailTemplate.createMany({
        data: missingTemplates.map((template) => templateRow(template, 'SUPPORT', null)),
        skipDuplicates: true,
      });
    }
    const automations = await db.crmAutomation.findMany({
      where: { scope: 'SUPPORT', dealerId: null },
      select: { key: true },
    });
    const haveAutomations = new Set(automations.map((row) => row.key));
    const missingAutomations = DEFAULT_SUPPORT_AUTOMATIONS.filter((a) => !haveAutomations.has(a.key));
    if (missingAutomations.length) {
      await db.crmAutomation.createMany({
        data: missingAutomations.map((automation) => automationRow(automation, 'SUPPORT', null)),
        skipDuplicates: true,
      });
    }
    this.supportReady = true;
  }

  /** Tests reset the database between cases; the cache must forget too. */
  forget(): void {
    this.ready.clear();
    this.supportReady = false;
  }
}

function templateRow(
  template: DefaultTemplate,
  scope: 'DEALER' | 'SUPPORT',
  dealerId: string | null,
): Prisma.CrmEmailTemplateCreateManyInput {
  const html = sanitizeHtml(template.bodyHtml);
  return {
    scope,
    dealerId,
    key: template.key,
    name: template.name,
    category: template.category,
    purpose: template.purpose,
    subject: template.subject,
    bodyHtml: html,
    bodyText: htmlToText(html),
  };
}

function automationRow(
  automation: DefaultAutomation,
  scope: 'DEALER' | 'SUPPORT',
  dealerId: string | null,
): Prisma.CrmAutomationCreateManyInput {
  return {
    scope,
    dealerId,
    key: automation.key,
    name: automation.name,
    description: automation.description,
    trigger: automation.trigger,
    triggerConfig: (automation.triggerConfig ?? {}) as Prisma.InputJsonValue,
    steps: automation.steps as unknown as Prisma.InputJsonValue,
    stopConditions: automation.stopConditions,
    respectSendWindow: automation.respectSendWindow,
    isActive: automation.isActive,
  };
}
