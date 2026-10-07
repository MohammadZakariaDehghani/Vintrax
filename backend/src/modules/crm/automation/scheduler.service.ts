import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CrmBus } from '../core/bus';
import { CrmNotifyService } from '../core/notify.service';
import { CampaignsService } from '../email/campaigns.service';
import { DispatcherService } from '../email/dispatcher.service';
import { ScoringService } from '../leads/scoring.service';
import { SYSTEM_ACTOR, TicketsService } from '../support/tickets.service';
import { AutomationEngine } from './engine.service';

const DAY = 86_400_000;
/** Time-based checks are cheap but not free: once a minute is plenty. */
const TIME_CHECK_INTERVAL_MS = 60_000;

/**
 * The CRM's clock. Each tick sends due email, advances due automation
 * steps and launches due campaigns; about once a minute it also looks for
 * what time alone makes happen — leads that stopped answering, customers
 * gone quiet, overdue tasks, reminders, tickets waiting on the requester.
 *
 * It runs inside the API process (CRM_SCHEDULER_ENABLED), on the existing
 * database, with no new infrastructure; work is claimed with row locks so
 * running several API instances is safe. `tick(now)` is public so tests and
 * a one-off command can drive it deterministically.
 */
@Injectable()
export class CrmScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmScheduler.name);
  private timer?: NodeJS.Timeout;
  private kickTimer?: NodeJS.Timeout;
  private running = false;
  private lastTimeCheck = 0;
  private readonly enabled: boolean;
  private readonly interval: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: DispatcherService,
    private readonly engine: AutomationEngine,
    private readonly campaigns: CampaignsService,
    private readonly scoring: ScoringService,
    private readonly notify: CrmNotifyService,
    private readonly tickets: TicketsService,
    private readonly bus: CrmBus,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('CRM_SCHEDULER_ENABLED', { infer: true }) &&
      config.get('NODE_ENV', { infer: true }) !== 'test';
    this.interval = config.get('CRM_SCHEDULER_INTERVAL_MS', { infer: true });
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('CRM scheduler disabled in this process');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.interval);
    this.timer.unref();
    // Anything the CRM just did may have queued work: run soon rather than at the next interval.
    this.bus.subscribe(async () => this.kick());
    this.logger.log(`CRM scheduler every ${this.interval} ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
  }

  /** Runs a tick shortly, coalescing bursts (a compose, a signal) into one. */
  kick(): void {
    if (!this.enabled || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = undefined;
      void this.tick();
    }, 500);
    this.kickTimer.unref();
  }

  async tick(
    now = new Date(),
    options: { forceTimeChecks?: boolean } = {},
  ): Promise<{ emails: number; steps: number; campaigns: number }> {
    if (this.running) return { emails: 0, steps: 0, campaigns: 0 };
    this.running = true;
    try {
      const campaigns = await this.campaigns.launchDue(now);
      if (options.forceTimeChecks || now.getTime() - this.lastTimeCheck >= TIME_CHECK_INTERVAL_MS) {
        this.lastTimeCheck = now.getTime();
        await this.timeChecks(now);
      }
      const steps = await this.engine.processDue(now);
      const emails = await this.dispatcher.dispatchDue(now);
      return { emails, steps, campaigns };
    } catch (error) {
      this.logger.error(`CRM scheduler tick failed: ${String(error)}`);
      return { emails: 0, steps: 0, campaigns: 0 };
    } finally {
      this.running = false;
    }
  }

  // --- Time-based triggers -------------------------------------------------------------

  async timeChecks(now: Date): Promise<void> {
    const checks: Array<[string, () => Promise<void>]> = [
      ['no response', () => this.noResponse(now)],
      ['inactivity', () => this.inactivity(now)],
      ['overdue tasks', () => this.overdueTasks(now)],
      ['task reminders', () => this.taskReminders(now)],
      ['appointment reminders', () => this.appointmentReminders(now)],
      ['waiting tickets', () => this.waitingTickets(now)],
      ['ticket auto-close', () => this.autoCloseTickets(now)],
      ['admin task reminders', () => this.adminTaskReminders(now)],
    ];
    for (const [name, check] of checks) {
      try {
        await check();
      } catch (error) {
        this.logger.error(`CRM time check "${name}" failed: ${String(error)}`);
      }
    }
  }

  /**
   * Leads the dealership reached out to who have not answered within the
   * dealer's "no response" days: score them down once, and start the
   * NO_RESPONSE automations.
   */
  private async noResponse(now: Date) {
    const settings = await this.prisma.crmSettings.findMany({
      select: { dealerId: true, noResponseDays: true },
    });
    for (const setting of settings) {
      const automations = await this.prisma.crmAutomation.findMany({
        where: {
          scope: 'DEALER',
          dealerId: setting.dealerId,
          trigger: 'NO_RESPONSE',
          isActive: true,
        },
      });
      const days = Math.min(
        setting.noResponseDays,
        ...automations.map(
          (a) => (a.triggerConfig as { days?: number })?.days ?? setting.noResponseDays,
        ),
      );
      const leads = await this.prisma.crmLead.findMany({
        where: {
          dealerId: setting.dealerId,
          mergedIntoId: null,
          status: { kind: 'OPEN' },
          lastContactAt: { not: null, lte: new Date(now.getTime() - days * DAY) },
        },
        select: { id: true, lastContactAt: true, lastRepliedAt: true },
        take: 500,
      });
      for (const lead of leads) {
        if (lead.lastRepliedAt && lead.lastRepliedAt >= lead.lastContactAt!) continue;
        const silentDays = (now.getTime() - lead.lastContactAt!.getTime()) / DAY;
        if (silentDays >= setting.noResponseDays) {
          const scored = await this.prisma.crmLeadScoreEvent.count({
            where: {
              leadId: lead.id,
              signal: 'NO_RESPONSE',
              createdAt: { gte: lead.lastContactAt! },
            },
          });
          if (!scored) await this.scoring.apply(lead.id, 'NO_RESPONSE');
        }
        for (const automation of automations) {
          const wanted =
            (automation.triggerConfig as { days?: number })?.days ?? setting.noResponseDays;
          if (silentDays < wanted) continue;
          const already = await this.prisma.crmAutomationEnrollment.count({
            where: {
              automationId: automation.id,
              leadId: lead.id,
              startedAt: { gte: lead.lastContactAt! },
            },
          });
          if (!already)
            await this.engine.enroll(
              automation,
              { leadId: lead.id },
              `No response for ${wanted} days`,
            );
        }
      }
    }
  }

  /** Leads gone quiet for the dealer's "inactive" days: score down once, CUSTOMER_INACTIVE automations. */
  private async inactivity(now: Date) {
    const settings = await this.prisma.crmSettings.findMany({
      select: { dealerId: true, inactiveDays: true },
    });
    for (const setting of settings) {
      const automations = await this.prisma.crmAutomation.findMany({
        where: {
          scope: 'DEALER',
          dealerId: setting.dealerId,
          trigger: 'CUSTOMER_INACTIVE',
          isActive: true,
        },
      });
      const days = Math.min(
        setting.inactiveDays,
        ...automations.map(
          (a) => (a.triggerConfig as { days?: number })?.days ?? setting.inactiveDays,
        ),
      );
      const leads = await this.prisma.crmLead.findMany({
        where: {
          dealerId: setting.dealerId,
          mergedIntoId: null,
          status: { kind: { in: ['OPEN', 'NURTURE', 'UNRESPONSIVE', 'WON'] } },
          lastActivityAt: { lte: new Date(now.getTime() - days * DAY) },
        },
        select: { id: true, lastActivityAt: true, status: { select: { kind: true } } },
        take: 500,
      });
      for (const lead of leads) {
        const quietDays = (now.getTime() - lead.lastActivityAt!.getTime()) / DAY;
        if (quietDays >= setting.inactiveDays && lead.status.kind !== 'WON') {
          const scored = await this.prisma.crmLeadScoreEvent.count({
            where: {
              leadId: lead.id,
              signal: 'LONG_INACTIVITY',
              createdAt: { gte: lead.lastActivityAt! },
            },
          });
          if (!scored) await this.scoring.apply(lead.id, 'LONG_INACTIVITY');
        }
        for (const automation of automations) {
          const wanted =
            (automation.triggerConfig as { days?: number })?.days ?? setting.inactiveDays;
          if (quietDays < wanted) continue;
          const already = await this.prisma.crmAutomationEnrollment.count({
            where: {
              automationId: automation.id,
              leadId: lead.id,
              startedAt: { gte: lead.lastActivityAt! },
            },
          });
          if (!already)
            await this.engine.enroll(
              automation,
              { leadId: lead.id },
              `Inactive for ${wanted} days`,
            );
        }
      }
    }
  }

  private async overdueTasks(now: Date) {
    const tasks = await this.prisma.crmTask.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueAt: { lt: now },
        overdueNotifiedAt: null,
      },
      select: { id: true, title: true, dealerId: true, leadId: true, assignedToId: true },
      take: 500,
    });
    for (const task of tasks) {
      const claimed = await this.prisma.crmTask.updateMany({
        where: { id: task.id, overdueNotifiedAt: null },
        data: { overdueNotifiedAt: now },
      });
      if (!claimed.count) continue;
      await this.notify.notify(task.assignedToId, 'TASK_OVERDUE', {
        title: `Overdue: ${task.title}`,
        body: 'This task is past its due time.',
        link: task.leadId ? `/dealer/crm/leads/${task.leadId}` : '/dealer/crm/tasks',
      });
      if (task.leadId) {
        await this.engine.trigger('TASK_OVERDUE', {
          scope: 'DEALER',
          dealerId: task.dealerId,
          leadId: task.leadId,
        });
      }
    }
  }

  private async taskReminders(now: Date) {
    const tasks = await this.prisma.crmTask.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        reminderAt: { lte: now },
        reminderSentAt: null,
      },
      select: { id: true, title: true, leadId: true, assignedToId: true, dueAt: true },
      take: 500,
    });
    for (const task of tasks) {
      const claimed = await this.prisma.crmTask.updateMany({
        where: { id: task.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (!claimed.count) continue;
      await this.notify.notify(task.assignedToId, 'TASK_ASSIGNED', {
        title: `Reminder: ${task.title}`,
        body: task.dueAt
          ? `Due ${task.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`
          : 'Reminder.',
        link: task.leadId ? `/dealer/crm/leads/${task.leadId}` : '/dealer/crm/tasks',
      });
    }
  }

  /** Tells the salesperson an appointment is coming up, at its reminder time. */
  private async appointmentReminders(now: Date) {
    const upcoming = await this.prisma.crmAppointment.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        reminderSentAt: null,
        reminderMinutes: { not: null },
        startsAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY) },
      },
      select: {
        id: true,
        leadId: true,
        salespersonId: true,
        startsAt: true,
        reminderMinutes: true,
        type: true,
      },
      take: 500,
    });
    for (const appointment of upcoming) {
      if (
        appointment.startsAt.getTime() - (appointment.reminderMinutes ?? 0) * 60_000 >
        now.getTime()
      )
        continue;
      const claimed = await this.prisma.crmAppointment.updateMany({
        where: { id: appointment.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (!claimed.count) continue;
      await this.notify.notify(appointment.salespersonId, 'APPOINTMENT_UPCOMING', {
        title: `${appointment.type.replace(/_/g, ' ').toLowerCase()} coming up`,
        body: `Starts ${appointment.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        link: `/dealer/crm/leads/${appointment.leadId}`,
      });
    }
  }

  /** Tickets waiting on the requester past the support desk's reminder days: TICKET_WAITING automations. */
  private async waitingTickets(now: Date) {
    const settings = await this.prisma.supportSettings.findUnique({ where: { id: 1 } });
    if (!settings) return;
    const automations = await this.prisma.crmAutomation.findMany({
      where: { scope: 'SUPPORT', dealerId: null, trigger: 'TICKET_WAITING', isActive: true },
    });
    if (!automations.length) return;
    const days = Math.min(
      ...automations.map(
        (a) => (a.triggerConfig as { days?: number })?.days ?? settings.waitingReminderDays,
      ),
    );
    const tickets = await this.prisma.supportTicket.findMany({
      where: {
        status: 'WAITING_FOR_USER',
        waitingSince: { lte: new Date(now.getTime() - days * DAY) },
      },
      select: { id: true, waitingSince: true },
      take: 500,
    });
    for (const ticket of tickets) {
      for (const automation of automations) {
        const wanted =
          (automation.triggerConfig as { days?: number })?.days ?? settings.waitingReminderDays;
        if (now.getTime() - ticket.waitingSince!.getTime() < wanted * DAY) continue;
        const already = await this.prisma.crmAutomationEnrollment.count({
          where: {
            automationId: automation.id,
            ticketId: ticket.id,
            startedAt: { gte: ticket.waitingSince! },
          },
        });
        if (!already)
          await this.engine.enroll(automation, { ticketId: ticket.id }, `Waiting ${wanted} days`);
      }
    }
  }

  private async autoCloseTickets(now: Date) {
    const settings = await this.prisma.supportSettings.findUnique({ where: { id: 1 } });
    if (!settings) return;
    const tickets = await this.prisma.supportTicket.findMany({
      where: {
        status: 'RESOLVED',
        resolvedAt: { lte: new Date(now.getTime() - settings.autoCloseDays * DAY) },
      },
      select: { id: true },
      take: 200,
    });
    for (const ticket of tickets) await this.tickets.setStatus(SYSTEM_ACTOR, ticket.id, 'CLOSED');
  }

  private async adminTaskReminders(now: Date) {
    const tasks = await this.prisma.adminTask.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        reminderSentAt: null,
        OR: [{ reminderAt: { lte: now } }, { reminderAt: null, dueAt: { lt: now } }],
      },
      select: { id: true, title: true, assignedToId: true, ticketId: true },
      take: 200,
    });
    for (const task of tasks) {
      const claimed = await this.prisma.adminTask.updateMany({
        where: { id: task.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (!claimed.count) continue;
      await this.notify.notify(task.assignedToId, 'TICKET_UPDATED', {
        title: `Task reminder: ${task.title}`,
        body: 'An admin task needs attention.',
        link: task.ticketId ? `/admin/crm/tickets/${task.ticketId}` : '/admin/crm/tasks',
      });
    }
  }
}
