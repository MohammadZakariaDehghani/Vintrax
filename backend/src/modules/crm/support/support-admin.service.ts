import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminTaskInput, SupportSettingsInput } from '@vintrax/shared';
import type { CrmTaskStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { adminTaskListQuerySchema, supportCategorySchema, supportTeamSchema } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { supportAudit } from '../core/audit';
import { CrmNotifyService } from '../core/notify.service';
import { CrmSetupService } from '../core/setup.service';
import type { SupportActor } from './tickets.service';

type AdminTaskQuery = z.infer<typeof adminTaskListQuerySchema>;
const person = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

/** Admin tasks and the support desk's settings: categories, teams, SLA targets. */
@Injectable()
export class SupportAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: CrmNotifyService,
    private readonly setup: CrmSetupService,
  ) {}

  // --- Admin tasks --------------------------------------------------------------------

  async listTasks(query: AdminTaskQuery, actorId: string) {
    const now = new Date();
    const open = { in: ['OPEN', 'IN_PROGRESS'] as CrmTaskStatus[] };
    const where: Prisma.AdminTaskWhereInput = {
      ...(query.view === 'OPEN' ? { status: open } : {}),
      ...(query.view === 'MINE' ? { status: open, assignedToId: actorId } : {}),
      ...(query.view === 'OVERDUE' ? { status: open, dueAt: { lt: now } } : {}),
      ...(query.view === 'COMPLETED' ? { status: 'COMPLETED' } : {}),
      ...(query.ticketId ? { ticketId: query.ticketId } : {}),
      ...(query.dealerId ? { dealerId: query.dealerId } : {}),
      ...(query.subjectUserId ? { subjectUserId: query.subjectUserId } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.adminTask.count({ where }),
      this.prisma.adminTask.findMany({
        where,
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { assignedTo: person, ticket: { select: { id: true, number: true, subject: true } } },
      }),
    ]);
    return {
      items: items.map((task) => ({
        ...task,
        overdue: (task.status === 'OPEN' || task.status === 'IN_PROGRESS') && !!task.dueAt && task.dueAt < now,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async createTask(actor: SupportActor & { id: string }, input: AdminTaskInput) {
    await this.checkTaskRefs(input);
    const task = await this.prisma.adminTask.create({
      data: { ...input, completedAt: input.status === 'COMPLETED' ? new Date() : null, createdById: actor.id },
    });
    await supportAudit(this.prisma, actor, { action: 'admin_task.created', entityType: 'AdminTask', entityId: task.id, dealerId: task.dealerId, after: input });
    if (task.assignedToId && task.assignedToId !== actor.id) {
      await this.notify.notify(task.assignedToId, 'TASK_ASSIGNED', {
        title: `New admin task: ${task.title}`,
        body: task.description ?? '',
        link: '/admin/crm/tasks',
      });
    }
    if (task.ticketId) {
      await this.prisma.supportTicketEvent.create({
        data: { ticketId: task.ticketId, actorId: actor.id, type: 'TASK_CREATED', detail: task.title },
      });
    }
    return task;
  }

  async updateTask(actor: SupportActor & { id: string }, id: string, input: AdminTaskInput) {
    const task = await this.prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    await this.checkTaskRefs(input);
    const updated = await this.prisma.adminTask.update({
      where: { id },
      data: {
        ...input,
        completedAt: input.status === 'COMPLETED' ? (task.completedAt ?? new Date()) : null,
        reminderSentAt: input.reminderAt?.getTime() !== task.reminderAt?.getTime() ? null : undefined,
      },
    });
    await supportAudit(this.prisma, actor, {
      action: 'admin_task.updated',
      entityType: 'AdminTask',
      entityId: id,
      dealerId: task.dealerId,
      before: { status: task.status, assignedToId: task.assignedToId },
      after: { status: input.status, assignedToId: input.assignedToId },
    });
    return updated;
  }

  async deleteTask(actor: SupportActor, id: string) {
    const task = await this.prisma.adminTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.adminTask.delete({ where: { id } });
    await supportAudit(this.prisma, actor, { action: 'admin_task.deleted', entityType: 'AdminTask', entityId: id, before: { title: task.title } });
  }

  private async checkTaskRefs(input: AdminTaskInput) {
    if (input.assignedToId) {
      const user = await this.prisma.user.findUnique({ where: { id: input.assignedToId }, select: { role: true } });
      if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
        throw new BadRequestException('Admin tasks go to administrators');
      }
    }
    if (input.ticketId && !(await this.prisma.supportTicket.findUnique({ where: { id: input.ticketId }, select: { id: true } }))) {
      throw new BadRequestException('Unknown ticket');
    }
    if (input.dealerId && !(await this.prisma.dealer.findUnique({ where: { id: input.dealerId }, select: { id: true } }))) {
      throw new BadRequestException('Unknown dealer');
    }
    if (input.subjectUserId && !(await this.prisma.user.findUnique({ where: { id: input.subjectUserId }, select: { id: true } }))) {
      throw new BadRequestException('Unknown user');
    }
  }

  // --- Settings ---------------------------------------------------------------------------

  async settings() {
    await this.setup.ensureSupport();
    const [settings, categories, teams, admins] = await Promise.all([
      this.prisma.supportSettings.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.supportCategory.findMany({ orderBy: { position: 'asc' }, include: { _count: { select: { tickets: true } } } }),
      this.prisma.supportTeam.findMany({ orderBy: { name: 'asc' } }),
      this.admins(),
    ]);
    return { settings, categories, teams, admins };
  }

  admins() {
    return this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });
  }

  async updateSettings(actor: SupportActor, input: SupportSettingsInput) {
    if (input.defaultTeamId && !(await this.prisma.supportTeam.findUnique({ where: { id: input.defaultTeamId } }))) {
      throw new BadRequestException('Unknown team');
    }
    const before = await this.prisma.supportSettings.findUniqueOrThrow({ where: { id: 1 } });
    const after = await this.prisma.supportSettings.update({ where: { id: 1 }, data: input });
    await supportAudit(this.prisma, actor, { action: 'support_settings.updated', entityType: 'SupportSettings', before, after: input });
    return after;
  }

  async createCategory(actor: SupportActor, input: z.infer<typeof supportCategorySchema>) {
    const key = input.key ?? input.label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const last = await this.prisma.supportCategory.aggregate({ _max: { position: true } });
    try {
      const category = await this.prisma.supportCategory.create({
        data: { key, label: input.label, isActive: input.isActive, position: (last._max.position ?? -1) + 1 },
      });
      await supportAudit(this.prisma, actor, { action: 'support_category.created', entityType: 'SupportCategory', entityId: category.id, after: input });
      return category;
    } catch {
      throw new ConflictException('That category already exists');
    }
  }

  async updateCategory(actor: SupportActor, id: string, input: z.infer<typeof supportCategorySchema>) {
    const category = await this.prisma.supportCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    await supportAudit(this.prisma, actor, { action: 'support_category.updated', entityType: 'SupportCategory', entityId: id, after: input });
    return this.prisma.supportCategory.update({ where: { id }, data: { label: input.label, isActive: input.isActive } });
  }

  async createTeam(actor: SupportActor, input: z.infer<typeof supportTeamSchema>) {
    await this.checkMembers(input.memberIds);
    try {
      const team = await this.prisma.supportTeam.create({ data: input });
      await supportAudit(this.prisma, actor, { action: 'support_team.created', entityType: 'SupportTeam', entityId: team.id, after: input });
      return team;
    } catch {
      throw new ConflictException('A team with that name already exists');
    }
  }

  async updateTeam(actor: SupportActor, id: string, input: z.infer<typeof supportTeamSchema>) {
    const team = await this.prisma.supportTeam.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');
    await this.checkMembers(input.memberIds);
    await supportAudit(this.prisma, actor, { action: 'support_team.updated', entityType: 'SupportTeam', entityId: id, before: team, after: input });
    return this.prisma.supportTeam.update({ where: { id }, data: input });
  }

  private async checkMembers(ids: string[]) {
    if (!ids.length) return;
    const admins = await this.prisma.user.count({ where: { id: { in: ids }, role: { in: ['ADMIN', 'SUPER_ADMIN'] } } });
    if (admins !== new Set(ids).size) throw new BadRequestException('Teams are made of administrators');
  }
}
