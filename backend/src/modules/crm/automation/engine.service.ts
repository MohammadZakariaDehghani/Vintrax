import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DEALER_TRIGGERS,
  HARD_SUPPRESSIONS,
  SUPPORT_TRIGGERS,
  type AutomationStep,
  type AutomationTrigger,
  type StopCondition,
} from '@vintrax/shared';
import type { CrmAutomation, CrmAutomationEnrollment, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CrmBus, type CrmSignal, type CrmSignalType } from '../core/bus';
import { systemContext, type CrmContext } from '../core/context';
import { CrmNotifyService } from '../core/notify.service';
import { OutboxService } from '../email/outbox.service';
import { AssignmentService } from '../leads/assignment.service';
import { LeadsService } from '../leads/leads.service';
import { recordTimeline } from '../leads/timeline';
import { SYSTEM_ACTOR, TicketsService } from '../support/tickets.service';
import { WorkService } from '../work/work.service';
import { evaluateAll, leadFacts, ticketFacts } from './conditions';

/** Which signal satisfies which stop condition. */
const STOP_FOR: Partial<Record<CrmSignalType, StopCondition>> = {
  CUSTOMER_REPLIED: 'REPLIED',
  DEAL_WON: 'WON',
  DEAL_LOST: 'LOST',
  APPOINTMENT_COMPLETED: 'APPOINTMENT_COMPLETED',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
  EMAIL_INVALID: 'EMAIL_INVALID',
  TICKET_CLOSED: 'TICKET_CLOSED',
  TICKET_USER_REPLIED: 'USER_REPLIED',
};

const TRIGGERS = new Set<string>([...DEALER_TRIGGERS, ...SUPPORT_TRIGGERS]);
/** Triggers about one appointment: the same lead can be enrolled once per appointment. */
const PER_APPOINTMENT = new Set<string>([
  'APPOINTMENT_CREATED',
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_COMPLETED',
]);
const MAX_STEPS_PER_RUN = 25;
const MAX_ATTEMPTS = 5;

interface HistoryEntry {
  stepId?: string;
  type: string;
  at: string;
  result?: string;
  appointmentId?: string | null;
  version?: number;
}

interface StepResult {
  next: string | null | undefined;
  /** Pause until then (WAIT, an armed reminder). */
  wait?: Date;
  /** End the automation here. */
  end?: boolean;
  note?: string;
}

type Enrollment = CrmAutomationEnrollment & { automation: CrmAutomation };

/**
 * The automation engine (D-066): trigger → conditions → steps, with waits,
 * branches and stop conditions, for both CRMs.
 *
 * State lives in the database, not in memory: an enrollment records the step
 * it is on and when it next runs, and the scheduler resumes it then — a
 * restart, a deploy or a closed browser loses nothing. Enrollments are
 * claimed with row locks, so several API processes can share the work. A
 * step that throws is retried with backoff and the enrollment fails after
 * five attempts; an email step carries an idempotency key, so a retried
 * step never sends twice.
 */
@Injectable()
export class AutomationEngine implements OnModuleInit {
  private readonly logger = new Logger(AutomationEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: CrmBus,
    private readonly outbox: OutboxService,
    private readonly leads: LeadsService,
    private readonly work: WorkService,
    private readonly assignment: AssignmentService,
    private readonly notify: CrmNotifyService,
    private readonly tickets: TicketsService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe((signal) => this.onSignal(signal));
  }

  async onSignal(signal: CrmSignal): Promise<void> {
    const stop = STOP_FOR[signal.type];
    if (stop) await this.stopMatching(signal, stop);
    if (TRIGGERS.has(signal.type)) await this.trigger(signal.type as AutomationTrigger, signal);
  }

  // --- Enrolling -----------------------------------------------------------------------

  async trigger(trigger: AutomationTrigger, signal: Omit<CrmSignal, 'type'>): Promise<number> {
    if (signal.scope === 'DEALER' && !signal.dealerId) return 0;
    const automations = await this.prisma.crmAutomation.findMany({
      where: {
        scope: signal.scope,
        dealerId: signal.scope === 'DEALER' ? signal.dealerId! : null,
        trigger,
        isActive: true,
      },
    });
    let enrolled = 0;
    for (const automation of automations) {
      if (!(await this.matchesTrigger(automation, signal))) continue;
      const enrollment = await this.enroll(automation, {
        leadId: signal.leadId ?? null,
        ticketId: signal.ticketId ?? null,
        appointmentId: signal.appointmentId ?? null,
      });
      if (enrollment) enrolled += 1;
    }
    return enrolled;
  }

