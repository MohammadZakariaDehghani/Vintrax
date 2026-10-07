import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEALER_TRIGGERS,
  SUPPORT_TRIGGERS,
  type AutomationInput,
  type AutomationStepType,
} from '@vintrax/shared';
import type { CrmScope, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit, supportAudit } from '../core/audit';
import type { CrmContext } from '../core/context';
import { AutomationEngine } from './engine.service';

export interface AutomationOwner {
  scope: CrmScope;
  dealerId: string | null;
  actor: { id: string; email: string };
  ctx?: CrmContext;
}

const DEALER_ONLY: AutomationStepType[] = [
  'MOVE_TO_NURTURE',
  'ADD_TAG',
  'REMOVE_TAG',
  'APPOINTMENT_REMINDER',
];

/** CRM → Automations: the sequences, their enrollments and how they perform. */
@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AutomationEngine,
  ) {}

  async list(owner: Pick<AutomationOwner, 'scope' | 'dealerId'>) {
    const automations = await this.prisma.crmAutomation.findMany({
      where: { scope: owner.scope, dealerId: owner.dealerId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    const ids = automations.map((automation) => automation.id);
    const [byStatus, emails] = await Promise.all([
      this.prisma.crmAutomationEnrollment.groupBy({
        by: ['automationId', 'status'],
        where: { automationId: { in: ids } },
        _count: { _all: true },
      }),
      ids.length
        ? this.prisma.$queryRaw<
            Array<{
              automationId: string;
              sent: bigint;
              opened: bigint;
              clicked: bigint;
              replied: bigint;
            }>
          >`
            SELECT e."automationId", count(m."sentAt") AS sent, count(m."openedAt") AS opened,
                   count(m."clickedAt") AS clicked, count(m."repliedAt") AS replied
            FROM "CrmEmail" m JOIN "CrmAutomationEnrollment" e ON e.id = m."enrollmentId"
            WHERE e."automationId" = ANY(${ids}::uuid[])
            GROUP BY e."automationId"`
        : Promise.resolve([]),
    ]);
    return automations.map((automation) => {
      const counts = Object.fromEntries(
        byStatus
          .filter((row) => row.automationId === automation.id)
          .map((row) => [row.status, row._count._all]),
      );
      const mail = emails.find((row) => row.automationId === automation.id);
      return {
        ...automation,
        stats: {
          active: (counts.ACTIVE ?? 0) + (counts.WAITING ?? 0),
          completed: counts.COMPLETED ?? 0,
          stopped: counts.STOPPED ?? 0,
          failed: counts.FAILED ?? 0,
          emailsSent: Number(mail?.sent ?? 0),
          opened: Number(mail?.opened ?? 0),
          clicked: Number(mail?.clicked ?? 0),
          replied: Number(mail?.replied ?? 0),
        },
      };
    });
  }

  async get(owner: Pick<AutomationOwner, 'scope' | 'dealerId'>, id: string) {
    const automation = await this.prisma.crmAutomation.findFirst({
      where: { id, scope: owner.scope, dealerId: owner.dealerId },
    });
    if (!automation) throw new NotFoundException('Automation not found');
    return automation;
  }

  async create(owner: AutomationOwner, input: AutomationInput) {
    await this.validate(owner, input);
    const automation = await this.prisma.crmAutomation.create({
      data: {
        scope: owner.scope,
        dealerId: owner.dealerId,
        name: input.name,
        description: input.description,
        trigger: input.trigger,
        triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        stopConditions: input.stopConditions,
        respectSendWindow: input.respectSendWindow,
        isActive: input.isActive,
        createdById: owner.actor.id,
      },
    });
    await this.audit(owner, 'automation.created', automation.id, undefined, {
      name: input.name,
      trigger: input.trigger,
      isActive: input.isActive,
    });
    return automation;
  }

  async update(owner: AutomationOwner, id: string, input: AutomationInput) {
    const current = await this.get(owner, id);
    await this.validate(owner, input);
    const automation = await this.prisma.crmAutomation.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        trigger: input.trigger,
        triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        stopConditions: input.stopConditions,
        respectSendWindow: input.respectSendWindow,
        isActive: input.isActive,
        version: current.version + 1,
      },
    });
    if (current.isActive && !input.isActive) await this.stopAll(id, 'AUTOMATION_OFF');
    // Running enrollments continue from their current step id; a step that no
    // longer exists ends them cleanly.
    await this.audit(
      owner,
      'automation.updated',
      id,
      { version: current.version, isActive: current.isActive },
      { version: automation.version, isActive: input.isActive, name: input.name },
    );
    return automation;
  }

  async setActive(owner: AutomationOwner, id: string, isActive: boolean) {
    const current = await this.get(owner, id);
    const automation = await this.prisma.crmAutomation.update({
      where: { id },
      data: { isActive },
    });
    if (current.isActive && !isActive) await this.stopAll(id, 'AUTOMATION_OFF');
    await this.audit(
      owner,
      isActive ? 'automation.activated' : 'automation.deactivated',
      id,
      { isActive: current.isActive },
      { isActive },
    );
    return automation;
  }

  async remove(owner: AutomationOwner, id: string) {
    const automation = await this.get(owner, id);
    if (automation.key)
      throw new BadRequestException('A starting automation can be switched off but not deleted');
    await this.stopAll(id, 'DELETED');
    await this.prisma.crmAutomation.delete({ where: { id } });
    await this.audit(owner, 'automation.deleted', id, { name: automation.name });
  }

  async enrollments(
    owner: Pick<AutomationOwner, 'scope' | 'dealerId'>,
    id: string,
    status?: string,
  ) {
    await this.get(owner, id);
    return this.prisma.crmAutomationEnrollment.findMany({
      where: { automationId: id, ...(status ? { status: status as never } : {}) },
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: {
        lead: { select: { id: true, number: true, firstName: true, lastName: true } },
        ticket: { select: { id: true, number: true, subject: true } },
      },
    });
  }

  async enroll(
    owner: AutomationOwner,
    id: string,
    target: { leadId?: string | null; ticketId?: string | null },
  ) {
    const automation = await this.get(owner, id);
    if (!automation.isActive) throw new BadRequestException('Turn the automation on first');
    if (owner.scope === 'DEALER') {
      const lead = await this.prisma.crmLead.findFirst({
        where: { id: target.leadId ?? '', dealerId: owner.dealerId! },
      });
      if (!lead) throw new BadRequestException('Choose one of your leads');
    } else if (
      !(await this.prisma.supportTicket.findUnique({ where: { id: target.ticketId ?? '' } }))
    ) {
      throw new BadRequestException('Choose a ticket');
    }
    const enrollment = await this.engine.enrollManually(id, {
      dealerId: owner.dealerId,
      ...target,
    });
    if (!enrollment) throw new BadRequestException('Already running for them');
    await this.audit(owner, 'automation.enrolled', id, undefined, {
      enrollmentId: enrollment.id,
      ...target,
    });
    return enrollment;
  }

  async stopEnrollment(owner: AutomationOwner, enrollmentId: string) {
    const enrollment = await this.prisma.crmAutomationEnrollment.findFirst({
      where: { id: enrollmentId, automation: { scope: owner.scope, dealerId: owner.dealerId } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    await this.engine.stop(enrollmentId, 'MANUAL');
    await this.audit(owner, 'automation.stopped_by_hand', enrollment.automationId, undefined, {
      enrollmentId,
    });
  }

  async retryEnrollment(owner: AutomationOwner, enrollmentId: string) {
    const enrollment = await this.prisma.crmAutomationEnrollment.findFirst({
      where: {
        id: enrollmentId,
        status: 'FAILED',
        automation: { scope: owner.scope, dealerId: owner.dealerId },
      },
    });
    if (!enrollment) throw new NotFoundException('Only a failed enrollment can be retried');
    await this.engine.retry(enrollmentId);
  }

  private async stopAll(automationId: string, reason: string) {
    const running = await this.prisma.crmAutomationEnrollment.findMany({
      where: { automationId, status: { in: ['ACTIVE', 'WAITING'] } },
      select: { id: true },
    });
    for (const { id } of running) await this.engine.stop(id, reason);
  }

  private async validate(
    owner: Pick<AutomationOwner, 'scope' | 'dealerId'>,
    input: AutomationInput,
  ) {
    const triggers: readonly string[] =
      owner.scope === 'DEALER' ? DEALER_TRIGGERS : SUPPORT_TRIGGERS;
    if (!triggers.includes(input.trigger)) {
      throw new BadRequestException({
        message: 'Unknown trigger',
        details: { trigger: ['Choose a trigger from the list'] },
      });
    }
    for (const step of input.steps) {
      if (owner.scope === 'SUPPORT' && DEALER_ONLY.includes(step.type)) {
        throw new BadRequestException(`"${step.type}" is for dealer automations`);
      }
      const config = step.config;
      if (config.templateId || config.templateKey) {
        const template = await this.prisma.crmEmailTemplate.findFirst({
          where: {
            scope: owner.scope,
            dealerId: owner.dealerId,
            ...(config.templateId ? { id: config.templateId } : { key: config.templateKey }),
          },
          select: { id: true },
        });
        if (!template)
          throw new BadRequestException(`Step "${step.id}": the template does not exist`);
      }
      if (step.type === 'SET_STATUS' && owner.scope === 'DEALER' && config.statusKey) {
        const status = await this.prisma.crmLeadStatus.findUnique({
          where: { dealerId_key: { dealerId: owner.dealerId!, key: config.statusKey } },
        });
        if (!status) throw new BadRequestException(`Step "${step.id}": unknown status`);
      }
      if (config.userId && owner.scope === 'DEALER') {
        const staff = await this.prisma.dealerMember.findUnique({
          where: { dealerId_userId: { dealerId: owner.dealerId!, userId: config.userId } },
        });
        const dealer = await this.prisma.dealer.findUnique({
          where: { id: owner.dealerId! },
          select: { ownerId: true },
        });
        if (!staff && dealer?.ownerId !== config.userId)
          throw new BadRequestException(`Step "${step.id}": not on your staff`);
      }
    }
  }

  private async audit(
    owner: AutomationOwner,
    action: string,
    id: string,
    before?: unknown,
    after?: unknown,
  ) {
    const entry = { action, entityType: 'CrmAutomation', entityId: id, before, after };
    if (owner.scope === 'DEALER' && owner.ctx) await crmAudit(this.prisma, owner.ctx, entry);
    else await supportAudit(this.prisma, owner.actor, entry);
  }
}
