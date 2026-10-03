import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { centsToDecimalString, type PaymentInput, type ReportQuery } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromDbDate, toDbDate } from '../core/dates';
import { nextNumber, requireCustomer, requireVendor } from '../core/documents';
import { fromCents, sumCents, toCents } from '../core/money';
import { bankGlAccount } from '../banking/bank-accounts';
import { PostingService } from '../journal/posting.service';
import { settlement } from '../payables/bills.service';
import { resolveRange } from '../reports/date-ranges';

/**
 * Money in and out against receivables and payables.
 *
 *  - from a customer:  debit the bank, credit Accounts Receivable
 *  - refund to a customer: debit Accounts Receivable, credit the bank
 *  - to a vendor:      debit Accounts Payable, credit the bank
 *  - refund from a vendor: debit the bank, credit Accounts Payable
 *
 * A payment can be split across several open invoices or bills; whatever is
 * not allocated stays on the account as a credit. Only a safe reference
 * (cheque number, e-transfer reference, last four digits) is kept.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async list(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query);
    const rows = await this.prisma.payment.findMany({
      where: {
        dealerId: ctx.dealerId,
        date: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
        ...(query.reference ? { reference: { contains: query.reference, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      include: {
        customer: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, name: true } },
        allocations: {
          include: {
            invoice: { select: { id: true, number: true } },
            bill: { select: { id: true, number: true, vendorReference: true } },
          },
        },
      },
      take: 1000,
    });
    return {
      range,
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        direction: row.direction,
        kind: row.kind,
        customer: row.customer,
        vendor: row.vendor,
        date: fromDbDate(row.date),
        amountCents: toCents(row.amount),
        method: row.method,
        reference: row.reference,
        bankAccount: row.bankAccount,
        status: row.status,
        allocations: row.allocations.map((allocation) => ({
          invoice: allocation.invoice,
          bill: allocation.bill,
          amountCents: toCents(allocation.amount),
        })),
        unallocatedCents: toCents(row.amount) - sumCents(row.allocations.map((allocation) => toCents(allocation.amount))),
        journalEntryId: row.journalEntryId,
      })),
    };
  }

  async create(ctx: AccountingContext, input: PaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      const party = input.customerId
        ? { type: 'customer' as const, ...(await requireCustomer(tx, ctx, input.customerId)) }
        : { type: 'vendor' as const, ...(await requireVendor(tx, ctx, input.vendorId!)) };
      if (party.type === 'customer' && input.allocations.some((allocation) => allocation.billId)) {
        throw new BadRequestException('A customer payment is applied to invoices');
      }
      if (party.type === 'vendor' && input.allocations.some((allocation) => allocation.invoiceId)) {
        throw new BadRequestException('A vendor payment is applied to bills');
      }
      const isRefund = input.kind === 'REFUND';
      // A refund goes the other way and is not applied to documents.
      const expectedDirection =
        party.type === 'customer' ? (isRefund ? 'SENT' : 'RECEIVED') : isRefund ? 'RECEIVED' : 'SENT';
      if (input.direction !== expectedDirection) {
        throw new BadRequestException(
          party.type === 'customer'
            ? isRefund
              ? 'A refund to a customer is money sent'
              : 'A customer payment is money received'
            : isRefund
              ? 'A refund from a vendor is money received'
              : 'A vendor payment is money sent',
        );
      }
      if (isRefund && input.allocations.length > 0) {
        throw new BadRequestException('A refund is not applied to invoices or bills');
      }

      const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
      const { AR: ar, AP: ap } = await this.posting.accounts(tx, ctx.dealerId, ['AR', 'AP']);
      const control = party.type === 'customer' ? ar : ap;

      // Validate and lock every document being paid.
      for (const allocation of input.allocations) {
        if (allocation.invoiceId) {
          const [invoice] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "CustomerInvoice" WHERE "id" = ${allocation.invoiceId}::uuid AND "dealerId" = ${ctx.dealerId}::uuid FOR UPDATE`;
          const row = invoice ? await tx.customerInvoice.findUniqueOrThrow({ where: { id: invoice.id } }) : null;
          if (!row || row.customerId !== party.id) throw new BadRequestException('Invoice not found for this customer');
          if (row.status === 'VOID') throw new ConflictException(`Invoice ${row.number} is void`);
          const open = toCents(row.total) - toCents(row.amountPaid);
          if (allocation.amount > open) {
            throw new BadRequestException(`Invoice ${row.number} has only ${centsToDecimalString(open)} open`);
          }
        } else if (allocation.billId) {
          const [bill] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "VendorBill" WHERE "id" = ${allocation.billId}::uuid AND "dealerId" = ${ctx.dealerId}::uuid FOR UPDATE`;
          const row = bill ? await tx.vendorBill.findUniqueOrThrow({ where: { id: bill.id } }) : null;
          if (!row || row.vendorId !== party.id || row.kind !== 'BILL') {
            throw new BadRequestException('Bill not found for this vendor');
          }
          if (row.status === 'VOID') throw new ConflictException(`Bill #${row.number} is void`);
          const open = toCents(row.total) - toCents(row.amountPaid);
          if (allocation.amount > open) {
            throw new BadRequestException(`Bill #${row.number} has only ${centsToDecimalString(open)} open`);
          }
        } else {
          throw new BadRequestException('Each allocation names an invoice or a bill');
        }
      }

      const payment = await tx.payment.create({
        data: {
          dealerId: ctx.dealerId,
          number: await nextNumber(tx, ctx.dealerId, 'nextPaymentNumber'),
          direction: input.direction,
          kind: input.kind,
          customerId: party.type === 'customer' ? party.id : null,
          vendorId: party.type === 'vendor' ? party.id : null,
          date: toDbDate(input.date),
          amount: fromCents(input.amount),
          method: input.method,
          reference: input.reference,
          bankAccountId: bank.id,
          notes: input.notes,
          createdById: ctx.userId,
          allocations: {
            create: input.allocations.map((allocation) => ({
              invoiceId: allocation.invoiceId,
              billId: allocation.billId,
              amount: fromCents(allocation.amount),
            })),
          },
        },
      });

      const moneyIn = input.direction === 'RECEIVED';
      const dims = party.type === 'customer' ? { customerId: party.id } : { vendorId: party.id };
      const source =
        party.type === 'customer' ? (isRefund ? 'CUSTOMER_REFUND' : 'CUSTOMER_PAYMENT') : 'VENDOR_PAYMENT';
      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: `${isRefund ? 'Refund' : 'Payment'} #${payment.number} ${moneyIn ? 'from' : 'to'} ${party.name}`,
        memo: input.notes,
        source,
        sourceType: 'Payment',
        sourceId: payment.id,
        lines: [
          { accountId: bank.glAccountId, debit: moneyIn ? input.amount : 0, credit: moneyIn ? 0 : input.amount, ...dims },
          { accountId: control, debit: moneyIn ? 0 : input.amount, credit: moneyIn ? input.amount : 0, ...dims },
        ],
      });
      await tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });

      for (const allocation of input.allocations) {
        if (allocation.invoiceId) {
          const invoice = await tx.customerInvoice.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
          const paid = toCents(invoice.amountPaid) + allocation.amount;
          await tx.customerInvoice.update({
            where: { id: invoice.id },
            data: { amountPaid: fromCents(paid), status: settlement(toCents(invoice.total), paid) },
          });
        } else if (allocation.billId) {
          const bill = await tx.vendorBill.findUniqueOrThrow({ where: { id: allocation.billId } });
          const paid = toCents(bill.amountPaid) + allocation.amount;
          await tx.vendorBill.update({
            where: { id: bill.id },
            data: { amountPaid: fromCents(paid), status: settlement(toCents(bill.total), paid) },
          });
        }
      }

      await recordAudit(tx, ctx, {
        action: isRefund ? 'payment.refund' : 'payment.created',
        entityType: 'Payment',
        entityId: payment.id,
        after: {
          number: payment.number,
          direction: input.direction,
          party: party.id,
          amountCents: input.amount,
          method: input.method,
          allocations: input.allocations,
          journal: entry.reference,
        },
      });
      return { id: payment.id, number: payment.number, journalEntryId: entry.id };
    });
  }

  /** Reverses a payment and takes its allocations back off the invoices or bills. */
  async reverse(ctx: AccountingContext, paymentId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, dealerId: ctx.dealerId },
        include: { allocations: true },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== 'POSTED') throw new ConflictException('This payment is already reversed');
      const reconciled = await tx.journalLine.count({
        where: { entryId: payment.journalEntryId!, reconciliationId: { not: null } },
      });
      if (reconciled > 0) {
        throw new ConflictException('This payment has been reconciled with the bank; post an adjustment instead');
      }
      const reversal = await this.posting.reverse(tx, ctx, payment.journalEntryId!, { reason });
      for (const allocation of payment.allocations) {
        if (allocation.invoiceId) {
          const invoice = await tx.customerInvoice.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
          const paid = toCents(invoice.amountPaid) - toCents(allocation.amount);
          await tx.customerInvoice.update({
            where: { id: invoice.id },
            data: { amountPaid: fromCents(paid), status: invoice.status === 'VOID' ? 'VOID' : settlement(toCents(invoice.total), paid) },
          });
        } else if (allocation.billId) {
          const bill = await tx.vendorBill.findUniqueOrThrow({ where: { id: allocation.billId } });
          const paid = toCents(bill.amountPaid) - toCents(allocation.amount);
          await tx.vendorBill.update({
            where: { id: bill.id },
            data: { amountPaid: fromCents(paid), status: bill.status === 'VOID' ? 'VOID' : settlement(toCents(bill.total), paid) },
          });
        }
      }
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'VOID', reversalEntryId: reversal.id } });
      await recordAudit(tx, ctx, {
        action: 'payment.reversed',
        entityType: 'Payment',
        entityId: payment.id,
        before: { status: 'POSTED' },
        after: { status: 'VOID', reversal: reversal.reference },
        reason,
      });
      return { id: payment.id, reversalEntryId: reversal.id };
    });
  }
}