  private async matchesTrigger(
    automation: CrmAutomation,
    signal: Omit<CrmSignal, 'type'>,
  ): Promise<boolean> {
    const config = (automation.triggerConfig ?? {}) as {
      statusKey?: string;
      conditions?: AutomationStep['config']['conditions'];
    };
    if (config.statusKey && signal.statusKey !== config.statusKey) return false;
    if (!config.conditions?.length) return true;
    const facts = signal.leadId
      ? await leadFacts(this.prisma, signal.leadId)
      : signal.ticketId
        ? await ticketFacts(this.prisma, signal.ticketId)
        : null;
    return !!facts && evaluateAll(config.conditions, facts);
  }

  /** Starts an automation for a lead or ticket. Returns null if it is already running for them. */
  async enroll(
    automation: CrmAutomation,
    target: { leadId?: string | null; ticketId?: string | null; appointmentId?: string | null },
    note = 'Triggered',
  ) {
    const steps = this.steps(automation);
    if (!steps.length) return null;
    if (automation.scope === 'DEALER' && !target.leadId) return null;
    if (automation.scope === 'SUPPORT' && !target.ticketId) return null;

    const running = await this.prisma.crmAutomationEnrollment.findMany({
      where: {
        automationId: automation.id,
        ...(target.leadId ? { leadId: target.leadId } : { ticketId: target.ticketId! }),
        status: { in: ['ACTIVE', 'WAITING'] },
      },
      select: { history: true },
    });
    const duplicate = running.some((row) => {
      if (!PER_APPOINTMENT.has(automation.trigger)) return true;
      const first = (row.history as unknown as HistoryEntry[])[0];
      return first?.appointmentId === (target.appointmentId ?? null);
    });
    if (duplicate) return null;

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await tx.crmAutomationEnrollment.create({
        data: {
          automationId: automation.id,
          dealerId: automation.dealerId,
          leadId: target.leadId ?? null,
          ticketId: target.ticketId ?? null,
          status: 'ACTIVE',
          currentStepId: steps[0]!.id,
          nextRunAt: now,
          history: [
            {
              type: 'ENROLLED',
              at: now.toISOString(),
              result: note,
              appointmentId: target.appointmentId ?? null,
              version: automation.version,
            },
          ] as unknown as Prisma.InputJsonValue,
        },
      });
      if (target.leadId && automation.dealerId) {
        await recordTimeline(tx, {
          dealerId: automation.dealerId,
          leadId: target.leadId,
          type: 'AUTOMATION_STARTED',
          title: `Automation started: ${automation.name}`,
          metadata: { automationId: automation.id, enrollmentId: enrollment.id },
        });
      }
      if (target.ticketId) {
        await tx.supportTicketEvent.create({
          data: { ticketId: target.ticketId, type: 'AUTOMATION_STARTED', detail: automation.name },
        });
      }
      return enrollment;
    });
  }

  // --- Stopping -------------------------------------------------------------------------

  private async stopMatching(signal: CrmSignal, condition: StopCondition) {
    const where: Prisma.CrmAutomationEnrollmentWhereInput = {
      status: { in: ['ACTIVE', 'WAITING'] },
      automation: { stopConditions: { has: condition } },
    };
    if (signal.leadId) where.leadId = signal.leadId;
    else if (signal.ticketId) where.ticketId = signal.ticketId;
    else return;
    const enrollments = await this.prisma.crmAutomationEnrollment.findMany({
      where,
      select: { id: true },
    });
    for (const { id } of enrollments) await this.stop(id, condition);
  }

  /** Stops an enrollment and cancels anything it queued that has not gone yet. */
  async stop(
    enrollmentId: string,
    reason: string,
    status: 'STOPPED' | 'COMPLETED' | 'FAILED' = 'STOPPED',
  ) {
    const now = new Date();
    const enrollment = await this.prisma.crmAutomationEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { automation: { select: { name: true, dealerId: true } } },
    });
    if (!enrollment || enrollment.status === 'COMPLETED' || enrollment.status === 'STOPPED') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.crmAutomationEnrollment.update({
        where: { id: enrollmentId },
        data: { status, stopReason: reason, finishedAt: now, nextRunAt: null, lockedUntil: null },
      });
      if (status !== 'COMPLETED') {
        await tx.crmEmail.updateMany({
          where: { enrollmentId, status: { in: ['SCHEDULED', 'QUEUED'] } },
          data: { status: 'CANCELLED', lastError: `Automation stopped: ${reason}` },
        });
      }
      if (enrollment.leadId && enrollment.automation.dealerId) {
        await recordTimeline(tx, {
          dealerId: enrollment.automation.dealerId,
          leadId: enrollment.leadId,
          type: 'AUTOMATION_STOPPED',
          title: `${enrollment.automation.name}: ${status === 'COMPLETED' ? 'finished' : `stopped (${reason.toLowerCase().replace(/_/g, ' ')})`}`,
          metadata: { enrollmentId, reason, status },
        });
      }
      if (enrollment.ticketId) {
        await tx.supportTicketEvent.create({
          data: {
            ticketId: enrollment.ticketId,
            type: 'AUTOMATION_STOPPED',
            detail: `${enrollment.automation.name}: ${reason}`,
          },
        });
      }
    });
  }

  /** Why this enrollment must not continue, if it must not. Checked before every step. */
  private async stopReason(enrollment: Enrollment): Promise<string | null> {
    const stops = new Set(enrollment.automation.stopConditions);
    if (!enrollment.automation.isActive) return 'AUTOMATION_OFF';
    if (enrollment.leadId) {
      const lead = await this.prisma.crmLead.findUnique({
        where: { id: enrollment.leadId },
        select: {
          mergedIntoId: true,
          lastRepliedAt: true,
          emailNormalized: true,
          dealerId: true,
          status: { select: { kind: true } },
        },
      });
      if (!lead || lead.mergedIntoId) return 'LEAD_REMOVED';
      if (stops.has('WON') && lead.status.kind === 'WON') return 'WON';
      if (stops.has('LOST') && lead.status.kind === 'LOST') return 'LOST';
      if (stops.has('REPLIED') && lead.lastRepliedAt && lead.lastRepliedAt > enrollment.startedAt)
        return 'REPLIED';
      if (stops.has('APPOINTMENT_COMPLETED')) {
        const done = await this.prisma.crmAppointment.count({
          where: {
            leadId: enrollment.leadId,
            status: 'COMPLETED',
            updatedAt: { gt: enrollment.startedAt },
          },
        });
        if (done > 0) return 'APPOINTMENT_COMPLETED';
      }
      if (lead.emailNormalized && (stops.has('UNSUBSCRIBED') || stops.has('EMAIL_INVALID'))) {
        const suppressions = await this.prisma.crmSuppression.findMany({
          where: {
            email: lead.emailNormalized,
            OR: [{ dealerId: lead.dealerId }, { dealerId: null }],
          },
          select: { reason: true },
        });
        if (stops.has('UNSUBSCRIBED') && suppressions.some((row) => row.reason === 'UNSUBSCRIBED'))
          return 'UNSUBSCRIBED';
        if (
          stops.has('EMAIL_INVALID') &&
          suppressions.some((row) => HARD_SUPPRESSIONS.includes(row.reason))
        )
          return 'EMAIL_INVALID';
      }
    }
    if (enrollment.ticketId) {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: enrollment.ticketId },
        select: { status: true, lastPublicReplyBy: true, lastPublicReplyAt: true },
      });
      if (!ticket) return 'TICKET_REMOVED';
      if (stops.has('TICKET_CLOSED') && ticket.status === 'CLOSED') return 'TICKET_CLOSED';
      if (
        stops.has('USER_REPLIED') &&
        ticket.lastPublicReplyBy === 'REQUESTER' &&
        ticket.lastPublicReplyAt &&
        ticket.lastPublicReplyAt > enrollment.startedAt
      ) {
        return 'USER_REPLIED';
      }
    }
    return null;
  }

  // --- Running --------------------------------------------------------------------------

  /** Claims due enrollments and runs each until it waits, ends or fails. */
  async processDue(now = new Date(), limit = 50): Promise<number> {
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "CrmAutomationEnrollment" SET "lockedUntil" = ${new Date(now.getTime() + 2 * 60_000)}
      WHERE id IN (
        SELECT id FROM "CrmAutomationEnrollment"
        WHERE status IN ('ACTIVE', 'WAITING') AND "nextRunAt" <= ${now}
          AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
        ORDER BY "nextRunAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    for (const { id } of claimed) await this.run(id, now);
    return claimed.length;
  }

  async run(enrollmentId: string, now = new Date()): Promise<void> {
    let enrollment = await this.prisma.crmAutomationEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { automation: true },
    });
    if (!enrollment || (enrollment.status !== 'ACTIVE' && enrollment.status !== 'WAITING')) return;
    const steps = new Map(this.steps(enrollment.automation).map((step) => [step.id, step]));
    const history = [...((enrollment.history as unknown as HistoryEntry[]) ?? [])];

    try {
      for (let ran = 0; ran < MAX_STEPS_PER_RUN; ran += 1) {
        const reason = await this.stopReason(enrollment);
        if (reason) return await this.stop(enrollmentId, reason);
        const step = enrollment.currentStepId ? steps.get(enrollment.currentStepId) : undefined;
        if (!step) return await this.stop(enrollmentId, 'FINISHED', 'COMPLETED');

        const result = await this.execute(step, enrollment, history, now);
        history.push({
          stepId: step.id,
          type: step.type,
          at: now.toISOString(),
          result: result.note,
        });
        const trimmed = history.slice(-200) as unknown as Prisma.InputJsonValue;

        if (result.end) {
          await this.prisma.crmAutomationEnrollment.update({
            where: { id: enrollmentId },
            data: { history: trimmed },
          });
          return await this.stop(enrollmentId, 'STOP_STEP', 'COMPLETED');
        }
        if (result.wait) {
          await this.prisma.crmAutomationEnrollment.update({
            where: { id: enrollmentId },
            data: {
              currentStepId: result.next ?? null,
              nextRunAt: result.wait,
              status: 'WAITING',
              attempts: 0,
              lastError: null,
              lockedUntil: null,
              history: trimmed,
            },
          });
          // A wait with nothing after it finishes when it ends (no current step next run).
          return;
        }
        enrollment = await this.prisma.crmAutomationEnrollment.update({
          where: { id: enrollmentId },
          data: {
            currentStepId: result.next ?? null,
            status: 'ACTIVE',
            attempts: 0,
            lastError: null,
            history: trimmed,
          },
          include: { automation: true },
        });
        if (!result.next) return await this.stop(enrollmentId, 'FINISHED', 'COMPLETED');
      }
      // A long run of instant steps: carry on next tick rather than hog this one.
      await this.prisma.crmAutomationEnrollment.update({
        where: { id: enrollmentId },
        data: { nextRunAt: now, lockedUntil: null },
      });
    } catch (error) {
      const attempts = enrollment.attempts + 1;
      const message = String((error as Error).message ?? error).slice(0, 500);
      this.logger.warn(
        `Automation enrollment ${enrollmentId} step ${enrollment.currentStepId} failed (attempt ${attempts}): ${message}`,
      );
      if (attempts >= MAX_ATTEMPTS) {
        await this.prisma.crmAutomationEnrollment.update({
          where: { id: enrollmentId },
          data: { attempts, lastError: message },
        });
        await this.stop(enrollmentId, 'STEP_FAILED', 'FAILED');
        return;
      }
      await this.prisma.crmAutomationEnrollment.update({
        where: { id: enrollmentId },
        data: {
          attempts,
          lastError: message,
          lockedUntil: null,
          nextRunAt: new Date(now.getTime() + 60_000 * 2 ** (attempts - 1)),
        },
      });
    }
  }

  private async execute(
    step: AutomationStep,
    enrollment: Enrollment,
    history: HistoryEntry[],
    now: Date,
  ): Promise<StepResult> {
    const automation = enrollment.automation;
    const config = step.config ?? {};
    const ctx = automation.dealerId ? await this.dealerContext(automation.dealerId) : null;
    const leadId = enrollment.leadId;
    const ticketId = enrollment.ticketId;

    switch (step.type) {
      case 'WAIT':
        return {
          next: step.next,
          wait: new Date(now.getTime() + (config.minutes ?? 0) * 60_000),
          note: `Waiting ${config.minutes} min`,
        };

      case 'CONDITION': {
        const facts = leadId
          ? await leadFacts(this.prisma, leadId, now)
          : ticketId
            ? await ticketFacts(this.prisma, ticketId)
            : null;
        const yes = !!facts && evaluateAll(config.conditions, facts);
        return { next: yes ? step.yes : step.no, note: yes ? 'yes' : 'no' };
      }

      case 'SEND_EMAIL': {
        const template = await this.template(automation, config);
        if (!template)
          return { next: step.next, note: 'Skipped: template missing or switched off' };
        const key = `auto:${enrollment.id}:${step.id}`;
        if (ctx && leadId) {
          const lead = await this.prisma.crmLead.findUnique({
            where: { id: leadId },
            select: { email: true, assignedToId: true },
          });
          if (config.toSalesperson ? !lead?.assignedToId : !lead?.email) {
            return { next: step.next, note: 'Skipped: no email address' };
          }
          const result = await this.outbox.queueLeadEmail(ctx, {
            leadId,
            subject: template.subject,
            bodyHtml: template.bodyHtml,
            purpose: template.purpose,
            templateId: template.id,
            respectSendWindow: automation.respectSendWindow,
            enrollmentId: enrollment.id,
            automationStepId: step.id,
            appointmentId: this.appointmentOf(history),
            toSalesperson: config.toSalesperson,
            idempotencyKey: key,
          });
          return {
            next: step.next,
            note:
              result.status === 'SUPPRESSED'
                ? `Not sent: ${result.reason}`
                : `Email ${result.status.toLowerCase()}`,
          };
        }
        if (ticketId) {
          const result = await this.outbox.queueTicketEmail({
            ticketId,
            subject: template.subject,
            bodyHtml: template.bodyHtml,
            templateId: template.id,
            enrollmentId: enrollment.id,
            automationStepId: step.id,
            idempotencyKey: key,
          });
          return { next: step.next, note: `Email ${result.status.toLowerCase()}` };
        }
        return { next: step.next, note: 'Skipped' };
      }

      case 'CREATE_TASK': {
        const due =
          config.dueInMinutes !== undefined
            ? new Date(now.getTime() + config.dueInMinutes * 60_000)
            : null;
        if (ctx && leadId) {
          const lead = await this.prisma.crmLead.findUniqueOrThrow({
            where: { id: leadId },
            select: { firstName: true, lastName: true, assignedToId: true },
          });
          const title =
            `${config.title}: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ')}`.slice(
              0,
              160,
            );
          // A retried step finds the task it already made.
          const existing = await this.prisma.crmTask.findFirst({
            where: { leadId, title, createdById: null, createdAt: { gte: enrollment.startedAt } },
            select: { id: true },
          });
          if (!existing) {
            await this.work.createTask(ctx, {
              title,
              description: [config.body, `Created by the “${automation.name}” automation.`]
                .filter(Boolean)
                .join('\n\n'),
              leadId,
              assignedToId: lead.assignedToId,
              vehicleId: null,
              dueAt: due,
              priority: config.priority ?? 'MEDIUM',
              status: 'OPEN',
              reminderAt: null,
              recurrence: 'NONE',
            });
          }
          return { next: step.next, note: existing ? 'Task already created' : 'Task created' };
        }
        if (ticketId) {
          const ticket = await this.prisma.supportTicket.findUniqueOrThrow({
            where: { id: ticketId },
            select: { assignedToId: true, dealerId: true, requesterId: true },
          });
          const existing = await this.prisma.adminTask.findFirst({
            where: {
              ticketId,
              title: config.title!,
              createdById: null,
              createdAt: { gte: enrollment.startedAt },
            },
          });
          if (!existing) {
            await this.prisma.adminTask.create({
              data: {
                title: config.title!,
                description: config.body ?? null,
                ticketId,
                assignedToId: ticket.assignedToId,
                dealerId: ticket.dealerId,
                subjectUserId: ticket.requesterId,
                dueAt: due,
                priority: config.priority ?? 'MEDIUM',
              },
            });
          }
          return { next: step.next, note: 'Task created' };
        }
        return { next: step.next };
      }

      case 'ASSIGN': {
        if (ctx && leadId) {
          const lead = await this.prisma.crmLead.findUniqueOrThrow({
            where: { id: leadId },
            select: {
              assignedToId: true,
              sourceId: true,
              province: true,
              vehicle: { select: { make: true } },
            },
          });
          let userId = config.userId ?? null;
          if (!userId) {
            if (lead.assignedToId && !config.team)
              return { next: step.next, note: 'Already assigned' };
            const picked = await this.assignment.pick({
              dealerId: ctx.dealerId,
              sourceId: lead.sourceId,
              province: lead.province,
              vehicleMake: lead.vehicle?.make ?? null,
            });
            userId = picked.userId;
          }
          if (!userId) return { next: step.next, note: 'No one to assign to' };
          await this.leads.assign(ctx, leadId, { assignedToId: userId, team: config.team ?? null });
          return { next: step.next, note: 'Assigned' };
        }
        if (ticketId) {
          if (config.userId)
            await this.tickets.update(SYSTEM_ACTOR, ticketId, { assignedToId: config.userId });
          else await this.tickets.autoAssign(ticketId);
          return { next: step.next, note: 'Assigned' };
        }
        return { next: step.next };
      }

      case 'SET_STATUS':
        if (ctx && leadId && config.statusKey) {
          const result = await this.leads.setStatusByKey(ctx, leadId, config.statusKey);
          return {
            next: step.next,
            note: result.changed ? `Status ${config.statusKey}` : 'Status unchanged',
          };
        }
        if (ticketId && config.ticketStatus) {
          await this.tickets.setStatus(SYSTEM_ACTOR, ticketId, config.ticketStatus);
          return { next: step.next, note: `Status ${config.ticketStatus}` };
        }
        return { next: step.next };

      case 'MOVE_TO_NURTURE':
        if (ctx && leadId) await this.leads.setStatusByKey(ctx, leadId, 'NURTURE');
        return { next: step.next, note: 'Moved to Nurture' };

      case 'ADD_TAG':
      case 'REMOVE_TAG': {
        if (!ctx || !leadId || !config.tag) return { next: step.next };
        if (step.type === 'ADD_TAG') {
          await this.prisma.$transaction((tx) =>
            this.leads.applyTags(tx, ctx, leadId, [config.tag!], false),
          );
        } else {
          const current = await this.prisma.crmLeadTag.findMany({
            where: { leadId },
            include: { tag: true },
          });
          const keep = current
            .filter((row) => row.tag.name.toLowerCase() !== config.tag!.toLowerCase())
            .map((row) => row.tag.name);
          if (keep.length !== current.length) {
            await this.prisma.$transaction((tx) =>
              this.leads.applyTags(tx, ctx, leadId, keep, true),
            );
          }
        }
        return {
          next: step.next,
          note: `${step.type === 'ADD_TAG' ? 'Tagged' : 'Untagged'} ${config.tag}`,
        };
      }

      case 'APPOINTMENT_REMINDER': {
        if (!ctx || !leadId) return { next: step.next };
        const appointmentId = this.appointmentOf(history);
        const appointment = appointmentId
          ? await this.prisma.crmAppointment.findUnique({ where: { id: appointmentId } })
          : await this.prisma.crmAppointment.findFirst({
              where: { leadId, startsAt: { gt: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
              orderBy: { startsAt: 'asc' },
            });
        if (
          !appointment ||
          !['SCHEDULED', 'CONFIRMED'].includes(appointment.status) ||
          appointment.startsAt <= now
        ) {
          return { next: step.next, note: 'No upcoming appointment' };
        }
        const minutes = config.minutes ?? appointment.reminderMinutes ?? 60;
        const remindAt = new Date(appointment.startsAt.getTime() - minutes * 60_000);
        // Wait for the reminder time; if the appointment moves, the next run re-reads it.
        if (remindAt.getTime() - now.getTime() > 60_000) {
          return { next: step.id, wait: remindAt, note: `Reminder at ${remindAt.toISOString()}` };
        }
        const template = await this.template(automation, {
          ...config,
          templateKey: config.templateKey ?? 'APPOINTMENT_REMINDER',
        });
        if (template) {
          await this.outbox
            .queueLeadEmail(ctx, {
              leadId,
              subject: template.subject,
              bodyHtml: template.bodyHtml,
              purpose: 'TRANSACTIONAL',
              templateId: template.id,
              enrollmentId: enrollment.id,
              automationStepId: step.id,
              appointmentId: appointment.id,
              idempotencyKey: `auto:${enrollment.id}:${step.id}:${appointment.id}:${appointment.startsAt.getTime()}`,
            })
            .catch(() => undefined);
        }
        await this.notify.notify(appointment.salespersonId, 'APPOINTMENT_UPCOMING', {
          title: 'Appointment coming up',
          body: `Starts ${appointment.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
          link: `/dealer/crm/leads/${leadId}`,
        });
        return { next: step.next, note: 'Reminder sent' };
      }

      case 'NOTIFY': {
        const recipients = await this.recipients(
          config.recipients ?? 'ASSIGNEE',
          ctx,
          leadId,
          ticketId,
        );
        const link = leadId
          ? `/dealer/crm/leads/${leadId}`
          : ticketId
            ? `/admin/crm/tickets/${ticketId}`
            : null;
        for (const userId of recipients) {
          await this.notify.notify(userId, ticketId ? 'TICKET_UPDATED' : 'LEAD_ASSIGNED', {
            title: config.title ?? automation.name,
            body: config.body ?? automation.name,
            link,
          });
        }
        return { next: step.next, note: `Notified ${recipients.length}` };
      }

      case 'START_AUTOMATION': {
        const other = await this.prisma.crmAutomation.findFirst({
          where: {
            scope: automation.scope,
            dealerId: automation.dealerId,
            isActive: true,
            AND: [
              { id: { not: automation.id } },
              config.automationId ? { id: config.automationId } : { key: config.automationKey },
            ],
          },
        });
        if (other)
          await this.enroll(
            other,
            { leadId, ticketId, appointmentId: this.appointmentOf(history) },
            `Started by ${automation.name}`,
          );
        return {
          next: step.next,
          note: other ? `Started ${other.name}` : 'Automation not found or off',
        };
      }

      case 'STOP':
        return { next: null, end: true, note: 'Stop' };

      default:
        return { next: step.next };
    }
  }

  // --- Helpers ---------------------------------------------------------------------------

  steps(automation: CrmAutomation): AutomationStep[] {
    return Array.isArray(automation.steps) ? (automation.steps as unknown as AutomationStep[]) : [];
  }

  private appointmentOf(history: HistoryEntry[]): string | null {
    return history[0]?.appointmentId ?? null;
  }

  private async template(automation: CrmAutomation, config: AutomationStep['config']) {
    if (!config.templateId && !config.templateKey) return null;
    return this.prisma.crmEmailTemplate.findFirst({
      where: {
        scope: automation.scope,
        dealerId: automation.dealerId,
        isActive: true,
        ...(config.templateId ? { id: config.templateId } : { key: config.templateKey }),
      },
    });
  }

  private readonly owners = new Map<string, string>();

  private async dealerContext(dealerId: string): Promise<CrmContext> {
    let owner = this.owners.get(dealerId);
    if (!owner) {
      owner = (
        await this.prisma.dealer.findUniqueOrThrow({
          where: { id: dealerId },
          select: { ownerId: true },
        })
      ).ownerId;
      this.owners.set(dealerId, owner);
    }
    return systemContext(dealerId, owner);
  }

  private async recipients(
    who: 'ASSIGNEE' | 'MANAGERS' | 'TEAM',
    ctx: CrmContext | null,
    leadId: string | null,
    ticketId: string | null,
  ): Promise<string[]> {
    if (leadId && ctx) {
      if (who === 'ASSIGNEE') {
        const lead = await this.prisma.crmLead.findUnique({
          where: { id: leadId },
          select: { assignedToId: true },
        });
        if (lead?.assignedToId) return [lead.assignedToId];
      }
      const managers = await this.prisma.dealerMember.findMany({
        where: { dealerId: ctx.dealerId, role: { in: ['MANAGER', 'SALES_MANAGER'] } },
        select: { userId: true },
      });
      return [ctx.ownerUserId, ...managers.map((row) => row.userId)];
    }
    if (ticketId) {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { assignedToId: true, teamId: true },
      });
      if (who === 'ASSIGNEE' && ticket?.assignedToId) return [ticket.assignedToId];
      return this.tickets.teamOrAdmins(ticket?.teamId ?? null);
    }
    return [];
  }

  // --- Manual control --------------------------------------------------------------------

  async enrollManually(
    automationId: string,
    target: { dealerId: string | null; leadId?: string | null; ticketId?: string | null },
  ) {
    const automation = await this.prisma.crmAutomation.findFirst({
      where: { id: automationId, dealerId: target.dealerId },
    });
    if (!automation) return null;
    return this.enroll(
      automation,
      { leadId: target.leadId, ticketId: target.ticketId },
      'Started by hand',
    );
  }

  async retry(enrollmentId: string) {
    await this.prisma.crmAutomationEnrollment.updateMany({
      where: { id: enrollmentId, status: 'FAILED' },
      data: {
        status: 'ACTIVE',
        attempts: 0,
        lastError: null,
        nextRunAt: new Date(),
        finishedAt: null,
        stopReason: null,
      },
    });
  }
}
