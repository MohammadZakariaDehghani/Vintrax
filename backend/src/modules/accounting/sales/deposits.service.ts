import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { centsToDecimalString, type DepositInput, type DepositRefundInput } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromDbDate, toDbDate } from '../core/dates';
import { nextNumber, requireCustomer, requireDealerVehicle } from '../core/documents';
import { fromCents, toCents } from '../core/money';
import { bankGlAccount } from '../banking/bank-accounts';
import { PostingService } from '../journal/posting.service';

/**
 * Customer deposits. A deposit is the customer's money held by the dealer —
 * a liability (Customer Deposits Liability), not revenue — until it is
 * applied to a sale or refunded.
 */
@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async list(ctx: AccountingContext, query: { customerId?: string; status?: string }) {
    const rows = await this.prisma.customerDeposit.findMany({
      where: {
        dealerId: ctx.dealerId,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
      },
      orderBy: { date: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        vehicle: { select: { id: true, year: true, make: true, model: true, vin: true } },
        bankAccount: { select: { id: true, name: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      customer: row.customer,
      vehicle: row.vehicle,
      date: fromDbDate(row.date),
      amountCents: toCents(row.amount),
      appliedCents: toCents(row.applied),
      refundedCents: toCents(row.refunded),
      remainingCents: toCents(row.amount) - toCents(row.applied) - toCents(row.refunded),
      method: row.method,
      bankAccount: row.bankAccount,
      reference: row.reference,
      status: row.status,
      journalEntryId: row.journalEntryId,
      events: row.events.map((event) => ({
        kind: event.kind,
        amountCents: toCents(event.amount),
        date: fromDbDate(event.date),
        saleId: event.saleId,
        journalEntryId: event.journalEntryId,
        reason: event.reason,
      })),
    }));
  }

  /** Deposit received: debit the bank, credit Customer Deposits Liability. */
  async receive(ctx: AccountingContext, input: DepositInput) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await requireCustomer(tx, ctx, input.customerId);
      if (input.vehicleId) await requireDealerVehicle(tx, ctx, input.vehicleId);
      const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
      const { CUSTOMER_DEPOSITS: liability } = await this.posting.accounts(tx, ctx.dealerId, ['CUSTOMER_DEPOSITS']);

      const deposit = await tx.customerDeposit.create({
        data: {
          dealerId: ctx.dealerId,
          number: await nextNumber(tx, ctx.dealerId, 'nextDepositNumber'),
          customerId: customer.id,
          vehicleId: input.vehicleId,
          date: toDbDate(input.date),
          amount: fromCents(input.amount),
          method: input.method,
          bankAccountId: bank.id,
          reference: input.reference,
          notes: input.notes,
          createdById: ctx.userId,
        },
      });
      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: `Deposit #${deposit.number} — ${customer.name}`,
        memo: input.notes,
        source: 'CUSTOMER_DEPOSIT',
        sourceType: 'CustomerDeposit',
        sourceId: deposit.id,
        lines: [
          { accountId: bank.glAccountId, debit: input.amount, credit: 0, customerId: customer.id, vehicleId: input.vehicleId },
          { accountId: liability, debit: 0, credit: input.amount, customerId: customer.id, vehicleId: input.vehicleId },
        ],
      });
      await tx.customerDeposit.update({ where: { id: deposit.id }, data: { journalEntryId: entry.id } });
      await tx.customerDepositEvent.create({
        data: { depositId: deposit.id, kind: 'RECEIVED', amount: fromCents(input.amount), date: toDbDate(input.date), journalEntryId: entry.id },
      });
      await recordAudit(tx, ctx, {
        action: 'deposit.received',
        entityType: 'CustomerDeposit',
        entityId: deposit.id,
        after: { customerId: customer.id, amountCents: input.amount, method: input.method, journal: entry.reference },
      });
      return { id: deposit.id, number: deposit.number, journalEntryId: entry.id };
    });
  }

  /** Refund (all or part of what remains): debit the liability, credit the bank. */
  async refund(ctx: AccountingContext, depositId: string, input: DepositRefundInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CustomerDeposit" WHERE "id" = ${depositId}::uuid FOR UPDATE`;
      const deposit = await tx.customerDeposit.findFirst({
        where: { id: depositId, dealerId: ctx.dealerId },
        include: { customer: { select: { id: true, name: true } } },
      });
      if (!deposit) throw new NotFoundException('Deposit not found');
      const remaining = toCents(deposit.amount) - toCents(deposit.applied) - toCents(deposit.refunded);
      if (input.amount > remaining) {
        throw new BadRequestException(`Only ${centsToDecimalString(remaining)} of this deposit remains`);
      }
      if (input.date < fromDbDate(deposit.date)) throw new BadRequestException('A refund cannot predate the deposit');
      const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
      const { CUSTOMER_DEPOSITS: liability } = await this.posting.accounts(tx, ctx.dealerId, ['CUSTOMER_DEPOSITS']);
      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: `Deposit #${deposit.number} refund — ${deposit.customer.name}`,
        memo: input.reason,
        source: 'DEPOSIT_REFUND',
        sourceType: 'CustomerDeposit',
        sourceId: deposit.id,
        lines: [
          { accountId: liability, debit: input.amount, credit: 0, customerId: deposit.customerId, vehicleId: deposit.vehicleId },
          { accountId: bank.glAccountId, debit: 0, credit: input.amount, customerId: deposit.customerId },
        ],
      });
      const refunded = toCents(deposit.refunded) + input.amount;
      const applied = toCents(deposit.applied);
      await tx.customerDeposit.update({
        where: { id: deposit.id },
        data: { refunded: fromCents(refunded), status: depositStatus(toCents(deposit.amount), applied, refunded) },
      });
      await tx.customerDepositEvent.create({
        data: {
          depositId: deposit.id,
          kind: 'REFUNDED',
          amount: fromCents(input.amount),
          date: toDbDate(input.date),
          journalEntryId: entry.id,
          reason: input.reason,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'deposit.refunded',
        entityType: 'CustomerDeposit',
        entityId: deposit.id,
        before: { refundedCents: toCents(deposit.refunded) },
        after: { refundedCents: refunded, journal: entry.reference },
        reason: input.reason,
      });
      return { id: deposit.id, journalEntryId: entry.id };
    });
  }
}

export function depositStatus(amount: number, applied: number, refunded: number) {
  if (refunded > 0 && applied + refunded >= amount && applied === 0) return 'REFUNDED' as const;
  if (applied + refunded >= amount) return 'APPLIED' as const;
  if (applied > 0) return 'PARTIALLY_APPLIED' as const;
  return 'OPEN' as const;
}

