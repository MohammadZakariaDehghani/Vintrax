import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { CrmEmail } from '@prisma/client';
import type { Env } from '../../../config/env';
import { MailDeliveryError, MailService } from '../../../common/mail/mail.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CrmBus } from '../core/bus';
import { CrmNotifyService } from '../core/notify.service';
import { LeadsService } from '../leads/leads.service';
import { ScoringService } from '../leads/scoring.service';
import { recordTimeline } from '../leads/timeline';
import { ComplianceService } from './compliance.service';
import { escapeHtml } from './sanitizer';
import { openPixel, trackLinks, unsubscribeUrl, verifyLink } from './tracking';

/** First retry after a minute, doubling, at most six hours apart. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60_000);
}

/**
 * Sends due emails from the outbox.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED` and a lease, so any number
 * of API processes can run the dispatcher without sending one email twice.
 * A transient failure is retried with exponential backoff; a permanent one
 * (the server refused the address) bounces and suppresses the address. A
 * claim abandoned by a crash is taken again when its lease runs out — that
 * one case is at-least-once, and is stated in the documentation.
 */
@Injectable()
export class DispatcherService {
  private readonly logger = new Logger(DispatcherService.name);
  private readonly appUrl: string;
  private readonly maxAttempts: number;
  private readonly tracking: boolean;
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly compliance: ComplianceService,
    private readonly leads: LeadsService,
    private readonly scoring: ScoringService,
    private readonly notify: CrmNotifyService,
    private readonly bus: CrmBus,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
    this.maxAttempts = config.get('CRM_EMAIL_MAX_ATTEMPTS', { infer: true });
    this.tracking = config.get('CRM_EMAIL_TRACKING', { infer: true });
    this.secret = createHash('sha256')
      .update(`crm-links:${config.get('JWT_ACCESS_SECRET', { infer: true })}`)
      .digest('hex');
  }

  get linkSecret(): string {
    return this.secret;
  }

  /** Claims and sends up to `limit` due emails. Returns how many were attempted. */
  async dispatchDue(now = new Date(), limit = 50): Promise<number> {
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "CrmEmail" SET status = 'SENDING', "lockedUntil" = ${new Date(now.getTime() + 5 * 60_000)}
      WHERE id IN (
        SELECT id FROM "CrmEmail"
        WHERE (
          (status IN ('QUEUED', 'SCHEDULED') AND "scheduledAt" <= ${now} AND "nextAttemptAt" <= ${now})
          OR (status = 'SENDING' AND "lockedUntil" < ${now})
        )
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    for (const { id } of claimed) {
      try {
        await this.sendOne(id, now);
      } catch (error) {
        this.logger.error(`Dispatching CRM email ${id} failed: ${String(error)}`);
      }
    }
    return claimed.length;
  }

  private async sendOne(id: string, now: Date): Promise<void> {
    const email = await this.prisma.crmEmail.findUniqueOrThrow({ where: { id } });
    // Consent may have been withdrawn, or the address bounced, since queueing.
    const decision = await this.compliance.canSend(email.dealerId, email.toEmail, email.purpose);
    if (!decision.allowed) {
      await this.prisma.crmEmail.update({
        where: { id },
        data: { status: 'SUPPRESSED', lastError: decision.reason, lockedUntil: null },
      });
      await this.prisma.crmEmailEvent.create({ data: { emailId: id, type: 'SUPPRESSED', detail: decision.reason } });
      return;
    }
    const attempt = email.attempts + 1;
    const message = await this.finalMessage(email);
    try {
      const receipt = await this.mail.deliver({
        to: email.toEmail,
        toName: email.toName,
        fromName: email.fromName,
        replyTo: email.replyTo,
        subject: email.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.crmEmail.update({
          where: { id },
          data: {
            status: 'SENT',
            sentAt: now,
            attempts: attempt,
            lastError: null,
            lockedUntil: null,
            provider: receipt.provider,
            providerMessageId: receipt.messageId,
          },
        });
        await tx.crmEmailEvent.create({ data: { emailId: id, type: 'SENT', detail: receipt.provider } });
        if (email.leadId && email.dealerId) {
          await recordTimeline(tx, {
            dealerId: email.dealerId,
            leadId: email.leadId,
            type: 'EMAIL_SENT',
            title: email.subject,
            userId: email.createdById,
            emailId: id,
            occurredAt: now,
            metadata: { purpose: email.purpose, automated: !!email.enrollmentId, campaign: !!email.campaignId },
          });
          // A salesperson's own email is contact; an automated one is not.
          if (email.createdById && !email.enrollmentId && !email.campaignId) {
            const lead = await tx.crmLead.findUnique({ where: { id: email.leadId }, select: { firstContactAt: true } });
            if (lead) {
              await this.leads.markContactedIf(
                tx,
                { dealerId: email.dealerId, userId: email.createdById, system: false },
                email.leadId,
                'EMAIL_SENT',
                now,
                lead.firstContactAt,
              );
            }
          }
        }
        if (email.ticketId) {
          await tx.supportTicketEvent.create({
            data: { ticketId: email.ticketId, type: 'EMAIL_SENT', detail: email.subject },
          });
        }
      });
    } catch (error) {
      const permanent = error instanceof MailDeliveryError && error.permanent;
      const detail = String((error as Error).message ?? error).slice(0, 500);
      if (permanent) {
        await this.recordBounce(email, detail, now, attempt);
        return;
      }
      const giveUp = attempt >= this.maxAttempts;
      await this.prisma.crmEmail.update({
        where: { id },
        data: {
          status: giveUp ? 'FAILED' : 'QUEUED',
          attempts: attempt,
          lastError: detail,
          lockedUntil: null,
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempt)),
        },
      });
      await this.prisma.crmEmailEvent.create({
        data: { emailId: id, type: giveUp ? 'FAILED' : 'RETRY', detail: `Attempt ${attempt}: ${detail}` },
      });
      if (giveUp && email.leadId && email.dealerId) {
        await recordTimeline(this.prisma, {
          dealerId: email.dealerId,
          leadId: email.leadId,
          type: 'EMAIL_FAILED',
          title: `Not sent: ${email.subject}`,
          notes: detail,
          emailId: id,
        });
      }
    }
  }

  /** The stored body plus tracking, the sender's identity and, for marketing, the unsubscribe link. */
  private async finalMessage(email: CrmEmail) {
    let html = email.bodyHtml;
    let text = email.bodyText;
    const headers: Record<string, string> = { 'X-Vintrax-Email': email.id };
    if (email.scope === 'DEALER' && email.dealerId) {
      const [settings, dealer] = await Promise.all([
        this.prisma.crmSettings.findUnique({ where: { dealerId: email.dealerId } }),
        this.prisma.dealer.findUniqueOrThrow({ where: { id: email.dealerId }, select: { name: true, phone: true } }),
      ]);
      const identity = [
        settings?.senderName ?? dealer.name,
        settings?.businessAddress,
        settings?.businessPhone ?? dealer.phone,
        settings?.businessEmail,
      ].filter(Boolean) as string[];
      html += `\n<hr><p style="font-size:12px;color:#666">${identity.map(escapeHtml).join(' · ')}</p>`;
      text += `\n\n--\n${identity.join(' · ')}`;
      if (email.purpose === 'MARKETING') {
        const link = unsubscribeUrl(this.appUrl, email.trackingToken);
        html += `\n<p style="font-size:12px;color:#666">You receive this because you were in touch with ${escapeHtml(dealer.name)}. <a href="${escapeHtml(link)}">Unsubscribe</a> from marketing email.</p>`;
        text += `\nUnsubscribe from marketing email: ${link}`;
        // RFC 8058 one-click unsubscribe, honoured by the major mailbox providers.
        headers['List-Unsubscribe'] = `<${this.appUrl}/api/crm/public/unsubscribe/${email.trackingToken}>`;
        headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      }
    }
    if (this.tracking && email.scope === 'DEALER') {
      html = trackLinks(html, this.appUrl, this.secret, email.trackingToken) + openPixel(this.appUrl, email.trackingToken);
    }
    return { html, text, headers };
  }

  private async recordBounce(email: CrmEmail, detail: string, now: Date, attempt: number) {
    await this.prisma.$transaction(async (tx) => {
      await tx.crmEmail.update({
        where: { id: email.id },
        data: { status: 'BOUNCED', bouncedAt: now, attempts: attempt, lastError: detail, lockedUntil: null },
      });
      await tx.crmEmailEvent.create({ data: { emailId: email.id, type: 'BOUNCED', detail } });
    });
    await this.compliance.suppress({
      dealerId: null,
      email: email.toEmail,
      reason: 'HARD_BOUNCE',
      source: `Bounced: ${detail}`.slice(0, 200),
    });
  }

  // --- Tracking and provider events -------------------------------------------------------

  async recordOpen(token: string): Promise<void> {
    const email = await this.prisma.crmEmail.findUnique({ where: { trackingToken: token } });
    if (!email || !email.sentAt) return;
    await this.prisma.crmEmailEvent.create({ data: { emailId: email.id, type: 'OPENED' } });
    if (email.openedAt) return;
    const first = await this.prisma.crmEmail.updateMany({
      where: { id: email.id, openedAt: null },
      data: { openedAt: new Date() },
    });
    if (first.count === 0 || !email.leadId || !email.dealerId) return;
    await this.prisma.$transaction(async (tx) => {
      await recordTimeline(tx, {
        dealerId: email.dealerId!,
        leadId: email.leadId!,
        type: 'EMAIL_OPENED',
        title: `Opened: ${email.subject}`,
        emailId: email.id,
      });
      await this.scoring.apply(email.leadId!, 'EMAIL_OPENED', tx);
    });
  }

  /** Records a click and returns where to send the browser, or null for a forged link. */
  async recordClick(token: string, url: string, signature: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url) || !verifyLink(this.secret, token, url, signature)) return null;
    const email = await this.prisma.crmEmail.findUnique({ where: { trackingToken: token } });
    if (!email) return url;
    await this.prisma.crmEmailEvent.create({ data: { emailId: email.id, type: 'CLICKED', detail: url.slice(0, 500) } });
    const first = await this.prisma.crmEmail.updateMany({
      where: { id: email.id, clickedAt: null },
      data: { clickedAt: new Date(), openedAt: email.openedAt ?? new Date() },
    });
    if (first.count > 0 && email.leadId && email.dealerId) {
      await this.prisma.$transaction(async (tx) => {
        await recordTimeline(tx, {
          dealerId: email.dealerId!,
          leadId: email.leadId!,
          type: 'EMAIL_CLICKED',
          title: `Clicked a link in: ${email.subject}`,
          emailId: email.id,
          metadata: { url: url.slice(0, 500) },
        });
        await this.scoring.apply(email.leadId!, 'EMAIL_CLICKED', tx);
      });
    }
    return url;
  }

  /**
   * A delivery event from a provider webhook, matched by the provider's
   * message id. Only providers that report these send them; SMTP reports a
   * refusal at sending time instead.
   */
  async providerEvent(event: {
    messageId: string;
    type: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'OPENED' | 'CLICKED' | 'REPLIED';
    detail?: string | null;
    permanent?: boolean;
  }): Promise<boolean> {
    const email = await this.prisma.crmEmail.findFirst({ where: { providerMessageId: event.messageId } });
    if (!email) return false;
    const now = new Date();
    switch (event.type) {
      case 'DELIVERED':
        await this.prisma.crmEmail.updateMany({
          where: { id: email.id, status: 'SENT' },
          data: { status: 'DELIVERED', deliveredAt: now },
        });
        await this.prisma.crmEmailEvent.create({ data: { emailId: email.id, type: 'DELIVERED', detail: event.detail } });
        break;
      case 'BOUNCED':
        if (event.permanent === false) {
          await this.prisma.crmEmailEvent.create({ data: { emailId: email.id, type: 'BOUNCED', detail: `Soft: ${event.detail ?? ''}` } });
        } else {
          await this.recordBounce(email, event.detail ?? 'Bounced', now, email.attempts);
          if (email.leadId && email.dealerId) {
            await recordTimeline(this.prisma, {
              dealerId: email.dealerId,
              leadId: email.leadId,
              type: 'EMAIL_BOUNCED',
              title: `Bounced: ${email.subject}`,
              emailId: email.id,
            });
          }
        }
        break;
      case 'COMPLAINED':
        await this.prisma.crmEmailEvent.create({ data: { emailId: email.id, type: 'COMPLAINED', detail: event.detail } });
        await this.compliance.suppress({ dealerId: null, email: email.toEmail, reason: 'COMPLAINT', source: 'Spam complaint' });
        break;
      case 'OPENED':
        await this.recordOpen(email.trackingToken);
        break;
      case 'CLICKED':
        await this.prisma.crmEmailEvent.create({ data: { emailId: email.id, type: 'CLICKED', detail: event.detail } });
        await this.prisma.crmEmail.updateMany({ where: { id: email.id, clickedAt: null }, data: { clickedAt: now } });
        break;
      case 'REPLIED':
        await this.recordReply(email.id, 'provider');
        break;
    }
    return true;
  }

  /** The customer answered this email (provider event, or logged by a salesperson). */
  async recordReply(emailId: string, source: string): Promise<void> {
    const email = await this.prisma.crmEmail.findUnique({ where: { id: emailId } });
    if (!email) return;
    const now = new Date();
    await this.prisma.crmEmail.update({ where: { id: emailId }, data: { repliedAt: email.repliedAt ?? now } });
    await this.prisma.crmEmailEvent.create({ data: { emailId, type: 'REPLIED', detail: source } });
    if (email.leadId && email.dealerId) await this.leadReplied(email.dealerId, email.leadId, `Replied to: ${email.subject}`);
  }

  /** A reply from the customer, by any channel: score it, stop sequences, tell the salesperson. */
  async leadReplied(dealerId: string, leadId: string, title: string, notes?: string | null): Promise<void> {
    const lead = await this.prisma.$transaction(async (tx) => {
      await tx.crmLead.update({ where: { id: leadId }, data: { lastRepliedAt: new Date() } });
      await recordTimeline(tx, { dealerId, leadId, type: 'CUSTOMER_REPLIED', title, notes });
      await this.scoring.apply(leadId, 'CUSTOMER_REPLIED', tx);
      // A reply means they are engaged.
      const engaged = await tx.crmLeadStatus.findUnique({ where: { dealerId_key: { dealerId, key: 'ENGAGED' } } });
      if (engaged) {
        await tx.crmLead.updateMany({
          where: { id: leadId, status: { key: { in: ['NEW', 'CONTACTED', 'UNRESPONSIVE', 'NURTURE'] } } },
          data: { statusId: engaged.id },
        });
      }
      return tx.crmLead.findUniqueOrThrow({
        where: { id: leadId },
        select: { assignedToId: true, firstName: true, lastName: true, number: true },
      });
    });
    await this.bus.publish({ type: 'CUSTOMER_REPLIED', scope: 'DEALER', dealerId, leadId });
    await this.notify.notify(lead.assignedToId, 'LEAD_REPLIED', {
      title: `${[lead.firstName, lead.lastName].filter(Boolean).join(' ')} replied`,
      body: `Lead #${lead.number}: ${title}`,
      link: `/dealer/crm/leads/${leadId}`,
    });
  }

  /** One-click and page unsubscribe. Returns the dealer's name for the confirmation. */
  async unsubscribe(token: string): Promise<{ ok: boolean; dealerName: string | null; email: string | null }> {
    const email = await this.prisma.crmEmail.findUnique({
      where: { trackingToken: token },
      select: { id: true, toEmail: true, dealerId: true, dealer: { select: { name: true } } },
    });
    if (!email || !email.dealerId) return { ok: false, dealerName: null, email: null };
    await this.compliance.suppress({
      dealerId: email.dealerId,
      email: email.toEmail,
      reason: 'UNSUBSCRIBED',
      source: 'Unsubscribe link',
    });
    await this.prisma.crmEmail.update({ where: { id: email.id }, data: { unsubscribedAt: new Date() } });
    await this.prisma.crmEmailEvent.create({ data: { emailId: email.id, type: 'UNSUBSCRIBED' } });
    return { ok: true, dealerName: email.dealer?.name ?? null, email: maskEmail(email.toEmail) };
  }

  async unsubscribeInfo(token: string) {
    const email = await this.prisma.crmEmail.findUnique({
      where: { trackingToken: token },
      select: { toEmail: true, unsubscribedAt: true, dealer: { select: { name: true } } },
    });
    if (!email) return null;
    return { dealerName: email.dealer?.name ?? 'Vintrax', email: maskEmail(email.toEmail), unsubscribed: !!email.unsubscribedAt };
  }
}

/** a***@example.com — enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user[0]}${'*'.repeat(Math.max(1, Math.min(user.length - 1, 5)))}@${domain}`;
}
