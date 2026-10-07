import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEALER_TEMPLATE_VARIABLES,
  SUPPORT_TEMPLATE_VARIABLES,
  type EmailTemplateInput,
} from '@vintrax/shared';
import type { CrmScope, Prisma } from '@prisma/client';
import { MailService } from '../../../common/mail/mail.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit, supportAudit } from '../core/audit';
import type { CrmContext } from '../core/context';
import { OutboxService } from './outbox.service';
import { assertKnownVariables } from './render';
import { htmlToText, sanitizeHtml } from './sanitizer';

/** Who owns a template: a dealership, or the support team (dealerId null). */
export interface TemplateOwner {
  scope: CrmScope;
  dealerId: string | null;
  actor: { id: string; email: string };
  ctx?: CrmContext;
}

/**
 * Email templates for both CRMs. HTML is sanitised on save, variables are
 * checked against the allowed list, and every edit keeps the previous
 * version in the template's history.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly mail: MailService,
  ) {}

  list(owner: Pick<TemplateOwner, 'scope' | 'dealerId'>, includeInactive = true) {
    return this.prisma.crmEmailTemplate.findMany({
      where: { scope: owner.scope, dealerId: owner.dealerId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        category: true,
        purpose: true,
        subject: true,
        isActive: true,
        version: true,
        updatedAt: true,
        _count: { select: { emails: true } },
      },
    });
  }

  async get(owner: Pick<TemplateOwner, 'scope' | 'dealerId'>, id: string) {
    const template = await this.prisma.crmEmailTemplate.findFirst({
      where: { id, scope: owner.scope, dealerId: owner.dealerId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async create(owner: TemplateOwner, input: EmailTemplateInput) {
    const body = this.clean(owner.scope, input);
    const template = await this.prisma.crmEmailTemplate.create({
      data: {
        scope: owner.scope,
        dealerId: owner.dealerId,
        name: input.name,
        category: input.category,
        purpose: owner.scope === 'SUPPORT' ? 'TRANSACTIONAL' : input.purpose,
        subject: input.subject,
        ...body,
        isActive: input.isActive,
        updatedById: owner.actor.id,
      },
    });
    await this.audit(owner, 'template.created', template.id, undefined, { name: input.name });
    return template;
  }

  async update(owner: TemplateOwner, id: string, input: EmailTemplateInput) {
    const current = await this.get(owner, id);
    const body = this.clean(owner.scope, input);
    const history = (Array.isArray(current.history) ? current.history : []) as Prisma.JsonArray;
    const changedContent =
      current.subject !== input.subject || current.bodyHtml !== body.bodyHtml || current.bodyText !== body.bodyText;
    const template = await this.prisma.crmEmailTemplate.update({
      where: { id },
      data: {
        name: input.name,
        category: input.category,
        purpose: owner.scope === 'SUPPORT' ? 'TRANSACTIONAL' : input.purpose,
        subject: input.subject,
        ...body,
        isActive: input.isActive,
        updatedById: owner.actor.id,
        ...(changedContent
          ? {
              version: current.version + 1,
              history: [
                {
                  version: current.version,
                  subject: current.subject,
                  bodyHtml: current.bodyHtml,
                  bodyText: current.bodyText,
                  savedAt: current.updatedAt.toISOString(),
                },
                ...history,
              ].slice(0, 20),
            }
          : {}),
      },
    });
    await this.audit(owner, 'template.updated', id, { version: current.version }, { version: template.version, name: input.name });
    return template;
  }

  async restore(owner: TemplateOwner, id: string, version: number) {
    const current = await this.get(owner, id);
    const history = (Array.isArray(current.history) ? current.history : []) as Array<{
      version: number;
      subject: string;
      bodyHtml: string;
      bodyText: string;
    }>;
    const old = history.find((entry) => entry.version === version);
    if (!old) throw new NotFoundException('That version is not in the history');
    return this.update(owner, id, {
      name: current.name,
      category: current.category as EmailTemplateInput['category'],
      purpose: current.purpose,
      subject: old.subject,
      bodyHtml: old.bodyHtml,
      bodyText: old.bodyText,
      isActive: current.isActive,
    });
  }

  async remove(owner: TemplateOwner, id: string) {
    const template = await this.get(owner, id);
    if (template.key) {
      throw new BadRequestException('A starting template is used by automations; switch it off instead of deleting it');
    }
    const [usage] = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM "CrmAutomation"
      WHERE scope = ${owner.scope}::"CrmScope"
        AND "dealerId" IS NOT DISTINCT FROM ${owner.dealerId}::uuid
        AND steps::text LIKE ${'%' + id + '%'}`;
    if (Number(usage?.count ?? 0) > 0) throw new ConflictException('An automation uses this template');
    await this.prisma.crmEmailTemplate.delete({ where: { id } });
    await this.audit(owner, 'template.deleted', id, { name: template.name });
  }

  /** Renders for the preview pane, with a real lead (or ticket) or sample values. */
  async preview(
    owner: Pick<TemplateOwner, 'scope' | 'dealerId'>,
    input: { subject: string; bodyHtml: string; leadId?: string | null; ticketId?: string | null },
  ) {
    let values = this.outbox.sampleValues();
    if (owner.scope === 'DEALER' && input.leadId) {
      const lead = await this.prisma.crmLead.findFirst({ where: { id: input.leadId, dealerId: owner.dealerId! } });
      if (!lead) throw new NotFoundException('Lead not found');
      values = await this.outbox.leadValues(lead.id);
    } else if (owner.scope === 'SUPPORT' && input.ticketId) {
      values = await this.outbox.ticketValues(input.ticketId);
    }
    return this.outbox.render(input.subject, input.bodyHtml, values, owner.scope);
  }

  /**
   * A test send, only ever to the person asking: a test must not become a
   * way to email anyone from the dealership's name.
   */
  async sendTest(owner: TemplateOwner, input: { subject: string; bodyHtml: string; to: string }) {
    if (input.to.toLowerCase() !== owner.actor.email.toLowerCase()) {
      throw new ForbiddenException('Test emails go to your own address');
    }
    const rendered = this.outbox.render(input.subject, input.bodyHtml, this.outbox.sampleValues(), owner.scope);
    const receipt = await this.mail.deliver({
      to: input.to,
      subject: `[Test] ${rendered.subject}`,
      text: rendered.text,
      html: rendered.html,
    });
    return { sent: true, provider: receipt.provider };
  }

  private clean(scope: CrmScope, input: EmailTemplateInput) {
    const allowed = scope === 'DEALER' ? DEALER_TEMPLATE_VARIABLES : SUPPORT_TEMPLATE_VARIABLES;
    assertKnownVariables(allowed, input.subject, input.bodyHtml, input.bodyText ?? '');
    const bodyHtml = sanitizeHtml(input.bodyHtml);
    if (!bodyHtml.replace(/<[^>]+>/g, '').trim()) throw new BadRequestException('The email body is empty');
    return { bodyHtml, bodyText: input.bodyText?.trim() || htmlToText(bodyHtml) };
  }

  private async audit(owner: TemplateOwner, action: string, id: string, before?: unknown, after?: unknown) {
    const entry = { action, entityType: 'CrmEmailTemplate', entityId: id, before, after };
    if (owner.scope === 'DEALER' && owner.ctx) await crmAudit(this.prisma, owner.ctx, entry);
    else await supportAudit(this.prisma, owner.actor, entry);
  }
}
