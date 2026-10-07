import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPOINTMENT_TYPES,
  type AppointmentInput,
  type AppointmentStatus,
  type CrmRecurrence,
  type CrmTaskStatus,
  type TaskInput,
  type TaskListQuery,
} from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit } from '../core/audit';
import { CrmBus } from '../core/bus';
import { can, leadScope, type CrmContext } from '../core/context';
import { CrmNotifyService } from '../core/notify.service';
import { addDaysLocal, startOfLocalDay } from '../core/time';
import { AssignmentService } from '../leads/assignment.service';
import { LeadsService } from '../leads/leads.service';
import { ScoringService } from '../leads/scoring.service';
import { recordTimeline } from '../leads/timeline';

const person = { select: { id: true, firstName: true, lastName: true } } as const;

const APPOINTMENT_LABEL: Record<(typeof APPOINTMENT_TYPES)[number], string> = {
  TEST_DRIVE: 'Test drive',
  VEHICLE_VIEWING: 'Vehicle viewing',
  SALES_MEETING: 'Sales meeting',
  TRADE_IN_APPRAISAL: 'Trade-in appraisal',
  FINANCE_MEETING: 'Finance meeting',
  DELIVERY: 'Delivery',
  OTHER: 'Appointment',
};

/**
 * Tasks, appointments and the calendar. A salesperson sees and works their
 * own; a manager sees everyone's.
 */
