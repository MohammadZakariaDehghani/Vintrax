import { Injectable, Logger } from '@nestjs/common';
import type { CrmNotificationEvent, NotificationType } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailService } from '../../../common/mail/mail.service';
import { NotificationsService } from '../../notifications/notifications.service';

const NOTIFICATION_TYPE: Record<CrmNotificationEvent, NotificationType> = {
  LEAD_ASSIGNED: 'CRM_LEAD',
  LEAD_REPLIED: 'CRM_LEAD',
  TASK_ASSIGNED: 'CRM_TASK',
  TASK_OVERDUE: 'CRM_TASK',
  APPOINTMENT_UPCOMING: 'CRM_APPOINTMENT',
  TICKET_ASSIGNED: 'SUPPORT_TICKET',
  TICKET_UPDATED: 'SUPPORT_TICKET',
  TICKET_ESCALATED: 'SUPPORT_TICKET',
};

/**
 * CRM notifications through the platform's notification system, honouring
 * each person's CRM preferences (CRM → Settings → Notifications): in the app
 * by default, by email when they ask for it.
 */
@Injectable()
export class CrmNotifyService {
  private readonly logger = new Logger(CrmNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  async notify(
    userId: string | null | undefined,
    event: CrmNotificationEvent,
    message: { title: string; body: string; link?: string | null },
  ): Promise<void> {
    if (!userId) return;
    try {
      const preference = await this.prisma.crmNotificationPreference.findUnique({
        where: { userId_event: { userId, event } },
      });
      const inApp = preference?.inApp ?? true;
      const email = preference?.email ?? false;
      if (inApp) {
        await this.notifications.notify({
          userId,
          type: NOTIFICATION_TYPE[event],
          title: message.title,
          body: message.body,
          link: message.link ?? null,
          email,
        });
      } else if (email) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true },
        });
        if (user) {
          await this.mail.send({
            to: user.email,
            subject: message.title,
            text: `Hi ${user.firstName},\n\n${message.body}`,
          });
        }
      }
    } catch (error) {
      // A notification is a courtesy; it must never fail the work behind it.
      this.logger.warn(`CRM notification ${event} failed: ${String(error)}`);
    }
  }
}
