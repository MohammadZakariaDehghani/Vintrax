import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { NotificationDto, NotificationType, Paginated } from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';

export interface CreateNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  /** Also deliver by email when the user has that channel enabled. */
  email?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Creates an in-app notification and optionally emails it.
   *
   * Respects the recipient's channel preferences: a user who has turned off
   * email still gets the in-app record, and one who has turned off in-app
   * notifications gets neither.
   */
  async notify(input: CreateNotification): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, firstName: true, notificationChannels: true },
    });
    if (!user) return;

    if (user.notificationChannels.includes('IN_APP')) {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
        },
      });
    }

    if (input.email && user.notificationChannels.includes('EMAIL')) {
      await this.mail.send({
        to: user.email,
        subject: input.title,
        text: `Hi ${user.firstName},\n\n${input.body}`,
      });
    }
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
    unreadOnly = false,
  ): Promise<Paginated<NotificationDto>> {
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };

    const [total, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { unread };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async updateChannels(
    userId: string,
    channels: Array<'IN_APP' | 'EMAIL' | 'SMS'>,
  ): Promise<{ channels: string[] }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { notificationChannels: channels },
      select: { notificationChannels: true },
    });
    return { channels: user.notificationChannels };
  }
}