@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly scoring: ScoringService,
    private readonly assignment: AssignmentService,
    private readonly notify: CrmNotifyService,
    private readonly bus: CrmBus,
  ) {}

  // --- Tasks -----------------------------------------------------------------------

  private taskScope(ctx: CrmContext): Prisma.CrmTaskWhereInput {
    if (can(ctx, 'crm.all_leads')) return { dealerId: ctx.dealerId };
    return { dealerId: ctx.dealerId, OR: [{ assignedToId: ctx.userId }, { createdById: ctx.userId }] };
  }

  async listTasks(ctx: CrmContext, query: TaskListQuery) {
    const timezone = await this.leads.timezone(ctx.dealerId);
    const now = new Date();
    const start = startOfLocalDay(now, timezone);
    const end = addDaysLocal(start, 1, timezone);
    const open = { in: ['OPEN', 'IN_PROGRESS'] as CrmTaskStatus[] };
    const and: Prisma.CrmTaskWhereInput[] = [this.taskScope(ctx)];
    switch (query.view) {
      case 'OPEN':
        and.push({ status: open });
        break;
      case 'TODAY':
        and.push({ status: open, dueAt: { gte: start, lt: end } });
        break;
      case 'OVERDUE':
        and.push({ status: open, dueAt: { lt: now } });
        break;
      case 'UPCOMING':
        and.push({ status: open, dueAt: { gte: end } });
        break;
      case 'COMPLETED':
        and.push({ status: 'COMPLETED' });
        break;
      default:
        break;
    }
    if (query.assignedToId === 'me') and.push({ assignedToId: ctx.userId });
    else if (query.assignedToId === 'unassigned') and.push({ assignedToId: null });
    else if (query.assignedToId) and.push({ assignedToId: query.assignedToId });
    if (query.leadId) and.push({ leadId: query.leadId });
    if (query.priority) and.push({ priority: query.priority });
    const where = { AND: and };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.crmTask.count({ where }),
      this.prisma.crmTask.findMany({
        where,
        orderBy:
          query.view === 'COMPLETED'
            ? [{ completedAt: 'desc' }]
            : [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          assignedTo: person,
          lead: { select: { id: true, number: true, firstName: true, lastName: true, phone: true, email: true } },
        },
      }),
    ]);
    return {
      items: items.map((task) => ({ ...task, overdue: isOverdue(task, now) })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async createTask(ctx: CrmContext, input: TaskInput) {
    if (input.leadId) await this.leads.findVisible(ctx, input.leadId);
    const assignedToId = await this.resolveAssignee(ctx, input.assignedToId ?? ctx.userId);
    const task = await this.prisma.$transaction(async (tx) => {
      const row = await tx.crmTask.create({
        data: {
          dealerId: ctx.dealerId,
          leadId: input.leadId,
          title: input.title,
          description: input.description,
          assignedToId,
          vehicleId: input.vehicleId,
          dueAt: input.dueAt,
          priority: input.priority,
          status: input.status,
          reminderAt: input.reminderAt,
          recurrence: input.recurrence,
          completedAt: input.status === 'COMPLETED' ? new Date() : null,
          createdById: ctx.system ? null : ctx.userId,
        },
      });
      if (row.leadId) {
        await recordTimeline(tx, {
          dealerId: ctx.dealerId,
          leadId: row.leadId,
          type: 'TASK_CREATED',
          title: row.title,
          userId: ctx.system ? null : ctx.userId,
          metadata: { taskId: row.id, dueAt: row.dueAt?.toISOString() ?? null },
        });
        if (row.dueAt) await this.pullFollowUp(tx, row.leadId);
      }
      return row;
    });
    if (assignedToId && assignedToId !== ctx.userId) {
      await this.notify.notify(assignedToId, 'TASK_ASSIGNED', {
        title: `New task: ${task.title}`,
        body: task.dueAt ? `Due ${task.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.` : 'No due date.',
        link: '/dealer/crm/tasks',
      });
    }
    return task;
  }

  async updateTask(ctx: CrmContext, id: string, input: TaskInput) {
    const task = await this.findTask(ctx, id);
    if (input.leadId && input.leadId !== task.leadId) await this.leads.findVisible(ctx, input.leadId);
    const assignedToId =
      input.assignedToId && input.assignedToId !== task.assignedToId
        ? await this.resolveAssignee(ctx, input.assignedToId)
        : input.assignedToId;
    await this.prisma.crmTask.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        leadId: input.leadId,
        assignedToId,
        vehicleId: input.vehicleId,
        dueAt: input.dueAt,
        priority: input.priority,
        reminderAt: input.reminderAt,
        reminderSentAt: input.reminderAt?.getTime() !== task.reminderAt?.getTime() ? null : undefined,
        overdueNotifiedAt: input.dueAt?.getTime() !== task.dueAt?.getTime() ? null : undefined,
        recurrence: input.recurrence,
      },
    });
    if (input.status !== task.status) await this.setTaskStatus(ctx, id, input.status);
    if (task.leadId) await this.pullFollowUp(this.prisma, task.leadId);
    return this.findTask(ctx, id);
  }

  /**
   * Completing a repeating task opens the next one; completing any task
   * records it on the lead's timeline.
   */
  async setTaskStatus(ctx: CrmContext, id: string, status: CrmTaskStatus) {
    const task = await this.findTask(ctx, id);
    if (task.status === status) return task;
    await this.prisma.$transaction(async (tx) => {
      await tx.crmTask.update({
        where: { id },
        data: { status, completedAt: status === 'COMPLETED' ? new Date() : null },
      });
      if (status === 'COMPLETED' && task.leadId) {
        await recordTimeline(tx, {
          dealerId: ctx.dealerId,
          leadId: task.leadId,
          type: 'TASK_COMPLETED',
          title: task.title,
          userId: ctx.system ? null : ctx.userId,
          metadata: { taskId: id },
        });
      }
      if (status === 'COMPLETED' && task.recurrence !== 'NONE' && task.dueAt) {
        const nextDue = nextOccurrence(task.dueAt, task.recurrence);
        await tx.crmTask.create({
          data: {
            dealerId: task.dealerId,
            leadId: task.leadId,
            title: task.title,
            description: task.description,
            assignedToId: task.assignedToId,
            vehicleId: task.vehicleId,
            priority: task.priority,
            recurrence: task.recurrence,
            dueAt: nextDue,
            reminderAt: task.reminderAt
              ? new Date(nextDue.getTime() - (task.dueAt.getTime() - task.reminderAt.getTime()))
              : null,
            createdById: task.createdById,
          },
        });
      }
      if (task.leadId) await this.pullFollowUp(tx, task.leadId);
    });
    return this.findTask(ctx, id);
  }

  async deleteTask(ctx: CrmContext, id: string) {
    const task = await this.findTask(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.crmTask.delete({ where: { id } });
      await crmAudit(tx, ctx, { action: 'task.deleted', entityType: 'CrmTask', entityId: id, before: { title: task.title } });
      if (task.leadId) await this.pullFollowUp(tx, task.leadId);
    });
  }

  private async findTask(ctx: CrmContext, id: string) {
    const task = await this.prisma.crmTask.findFirst({
      where: { id, ...this.taskScope(ctx) },
      include: {
        assignedTo: person,
        lead: { select: { id: true, number: true, firstName: true, lastName: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /** The lead's next follow-up is its earliest open task with a due date. */
  async pullFollowUp(db: Prisma.TransactionClient, leadId: string) {
    const next = await db.crmTask.findFirst({
      where: { leadId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { not: null } },
      orderBy: { dueAt: 'asc' },
      select: { dueAt: true },
    });
    await db.crmLead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
  }

  private async resolveAssignee(ctx: CrmContext, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    if (userId !== ctx.userId && !can(ctx, 'crm.manage') && !ctx.system) {
      throw new ForbiddenException('Only a manager can give tasks to someone else');
    }
    if (!(await this.assignment.isSalesStaff(this.prisma, ctx.dealerId, userId)) && userId !== ctx.userId) {
      throw new BadRequestException('That person is not on this dealership’s staff');
    }
    return userId;
  }

  // --- Appointments ------------------------------------------------------------------

  private appointmentScope(ctx: CrmContext): Prisma.CrmAppointmentWhereInput {
    if (can(ctx, 'crm.all_leads')) return { dealerId: ctx.dealerId };
    return {
      dealerId: ctx.dealerId,
      OR: [{ salespersonId: ctx.userId }, { lead: leadScope(ctx) }],
    };
  }

  async listAppointments(ctx: CrmContext, range: { from: Date; to: Date; salespersonId?: string | null }) {
    return this.prisma.crmAppointment.findMany({
      where: {
        ...this.appointmentScope(ctx),
        startsAt: { lt: range.to },
        endsAt: { gt: range.from },
        ...(range.salespersonId ? { salespersonId: range.salespersonId } : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
      include: {
        salesperson: person,
        vehicle: { select: { id: true, title: true } },
        lead: { select: { id: true, number: true, firstName: true, lastName: true, phone: true } },
      },
    });
  }

  async createAppointment(ctx: CrmContext, input: AppointmentInput) {
    await this.leads.findVisible(ctx, input.leadId);
    await this.checkVehicle(ctx, input.vehicleId);
    const salespersonId = await this.resolveAssignee(ctx, input.salespersonId ?? ctx.userId);
    const appointment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.crmAppointment.create({
        data: {
          dealerId: ctx.dealerId,
          leadId: input.leadId,
          vehicleId: input.vehicleId,
          salespersonId,
          type: input.type,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          location: input.location,
          notes: input.notes,
          status: input.status,
          reminderMinutes: input.reminderMinutes,
          createdById: ctx.system ? null : ctx.userId,
        },
      });
      await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId: input.leadId,
        type: 'APPOINTMENT_BOOKED',
        title: `${APPOINTMENT_LABEL[input.type]} booked`,
        userId: ctx.system ? null : ctx.userId,
        vehicleId: input.vehicleId,
        metadata: { appointmentId: row.id, startsAt: row.startsAt.toISOString() },
      });
      await this.scoring.apply(input.leadId, 'APPOINTMENT_BOOKED', tx);
      // "Appointment Set" when the lead is still early in the pipeline.
      const set = await tx.crmLeadStatus.findUnique({
        where: { dealerId_key: { dealerId: ctx.dealerId, key: 'APPOINTMENT_SET' } },
      });
      if (set) {
        await tx.crmLead.updateMany({
          where: { id: input.leadId, status: { key: { in: ['NEW', 'CONTACTED', 'ENGAGED', 'QUALIFIED'] } } },
          data: { statusId: set.id },
        });
      }
      return row;
    });
    await this.bus.publish({
      type: 'APPOINTMENT_CREATED',
      scope: 'DEALER',
      dealerId: ctx.dealerId,
      leadId: input.leadId,
      appointmentId: appointment.id,
    });
    if (salespersonId && salespersonId !== ctx.userId) {
      await this.notify.notify(salespersonId, 'APPOINTMENT_UPCOMING', {
        title: `${APPOINTMENT_LABEL[input.type]} booked for you`,
        body: `Starts ${appointment.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        link: '/dealer/crm/calendar',
      });
    }
    return appointment;
  }

  async updateAppointment(ctx: CrmContext, id: string, input: AppointmentInput) {
    const appointment = await this.findAppointment(ctx, id);
    if (input.leadId !== appointment.leadId) await this.leads.findVisible(ctx, input.leadId);
    await this.checkVehicle(ctx, input.vehicleId);
    const salespersonId =
      input.salespersonId && input.salespersonId !== appointment.salespersonId
        ? await this.resolveAssignee(ctx, input.salespersonId)
        : input.salespersonId;
    const moved = input.startsAt.getTime() !== appointment.startsAt.getTime();
    await this.prisma.$transaction(async (tx) => {
      await tx.crmAppointment.update({
        where: { id },
        data: {
          leadId: input.leadId,
          vehicleId: input.vehicleId,
          salespersonId,
          type: input.type,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          location: input.location,
          notes: input.notes,
          reminderMinutes: input.reminderMinutes,
          reminderSentAt: moved ? null : undefined,
        },
      });
      if (moved) {
        await recordTimeline(tx, {
          dealerId: ctx.dealerId,
          leadId: input.leadId,
          type: 'APPOINTMENT_UPDATED',
          title: `${APPOINTMENT_LABEL[input.type]} moved`,
          userId: ctx.userId,
          metadata: { appointmentId: id, startsAt: input.startsAt.toISOString() },
        });
      }
    });
    if (input.status !== appointment.status) await this.setAppointmentStatus(ctx, id, input.status);
    return this.findAppointment(ctx, id);
  }

  async setAppointmentStatus(ctx: CrmContext, id: string, status: AppointmentStatus) {
    const appointment = await this.findAppointment(ctx, id);
    if (appointment.status === status) return appointment;
    await this.prisma.$transaction(async (tx) => {
      await tx.crmAppointment.update({ where: { id }, data: { status } });
      const completedDrive = status === 'COMPLETED' && appointment.type === 'TEST_DRIVE';
      await recordTimeline(tx, {
        dealerId: ctx.dealerId,
        leadId: appointment.leadId,
        type: completedDrive ? 'TEST_DRIVE' : 'APPOINTMENT_UPDATED',
        title: completedDrive
          ? 'Test drive completed'
          : `${APPOINTMENT_LABEL[appointment.type]} ${status.toLowerCase().replace('_', '-')}`,
        userId: ctx.system ? null : ctx.userId,
        vehicleId: appointment.vehicleId,
        metadata: { appointmentId: id, status },
      });
      if (completedDrive) {
        await this.scoring.apply(appointment.leadId, 'TEST_DRIVE', tx);
        const testDrive = await tx.crmLeadStatus.findUnique({
          where: { dealerId_key: { dealerId: ctx.dealerId, key: 'TEST_DRIVE' } },
        });
        if (testDrive) {
          await tx.crmLead.updateMany({
            where: {
              id: appointment.leadId,
              status: { key: { in: ['NEW', 'CONTACTED', 'ENGAGED', 'QUALIFIED', 'APPOINTMENT_SET'] } },
            },
            data: { statusId: testDrive.id },
          });
        }
      }
      if (status === 'COMPLETED' || status === 'NO_SHOW') {
        await this.leads.markContactedIf(
          tx,
          ctx,
          appointment.leadId,
          status === 'COMPLETED' ? 'MEETING' : 'NOTE',
          new Date(),
          appointment.lead.firstContactAt,
        );
      }
    });
    const signal = { scope: 'DEALER' as const, dealerId: ctx.dealerId, leadId: appointment.leadId, appointmentId: id };
    if (status === 'CONFIRMED') await this.bus.publish({ ...signal, type: 'APPOINTMENT_CONFIRMED' });
    if (status === 'CANCELLED') await this.bus.publish({ ...signal, type: 'APPOINTMENT_CANCELLED' });
    if (status === 'COMPLETED') {
      await this.bus.publish({ ...signal, type: 'APPOINTMENT_COMPLETED' });
      if (appointment.type === 'TEST_DRIVE') await this.bus.publish({ ...signal, type: 'TEST_DRIVE_COMPLETED' });
    }
    return this.findAppointment(ctx, id);
  }

  async deleteAppointment(ctx: CrmContext, id: string) {
    const appointment = await this.findAppointment(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.crmAppointment.delete({ where: { id } });
      await crmAudit(tx, ctx, {
        action: 'appointment.deleted',
        entityType: 'CrmAppointment',
        entityId: id,
        before: { leadId: appointment.leadId, startsAt: appointment.startsAt },
      });
    });
  }

  private async findAppointment(ctx: CrmContext, id: string) {
    const row = await this.prisma.crmAppointment.findFirst({
      where: { id, ...this.appointmentScope(ctx) },
      include: {
        salesperson: person,
        vehicle: { select: { id: true, title: true } },
        lead: { select: { id: true, number: true, firstName: true, lastName: true, firstContactAt: true } },
      },
    });
    if (!row) throw new NotFoundException('Appointment not found');
    return row;
  }

  private async checkVehicle(ctx: CrmContext, vehicleId: string | null | undefined) {
    if (!vehicleId) return;
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, sellerId: ctx.ownerUserId },
      select: { id: true },
    });
    if (!vehicle) throw new BadRequestException('That vehicle is not in your inventory');
  }

  // --- Calendar --------------------------------------------------------------------------

  /** Appointments and dated tasks between two instants, for the day, week and month views. */
  async calendar(ctx: CrmContext, range: { from: Date; to: Date; salespersonId?: string | null }) {
    const [appointments, tasks] = await Promise.all([
      this.listAppointments(ctx, range),
      this.prisma.crmTask.findMany({
        where: {
          ...this.taskScope(ctx),
          dueAt: { gte: range.from, lt: range.to },
          status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] },
          ...(range.salespersonId ? { assignedToId: range.salespersonId } : {}),
        },
        orderBy: { dueAt: 'asc' },
        take: 500,
        include: { assignedTo: person, lead: { select: { id: true, number: true, firstName: true, lastName: true } } },
      }),
    ]);
    return {
      events: [
        ...appointments.map((appointment) => ({
          kind: 'APPOINTMENT' as const,
          id: appointment.id,
          title: `${APPOINTMENT_LABEL[appointment.type]} · ${[appointment.lead.firstName, appointment.lead.lastName].filter(Boolean).join(' ')}`,
          type: appointment.type,
          status: appointment.status,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          leadId: appointment.leadId,
          person: appointment.salesperson,
          location: appointment.location,
        })),
        ...tasks.map((task) => ({
          kind: 'TASK' as const,
          id: task.id,
          title: task.title,
          type: task.priority,
          status: task.status,
          startsAt: task.dueAt!,
          endsAt: task.dueAt!,
          leadId: task.leadId,
          person: task.assignedTo,
          location: null,
        })),
      ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    };
  }
}

export function isOverdue(task: { status: string; dueAt: Date | null }, now = new Date()): boolean {
  return (task.status === 'OPEN' || task.status === 'IN_PROGRESS') && !!task.dueAt && task.dueAt < now;
}

export function nextOccurrence(due: Date, recurrence: CrmRecurrence): Date {
  const next = new Date(due);
  if (recurrence === 'DAILY') next.setUTCDate(next.getUTCDate() + 1);
  else if (recurrence === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
  else if (recurrence === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}
