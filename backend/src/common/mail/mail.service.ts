import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. HTML templating is deliberately out of scope for now. */
  text: string;
  /** Where a reply goes, when not back to `from` — the sender of a Contact-page message. */
  replyTo?: string;
}

/**
 * Transactional email.
 *
 * The `log` driver writes messages to the server log, which is what development
 * uses — it means verification and reset flows are fully testable without an
 * SMTP account. Production sets `MAIL_DRIVER=smtp`.
 *
 * Sending never throws: a failed email must not fail the request that triggered
 * it. Callers that need delivery guarantees should enqueue instead.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly driver: 'log' | 'smtp';
  private readonly from: string;
  private readonly appUrl: string;
  /**
   * Whether the log driver may print message bodies. Bodies carry one-time
   * verification and password-reset links, so in production — where logs are
   * shipped, retained and read by more people than the account holder — only
   * the envelope is written.
   */
  private readonly logBodies: boolean;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.driver = this.config.get('MAIL_DRIVER', { infer: true });
    this.from = this.config.get('MAIL_FROM', { infer: true });
    this.appUrl = this.config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    this.logBodies = this.config.get('NODE_ENV', { infer: true }) !== 'production';
    if (this.driver === 'log' && !this.logBodies) {
      this.logger.warn(
        'MAIL_DRIVER=log in production: no email will be delivered. Set MAIL_DRIVER=smtp.',
      );
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (this.driver === 'log') {
      if (!this.logBodies) {
        this.logger.warn(`Email not sent (MAIL_DRIVER=log): "${message.subject}"`);
        return;
      }
      this.logger.log(
        `\n--- email (${this.from} -> ${message.to}) ---\n` +
          (message.replyTo ? `Reply-To: ${message.replyTo}\n` : '') +
          `Subject: ${message.subject}\n\n${message.text}\n--- end ---`,
      );
      return;
    }

    try {
      const transport = await this.transport();
      await transport.sendMail({ from: this.from, ...message });
    } catch (error) {
      this.logger.error(`Failed to send email "${message.subject}": ${String(error)}`);
    }
  }

  private transporter?: Promise<import('nodemailer').Transporter>;

  /** One pooled SMTP connection for the process, rather than a handshake per email. */
  private transport(): Promise<import('nodemailer').Transporter> {
    this.transporter ??= import('nodemailer')
      // nodemailer is loaded lazily so the log driver carries no SMTP dependency.
      .then(({ createTransport }) =>
        createTransport({
          pool: true,
          host: this.config.get('SMTP_HOST', { infer: true }),
          port: this.config.get('SMTP_PORT', { infer: true }),
          secure: this.config.get('SMTP_PORT', { infer: true }) === 465,
          auth: {
            user: this.config.get('SMTP_USER', { infer: true }),
            pass: this.config.get('SMTP_PASSWORD', { infer: true }),
          },
        }),
      )
      .catch((error: unknown) => {
        this.transporter = undefined;
        throw error;
      });
    return this.transporter;
  }

  async sendEmailVerification(to: string, token: string, firstName: string): Promise<void> {
    const link = `${this.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send({
      to,
      subject: 'Verify your Vintrax account',
      text:
        `Hi ${firstName},\n\n` +
        `Confirm your email address to finish setting up your Vintrax account:\n\n${link}\n\n` +
        `This link expires in 24 hours. If you did not create an account, ignore this message.`,
    });
  }

  async sendPasswordReset(to: string, token: string, firstName: string): Promise<void> {
    const link = `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send({
      to,
      subject: 'Reset your Vintrax password',
      text:
        `Hi ${firstName},\n\n` +
        `Use this link to choose a new password:\n\n${link}\n\n` +
        `This link expires in 1 hour and can be used once. ` +
        `If you did not request a reset, you can ignore this message — your password is unchanged.`,
    });
  }

  async sendOutbidNotice(
    to: string,
    firstName: string,
    vehicleTitle: string,
    auctionId: string,
    currentBidCad: number,
  ): Promise<void> {
    const link = `${this.appUrl}/auctions/${auctionId}`;
    await this.send({
      to,
      subject: `You have been outbid on ${vehicleTitle}`,
      text:
        `Hi ${firstName},\n\n` +
        `Someone has placed a higher bid on ${vehicleTitle}. ` +
        `The current bid is $${currentBidCad.toLocaleString('en-CA')}.\n\n${link}`,
    });
  }
}
