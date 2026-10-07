import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { normalizeEmail, normalizePhone, type ConsentType } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { QUEUE_NAMES, QueueService } from '../../../common/queue/queue.service';
import { CrmBus } from '../core/bus';
import { systemContext, type CrmContext } from '../core/context';
import { CrmSetupService } from '../core/setup.service';
import { DispatcherService } from '../email/dispatcher.service';
import { LeadsService } from '../leads/leads.service';
import { ScoringService } from '../leads/scoring.service';
import { recordTimeline } from '../leads/timeline';
import { TicketsService } from '../support/tickets.service';

/**
 * Turns platform events into CRM records (D-066):
 *
 *  - a buyer's message about a dealer's vehicle → a lead (or the existing
 *    one), a vehicle inquiry on its timeline, or a reply that stops
 *    follow-up sequences; the dealer's own message counts as contact;
 *  - a finance application → financing (and trade-in) on the lead;
 *  - a deposit and a posted sale (accounting) → the journey's deposit and
 *    sale stages, the lead won, post-sale automations, purchase consent;
 *  - a Contact-page message → a support ticket.
 *
 * Only dealerships get leads; a private seller's messages are left alone.
 * Each handler is idempotent: a retried job finds what it already did.
 */
@Injectable()
export class CrmEventsWorker implements OnModuleInit {
  private readonly logger = new Logger(CrmEventsWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly setup: CrmSetupService,
    private readonly leads: LeadsService,
    private readonly scoring: ScoringService,
    private readonly dispatcher: DispatcherService,
    private readonly tickets: TicketsService,
    private readonly bus: CrmBus,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker(QUEUE_NAMES.crm, async (job: Job) =>
      this.handle(job.name, job.data as Record<string, string>),
    );
  }

  async handle(name: string, data: Record<string, string>): Promise<void> {
    switch (name) {
      case 'message':
        return this.onMessage(data.messageId!);
      case 'finance':
        return this.onFinance(data.applicationId!);
      case 'deposit':
        return this.onDeposit(data.depositId!);
      case 'sale':
        return this.onSale(data.saleId!);
      case 'contact':
        await this.tickets.fromContactMessage(data.contactMessageId!);
        return;
      default:
        this.logger.warn(`Unknown CRM event "${name}"`);
    }
  }

  private async dealerContext(ownerUserId: string): Promise<CrmContext | null> {
    const dealer = await this.prisma.dealer.findUnique({
      where: { ownerId: ownerUserId },
      select: { id: true },
    });
    if (!dealer) return null;
    await this.setup.ensure(dealer.id);
    return systemContext(dealer.id, ownerUserId);
  }

