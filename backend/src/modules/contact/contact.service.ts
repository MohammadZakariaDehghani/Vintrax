import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type {
  ContactMessage,
  ContactMessageInput,
  Paginated,
  PaginationQuery,
} from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { CrmEvents } from '../crm/events/crm-events.service';

/** Header fields come from a visitor; a line break in one must not start a new header. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Optional() private readonly crmEvents?: CrmEvents,
  ) {}

  /**
   * Keeps the message, then emails it to the address set on the admin
   * Contact settings (or, failing that, the public contact email).
   *
   * Stored first so nothing is lost to a mail outage or an SMTP server that
   * was never configured: an administrator can always read it under Admin →
   * Contact. The email's Reply-To is the sender, so answering it in a mail
   * client answers them.
   *
   * A filled honeypot is a bot. It is dropped without an error, so the bot
   * has nothing to learn from the response.
   */
  async submit(input: ContactMessageInput): Promise<void> {
    if (input.website) {
      this.logger.warn('Dropped a Contact-form message with the honeypot field filled');
      return;
    }

    const saved = await this.prisma.contactMessage.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        subject: input.subject,
        message: input.message,
      },
    });
    // Every message also opens a support ticket in the Admin CRM.
    this.crmEvents?.contactMessageReceived(saved.id);

    const settings = await this.prisma.siteSettings.findUnique({
      where: { id: 1 },
      select: { contactRecipient: true, contactEmail: true },
    });
    const recipient = settings?.contactRecipient ?? settings?.contactEmail ?? null;
    if (!recipient) {
      this.logger.warn(
        `Contact message ${saved.id} was stored but not emailed: no recipient is set under Admin → Contact`,
      );
      return;
    }

    // Reply-To is the visitor's own (validated) address, so answering reaches
    // them; the sender is always the platform's verified address.
    await this.mail.sendTemplate(
      'contact.message',
      recipient,
      {
        name: singleLine(input.name),
        email: input.email,
        phone: input.phone ? singleLine(input.phone) : null,
        subject: singleLine(input.subject),
        message: input.message,
      },
      { replyTo: input.email, related: { type: 'ContactMessage', id: saved.id } },
    );
  }

  async list(query: PaginationQuery): Promise<Paginated<ContactMessage>> {
    const [total, rows] = await Promise.all([
      this.prisma.contactMessage.count(),
      this.prisma.contactMessage.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        subject: row.subject,
        message: row.message,
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.contactMessage.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Message not found');
  }
}
