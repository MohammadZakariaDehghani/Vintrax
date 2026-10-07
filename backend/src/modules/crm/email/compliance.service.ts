import { Injectable } from '@nestjs/common';
import { HARD_SUPPRESSIONS, type EmailPurpose, type SuppressionReason } from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { crmAudit, supportAudit } from '../core/audit';
import { CrmBus } from '../core/bus';
import { recordTimeline } from '../leads/timeline';

export interface SendDecision {
  allowed: boolean;
  /** Why not, in words a dealer understands. */
  reason?: string;
}

/**
 * CASL guard rails (D-066). Every email passes through `canSend` twice: when
 * it is queued and again just before it leaves, so consent withdrawn in
 * between still wins.
 *
 *  - A hard suppression (bounced, invalid, complaint, manually blocked)
 *    stops every email to the address.
 *  - Marketing additionally needs a current consent record for this
 *    dealership and no unsubscribe from it. A lead existing is not consent.
 *  - Marketing must identify the sender with a mailing address (CASL s. 6(2)
 *    and the CRTC's regulations), so a dealer without one cannot send it.
 *
 * This is how the software applies the rules; it is not legal advice.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: CrmBus,
  ) {}

  async canSend(
    dealerId: string | null,
    email: string,
    purpose: EmailPurpose,
  ): Promise<SendDecision> {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return { allowed: false, reason: 'The email address is not valid' };
    }
    const suppressions = await this.prisma.crmSuppression.findMany({
      where: { email: address, OR: [{ dealerId: null }, ...(dealerId ? [{ dealerId }] : [])] },
      select: { reason: true },
    });
    const hard = suppressions.find((row) => HARD_SUPPRESSIONS.includes(row.reason));
    if (hard) return { allowed: false, reason: suppressionReason(hard.reason) };
    if (purpose === 'TRANSACTIONAL') return { allowed: true };

    if (!dealerId) return { allowed: false, reason: 'Marketing email needs a dealership' };
    if (suppressions.some((row) => row.reason === 'UNSUBSCRIBED')) {
      return { allowed: false, reason: 'The customer unsubscribed from your marketing' };
    }
    const now = new Date();
    const consent = await this.prisma.crmConsent.findFirst({
      where: {
        dealerId,
        email: address,
        withdrawnAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (!consent)
      return { allowed: false, reason: 'No current marketing consent for this address' };
    const settings = await this.prisma.crmSettings.findUnique({
      where: { dealerId },
      select: { businessAddress: true },
    });
    if (!settings?.businessAddress?.trim()) {
      return {
        allowed: false,
        reason: 'Add your business mailing address in CRM settings before sending marketing email',
      };
    }
    return { allowed: true };
  }

  /**
   * Adds an address to a suppression list. `dealerId` null is platform-wide
   * (bounces, invalid addresses); a dealer's list holds its unsubscribes and
   * manual blocks. An unsubscribe also withdraws that dealer's consents.
   */
  async suppress(input: {
    dealerId: string | null;
    email: string;
    reason: SuppressionReason;
    source: string;
    note?: string | null;
    actor?: { id: string | null; email: string | null };
  }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const leads = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.crmSuppression.findFirst({
        where: { dealerId: input.dealerId, email, reason: input.reason },
        select: { id: true },
      });
      if (!existing) {
        await tx.crmSuppression.create({
          data: {
            dealerId: input.dealerId,
            email,
            reason: input.reason,
            source: input.source,
            note: input.note ?? null,
            createdById: input.actor?.id ?? null,
          },
        });
      }
      const now = new Date();
      if (input.reason === 'UNSUBSCRIBED' && input.dealerId) {
        await tx.crmConsent.updateMany({
          where: { dealerId: input.dealerId, email, withdrawnAt: null },
          data: { withdrawnAt: now },
        });
      }
      // Anything still waiting to go to this address is stopped now.
      await tx.crmEmail.updateMany({
        where: {
          toEmail: email,
          status: { in: ['SCHEDULED', 'QUEUED'] },
          ...(input.reason === 'UNSUBSCRIBED'
            ? { purpose: 'MARKETING', dealerId: input.dealerId }
            : input.dealerId
              ? { dealerId: input.dealerId }
              : {}),
        },
        data: { status: 'SUPPRESSED', lastError: suppressionReason(input.reason) },
      });
      const affected = await tx.crmLead.findMany({
        where: { emailNormalized: email, ...(input.dealerId ? { dealerId: input.dealerId } : {}) },
        select: { id: true, dealerId: true },
      });
      for (const lead of affected) {
        await recordTimeline(tx, {
          dealerId: lead.dealerId,
          leadId: lead.id,
          type: input.reason === 'UNSUBSCRIBED' ? 'UNSUBSCRIBED' : 'EMAIL_BOUNCED',
          title:
            input.reason === 'UNSUBSCRIBED'
              ? 'Unsubscribed from marketing email'
              : `Email suppressed: ${suppressionReason(input.reason).toLowerCase()}`,
          userId: input.actor?.id ?? null,
          notes: input.source,
        });
      }
      const audit = {
        action: 'suppression.added',
        entityType: 'CrmSuppression',
        after: { email, reason: input.reason, source: input.source },
      };
      if (input.dealerId) {
        await crmAudit(
          tx,
          {
            dealerId: input.dealerId,
            userId: input.actor?.id ?? '',
            actorEmail: input.actor?.email ?? 'system',
            system: !input.actor?.id,
          },
          audit,
        );
      } else {
        await supportAudit(tx, input.actor ?? { id: null, email: 'system' }, audit);
      }
      return affected;
    });
    for (const lead of leads) {
      await this.bus.publish({
        type: input.reason === 'UNSUBSCRIBED' ? 'UNSUBSCRIBED' : 'EMAIL_INVALID',
        scope: 'DEALER',
        dealerId: lead.dealerId,
        leadId: lead.id,
        email,
      });
    }
  }

  async unsuppress(dealerId: string, id: string, actor: { id: string; email: string }) {
    const row = await this.prisma.crmSuppression.findFirst({ where: { id, dealerId } });
    if (!row) return false;
    await this.prisma.$transaction(async (tx) => {
      await tx.crmSuppression.delete({ where: { id } });
      await crmAudit(
        tx,
        { dealerId, userId: actor.id, actorEmail: actor.email },
        {
          action: 'suppression.removed',
          entityType: 'CrmSuppression',
          entityId: id,
          before: { email: row.email, reason: row.reason },
        },
      );
    });
    return true;
  }

  list(dealerId: string, q?: string) {
    const where: Prisma.CrmSuppressionWhereInput = {
      OR: [{ dealerId }, { dealerId: null }],
      ...(q ? { email: { contains: q.toLowerCase() } } : {}),
    };
    return this.prisma.crmSuppression.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}

export function suppressionReason(reason: SuppressionReason): string {
  return {
    UNSUBSCRIBED: 'Unsubscribed',
    HARD_BOUNCE: 'The address bounced',
    INVALID: 'The address is invalid',
    COMPLAINT: 'The recipient reported spam',
    MANUAL: 'Blocked by the dealership',
  }[reason];
}