  /** The dealer's lead for this person: by account first, then email, then phone. */
  private async findLead(
    dealerId: string,
    who: {
      userId?: string | null;
      email?: string | null;
      phone?: string | null;
      customerId?: string | null;
    },
  ) {
    const or = [
      ...(who.customerId ? [{ customerId: who.customerId }] : []),
      ...(who.userId ? [{ userId: who.userId }] : []),
      ...(normalizeEmail(who.email) ? [{ emailNormalized: normalizeEmail(who.email)! }] : []),
      ...(normalizePhone(who.phone) ? [{ phoneNormalized: normalizePhone(who.phone)! }] : []),
    ];
    if (!or.length) return null;
    return this.prisma.crmLead.findFirst({
      where: { dealerId, mergedIntoId: null, OR: or },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        conversationId: true,
        customerId: true,
        userId: true,
        emailNormalized: true,
        firstContactAt: true,
      },
    });
  }

  private async impliedConsent(dealerId: string, type: ConsentType) {
    const settings = await this.prisma.crmSettings.findUnique({ where: { dealerId } });
    const allowed =
      type === 'IMPLIED_PURCHASE'
        ? settings?.impliedConsentFromPurchase
        : settings?.impliedConsentFromInquiry;
    return allowed ?? false;
  }

  // --- Messages ------------------------------------------------------------------------

  private async onMessage(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            vehicle: { select: { id: true, title: true, vin: true } },
            buyer: {
              select: { id: true, email: true, firstName: true, lastName: true, phone: true },
            },
          },
        },
      },
    });
    if (!message) return;
    const conversation = message.conversation;
    const ctx = await this.dealerContext(conversation.sellerId);
    if (!ctx) return;
    // Already recorded (a retried job)?
    const seen = await this.prisma.crmActivity.count({
      where: { dealerId: ctx.dealerId, metadata: { path: ['messageId'], equals: messageId } },
    });
    if (seen) return;

    const buyer = conversation.buyer;
    if (message.senderId === conversation.sellerId) {
      // The dealership answered in Vintrax messages: that is contact.
      const lead = await this.findLead(ctx.dealerId, { userId: buyer.id, email: buyer.email });
      if (!lead) return;
      await this.prisma.$transaction(async (tx) => {
        await recordTimeline(tx, {
          dealerId: ctx.dealerId,
          leadId: lead.id,
          type: 'FOLLOW_UP',
          title: 'Replied in Vintrax messages',
          notes: message.body.slice(0, 2000),
          userId: conversation.sellerId,
          vehicleId: conversation.vehicleId,
          metadata: { messageId, conversationId: conversation.id, channel: 'MESSENGER' },
        });
        await this.leads.markContactedIf(
          tx,
          { ...ctx, system: false, userId: conversation.sellerId },
          lead.id,
          'FOLLOW_UP',
          message.createdAt,
          lead.firstContactAt,
        );
      });
      return;
    }

    const lead = await this.findLead(ctx.dealerId, { userId: buyer.id, email: buyer.email });
    const consent = (await this.impliedConsent(ctx.dealerId, 'IMPLIED_INQUIRY'))
      ? {
          type: 'IMPLIED_INQUIRY' as const,
          source: 'Vehicle inquiry in Vintrax messages',
          evidence: `Asked about ${conversation.vehicle.title}`,
        }
      : null;
    if (!lead) {
      await this.leads.create(
        ctx,
        {
          firstName: buyer.firstName,
          lastName: buyer.lastName,
          email: buyer.email,
          phone: buyer.phone,
          preferredContact: null,
          address: null,
          city: null,
          province: null,
          postalCode: null,
          sourceId: null,
          campaign: null,
          vehicleId: conversation.vehicleId,
          interestedVin: conversation.vehicle.vin,
          vehicleUrl: null,
          budget: null,
          financingInterest: false,
          tradeInInterest: false,
          tradeInVehicle: null,
          preferredAppointmentAt: null,
          notes: null,
          statusId: null,
          assignedToId: null,
          team: null,
          nextFollowUpAt: null,
          tags: [],
          consent: null,
        },
        {
          sourceKey: 'VEHICLE_DETAIL_PAGE',
          userId: buyer.id,
          conversationId: conversation.id,
          signals: ['VEHICLE_INQUIRY'],
          triggers: ['VEHICLE_INQUIRY'],
          events: [
            {
              type: 'VEHICLE_INQUIRY',
              title: `Asked about ${conversation.vehicle.title}`,
              notes: message.body.slice(0, 2000),
              vehicleId: conversation.vehicleId,
            },
          ],
          impliedConsent: consent,
        },
      );
      // Tie the activity to the message for idempotency.
      await this.markMessage(ctx.dealerId, messageId);
      return;
    }

    const sellerSpoke = await this.prisma.message.count({
      where: {
        conversationId: conversation.id,
        senderId: conversation.sellerId,
        createdAt: { lt: message.createdAt },
      },
    });
    if (lead.conversationId !== conversation.id && !sellerSpoke) {
      // A new inquiry (another vehicle) from someone already a lead.
      await this.prisma.$transaction(async (tx) => {
        await tx.crmLead.update({
          where: { id: lead.id },
          data: {
            conversationId: conversation.id,
            userId: lead.userId ?? buyer.id,
            vehicleId: conversation.vehicleId,
          },
        });
        await recordTimeline(tx, {
          dealerId: ctx.dealerId,
          leadId: lead.id,
          type: 'VEHICLE_INQUIRY',
          title: `Asked about ${conversation.vehicle.title}`,
          notes: message.body.slice(0, 2000),
          vehicleId: conversation.vehicleId,
          metadata: { messageId, conversationId: conversation.id },
        });
        await this.scoring.apply(lead.id, 'VEHICLE_INQUIRY', tx);
        if (consent && lead.emailNormalized)
          await this.leads.recordConsent(tx, ctx, lead.id, lead.emailNormalized, consent);
      });
      await this.bus.publish({
        type: 'VEHICLE_INQUIRY',
        scope: 'DEALER',
        dealerId: ctx.dealerId,
        leadId: lead.id,
      });
      return;
    }
    if (sellerSpoke) {
      await this.dispatcher.leadReplied(
        ctx.dealerId,
        lead.id,
        'Replied in Vintrax messages',
        message.body.slice(0, 2000),
      );
      await this.markMessage(ctx.dealerId, messageId, lead.id);
    }
  }

  /** Stamps the newest timeline entry for a message so a retried job skips it. */
  private async markMessage(dealerId: string, messageId: string, leadId?: string) {
    const latest = await this.prisma.crmActivity.findFirst({
      where: {
        dealerId,
        ...(leadId ? { leadId } : {}),
        type: { in: ['VEHICLE_INQUIRY', 'CUSTOMER_REPLIED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, metadata: true },
    });
    if (latest) {
      await this.prisma.crmActivity.update({
        where: { id: latest.id },
        data: { metadata: { ...((latest.metadata as object) ?? {}), messageId } },
      });
    }
  }

  // --- Finance applications ------------------------------------------------------------

  private async onFinance(applicationId: string) {
    const application = await this.prisma.financeApplication.findUnique({
      where: { id: applicationId },
      include: { vehicle: { select: { id: true, title: true, vin: true } } },
    });
    if (!application) return;
    const ctx = await this.dealerContext(application.sellerId);
    if (!ctx) return;
    const seen = await this.prisma.crmLead.count({
      where: { dealerId: ctx.dealerId, financeApplicationId: applicationId },
    });
    if (seen) return;
    const consent = (await this.impliedConsent(ctx.dealerId, 'IMPLIED_INQUIRY'))
      ? {
          type: 'IMPLIED_INQUIRY' as const,
          source: 'Finance application on Vintrax',
          evidence: `Applied for financing on ${application.vehicle.title}`,
        }
      : null;
    const tradeIn = application.hasTradeIn
      ? [application.tradeInYear, application.tradeInMake, application.tradeInModel]
          .filter(Boolean)
          .join(' ') || 'Trade-in'
      : null;
    // Only that they applied, never the application's contents (income, date of birth).
    const events = [
      {
        type: 'FINANCING_REQUESTED' as const,
        title: `Applied for financing on ${application.vehicle.title}`,
        vehicleId: application.vehicleId,
      },
      ...(tradeIn
        ? [
            {
              type: 'TRADE_IN_APPRAISAL' as const,
              title: `Trade-in offered: ${tradeIn}`,
              vehicleId: application.vehicleId,
            },
          ]
        : []),
    ];
    const lead = await this.findLead(ctx.dealerId, {
      userId: application.applicantId,
      email: application.email,
      phone: application.phone,
    });
    if (!lead) {
      await this.leads.create(
        ctx,
        {
          firstName: application.firstName,
          lastName: application.lastName,
          email: application.email,
          phone: application.phone,
          preferredContact: application.preferredContact,
          address: null,
          city: null,
          province: null,
          postalCode: application.postalCode,
          sourceId: null,
          campaign: null,
          vehicleId: application.vehicleId,
          interestedVin: application.vehicle.vin,
          vehicleUrl: null,
          budget: null,
          financingInterest: true,
          tradeInInterest: application.hasTradeIn,
          tradeInVehicle: tradeIn,
          preferredAppointmentAt: null,
          notes: null,
          statusId: null,
          assignedToId: null,
          team: null,
          nextFollowUpAt: null,
          tags: ['Financing', ...(tradeIn ? ['Trade-in'] : [])],
          consent: null,
        },
        {
          sourceKey: 'VEHICLE_DETAIL_PAGE',
          userId: application.applicantId,
          financeApplicationId: applicationId,
          signals: ['FINANCING_REQUEST', ...(tradeIn ? (['TRADE_IN_SUBMITTED'] as const) : [])],
          triggers: ['FINANCING_REQUESTED', ...(tradeIn ? (['TRADE_IN_SUBMITTED'] as const) : [])],
          events,
          impliedConsent: consent,
        },
      );
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.crmLead.update({
        where: { id: lead.id },
        data: {
          financeApplicationId: applicationId,
          financingInterest: true,
          ...(tradeIn ? { tradeInInterest: true, tradeInVehicle: tradeIn } : {}),
        },
      });
      for (const event of events)
        await recordTimeline(tx, { dealerId: ctx.dealerId, leadId: lead.id, ...event });
      await this.scoring.apply(lead.id, 'FINANCING_REQUEST', tx);
      if (tradeIn) await this.scoring.apply(lead.id, 'TRADE_IN_SUBMITTED', tx);
      if (consent && lead.emailNormalized)
        await this.leads.recordConsent(tx, ctx, lead.id, lead.emailNormalized, consent);
    });
    const signal = { scope: 'DEALER' as const, dealerId: ctx.dealerId, leadId: lead.id };
    await this.bus.publish({ ...signal, type: 'FINANCING_REQUESTED' });
    if (tradeIn) await this.bus.publish({ ...signal, type: 'TRADE_IN_SUBMITTED' });
  }

  // --- Accounting: deposits and sales -----------------------------------------------------

  private async onDeposit(depositId: string) {
    const deposit = await this.prisma.customerDeposit.findUnique({
      where: { id: depositId },
      include: { customer: true, vehicle: { select: { id: true, title: true } } },
    });
    if (!deposit) return;
    await this.setup.ensure(deposit.dealerId);
    const lead = await this.findLead(deposit.dealerId, {
      customerId: deposit.customerId,
      userId: deposit.customer.userId,
      email: deposit.customer.email,
      phone: deposit.customer.phone,
    });
    if (!lead) return;
    const seen = await this.prisma.crmActivity.count({
      where: {
        leadId: lead.id,
        type: 'DEPOSIT',
        metadata: { path: ['depositId'], equals: depositId },
      },
    });
    if (seen) return;
    await this.prisma.$transaction(async (tx) => {
      if (!lead.customerId)
        await tx.crmLead.update({
          where: { id: lead.id },
          data: { customerId: deposit.customerId, convertedAt: new Date() },
        });
      await recordTimeline(tx, {
        dealerId: deposit.dealerId,
        leadId: lead.id,
        type: 'DEPOSIT',
        title: `Deposit #${deposit.number} received${deposit.vehicle ? ` on ${deposit.vehicle.title}` : ''}`,
        vehicleId: deposit.vehicleId,
        metadata: { depositId, amount: deposit.amount.toString() },
      });
    });
  }

  private async onSale(saleId: string) {
    const sale = await this.prisma.vehicleSale.findUnique({
      where: { id: saleId },
      include: {
        customer: true,
        vehicle: { select: { id: true, title: true, vin: true } },
        dealer: { select: { ownerId: true } },
      },
    });
    if (!sale || sale.status !== 'POSTED') return;
    await this.setup.ensure(sale.dealerId);
    const ctx = systemContext(sale.dealerId, sale.dealer.ownerId);
    const seen = await this.prisma.crmActivity.count({
      where: { dealerId: sale.dealerId, type: 'SALE', saleId },
    });
    if (seen) return;
    const customer = sale.customer;
    let lead = await this.findLead(sale.dealerId, {
      customerId: customer.id,
      userId: customer.userId,
      email: customer.email,
      phone: customer.phone,
    });
    if (!lead) {
      // A buyer the CRM never saw (a walk-in sold at the desk): give them a
      // record so the post-sale lifecycle reaches them too.
      const [firstName, ...rest] = customer.name.trim().split(/\s+/);
      if (!customer.email && !customer.phone) return;
      const created = await this.leads.create(
        ctx,
        {
          firstName: firstName || customer.name,
          lastName: rest.join(' ') || null,
          email: customer.email,
          phone: customer.phone,
          preferredContact: null,
          address: customer.address,
          city: customer.city,
          province: customer.province,
          postalCode: customer.postalCode,
          sourceId: null,
          campaign: null,
          vehicleId: sale.vehicleId,
          interestedVin: sale.vehicle.vin,
          vehicleUrl: null,
          budget: null,
          financingInterest: false,
          tradeInInterest: !!sale.tradeInId,
          tradeInVehicle: null,
          preferredAppointmentAt: null,
          notes: null,
          statusId: null,
          assignedToId: null,
          team: null,
          nextFollowUpAt: null,
          tags: [],
          consent: null,
        },
        { sourceKey: 'WALK_IN', userId: customer.userId },
      );
      // The person who sold the car owns the relationship, when they are on the sales staff.
      if (sale.salespersonId) {
        await this.leads
          .assign(ctx, created.id, { assignedToId: sale.salespersonId, team: null })
          .catch(() => undefined);
      }
      lead = await this.prisma.crmLead.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          id: true,
          conversationId: true,
          customerId: true,
          userId: true,
          emailNormalized: true,
          firstContactAt: true,
        },
      });
    }
    const leadId = lead.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.crmLead.update({
        where: { id: leadId },
        data: {
          customerId: customer.id,
          convertedAt: lead!.customerId ? undefined : new Date(),
          vehicleId: sale.vehicleId,
        },
      });
      await recordTimeline(tx, {
        dealerId: sale.dealerId,
        leadId,
        type: 'SALE',
        title: `Bought the ${sale.vehicle.title} (sale #${sale.number})`,
        vehicleId: sale.vehicleId,
        saleId,
        userId: sale.salespersonId,
        metadata: { saleId, total: sale.totalAmount.toString() },
      });
      if (lead!.emailNormalized && (await this.impliedConsent(sale.dealerId, 'IMPLIED_PURCHASE'))) {
        await this.leads.recordConsent(tx, ctx, leadId, lead!.emailNormalized, {
          type: 'IMPLIED_PURCHASE',
          source: 'Vehicle purchase',
          evidence: `Bought the ${sale.vehicle.title} (sale #${sale.number})`,
        });
      }
    });
    await this.leads.setStatusByKey(ctx, leadId, 'WON');
    const settings = await this.prisma.crmSettings.findUnique({
      where: { dealerId: sale.dealerId },
      select: { postSaleEnabled: true },
    });
    if (settings?.postSaleEnabled ?? true) {
      await this.bus.publish({
        type: 'VEHICLE_SOLD',
        scope: 'DEALER',
        dealerId: sale.dealerId,
        leadId,
      });
    }
  }
}
