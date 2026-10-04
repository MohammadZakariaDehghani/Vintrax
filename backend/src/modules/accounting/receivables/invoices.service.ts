import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Province } from '@prisma/client';
import type { InvoiceInput, ReportQuery } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromDbDate, toDbDate, todayIso } from '../core/dates';
import {
  dealerProvince,
  nextInvoiceNumber,
  requireAccount,
  requireCustomer,
} from '../core/documents';
import { fromCents, sumCents, toCents } from '../core/money';
import { PostingService, type LedgerLine } from '../journal/posting.service';
import { TaxService, payableAccountKey } from '../tax/tax.service';
import { agingBucket } from '../reports/aging';

/**
 * Accounts receivable: invoices the dealership raises (sale balances are
 * raised by the sale itself; these are for service, parts and anything else),
 * and the customer's open balance and aging that payments settle.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly tax: TaxService,
  ) {}

  async list(ctx: AccountingContext, query: ReportQuery & { openOnly?: boolean }) {
    const where: Prisma.CustomerInvoiceWhereInput = {
      dealerId: ctx.dealerId,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.q ? { number: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.customerInvoice.findMany({
      where,
      orderBy: [{ date: 'desc' }],
      include: { customer: { select: { id: true, name: true } } },
      take: 1000,
    });
    const today = todayIso();
    return rows.map((row) => {
      const balance = toCents(row.total) - toCents(row.amountPaid);
      const dueDate = fromDbDate(row.dueDate);
      return {
        id: row.id,
        number: row.number,
        customer: row.customer,
        saleId: row.saleId,
        date: fromDbDate(row.date),
        dueDate,
        description: row.description,
        subtotalCents: toCents(row.subtotal),
        taxCents: toCents(row.taxTotal),
        totalCents: toCents(row.total),
        paidCents: toCents(row.amountPaid),
        balanceCents: row.status === 'VOID' ? 0 : balance,
        status: row.status,
        agingBucket: row.status === 'VOID' || balance === 0 ? null : agingBucket(dueDate, today),
        journalEntryId: row.journalEntryId,
      };
    });
  }

  async create(ctx: AccountingContext, input: InvoiceInput) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await requireCustomer(tx, ctx, input.customerId);
      for (const line of input.lines) {
        const account = await requireAccount(tx, ctx, line.accountId);
        if (account.type !== 'REVENUE') {
          throw new BadRequestException(`${account.name} is not a revenue account`);
        }
      }
      const { province: dealerHome } = await dealerProvince(tx, ctx.dealerId);
      const province = (input.taxProvince ?? customer.province ?? dealerHome) as Province;
      const tax = await this.tax.calculate(tx, ctx.dealerId, {
        province,
        date: input.date,
        lines: input.lines.map((line) => ({
          category: line.taxCategory,
          amountCents: line.amount,
        })),
      });
      const subtotal = sumCents(input.lines.map((line) => line.amount));
      const total = subtotal + tax.totalTaxCents;
      const { AR: ar } = await this.posting.accounts(tx, ctx.dealerId, ['AR']);

      const invoice = await tx.customerInvoice.create({
        data: {
          dealerId: ctx.dealerId,
          number: await nextInvoiceNumber(tx, ctx.dealerId),
          customerId: customer.id,
          date: toDbDate(input.date),
          dueDate: toDbDate(input.dueDate),
          description: input.description,
          lines: input.lines.map((line) => ({
            accountId: line.accountId,
            description: line.description,
            amountCents: line.amount,
            taxCategory: line.taxCategory,
          })),
          subtotal: fromCents(subtotal),
          taxTotal: fromCents(tax.totalTaxCents),
          total: fromCents(total),
          createdById: ctx.userId,
        },
      });

      const lines: LedgerLine[] = [
        {
          accountId: ar,
          debit: total,
          credit: 0,
          description: `Invoice ${invoice.number}`,
          customerId: customer.id,
        },
        ...input.lines.map((line) => ({
          accountId: line.accountId,
          debit: 0,
          credit: line.amount,
          description: line.description,
          customerId: customer.id,
        })),
      ];
      for (const component of tax.components) {
        const key = payableAccountKey(component.taxType);
        const { [key]: account } = await this.posting.accounts(tx, ctx.dealerId, [key]);
        lines.push({
          accountId: account,
          debit: 0,
          credit: component.taxCents,
          description: `${component.taxType} collected (${component.rate}%)`,
          taxType: component.taxType,
          customerId: customer.id,
        });
      }
      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: `Invoice ${invoice.number} — ${customer.name}`,
        source: 'CUSTOMER_INVOICE',
        sourceType: 'CustomerInvoice',
        sourceId: invoice.id,
        lines,
      });
      await tx.customerInvoice.update({
        where: { id: invoice.id },
        data: { journalEntryId: entry.id },
      });
      await this.tax.recordTaxLines(tx, ctx, {
        calculation: tax,
        province,
        date: input.date,
        direction: 'COLLECTED',
        sourceType: 'CustomerInvoice',
        sourceId: invoice.id,
        journalEntryId: entry.id,
      });
      await recordAudit(tx, ctx, {
        action: 'invoice.created',
        entityType: 'CustomerInvoice',
        entityId: invoice.id,
        after: {
          number: invoice.number,
          customerId: customer.id,
          totalCents: total,
          journal: entry.reference,
        },
      });
      return {
        id: invoice.id,
        number: invoice.number,
        totalCents: total,
        journalEntryId: entry.id,
      };
    });
  }

  /** Voids an unpaid invoice raised here (not a sale's — reverse the sale). */
  async void(ctx: AccountingContext, invoiceId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.customerInvoice.findFirst({
        where: { id: invoiceId, dealerId: ctx.dealerId },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === 'VOID') throw new ConflictException('This invoice is already void');
      if (invoice.saleId)
        throw new ConflictException('This invoice belongs to a sale; reverse the sale instead');
      if (toCents(invoice.amountPaid) > 0)
        throw new ConflictException('Payments are applied to this invoice; reverse them first');
      const reversal = await this.posting.reverse(tx, ctx, invoice.journalEntryId!, { reason });
      await this.tax.reverseTaxLines(tx, ctx, {
        sourceType: 'CustomerInvoice',
        sourceId: invoice.id,
        date: todayIso(),
        journalEntryId: reversal.id,
      });
      await tx.customerInvoice.update({
        where: { id: invoice.id },
        data: { status: 'VOID', voidEntryId: reversal.id },
      });
      await recordAudit(tx, ctx, {
        action: 'invoice.voided',
        entityType: 'CustomerInvoice',
        entityId: invoice.id,
        before: { status: invoice.status },
        after: { status: 'VOID', reversal: reversal.reference },
        reason,
      });
      return { id: invoice.id };
    });
  }

  /** Everything with one customer, oldest first, with a running balance. */
  async statement(ctx: AccountingContext, customerId: string, from: string, to: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, dealerId: ctx.dealerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const ar = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId, subtype: 'RECEIVABLE' },
      select: { id: true },
    });
    const arIds = ar.map((account) => account.id);
    const opening = await this.prisma.journalLine.aggregate({
      where: {
        dealerId: ctx.dealerId,
        customerId,
        accountId: { in: arIds },
        entry: { status: 'POSTED', date: { lt: toDbDate(from) } },
      },
      _sum: { debit: true, credit: true },
    });
    const lines = await this.prisma.journalLine.findMany({
      where: {
        dealerId: ctx.dealerId,
        customerId,
        accountId: { in: arIds },
        entry: { status: 'POSTED', date: { gte: toDbDate(from), lte: toDbDate(to) } },
      },
      include: {
        entry: {
          select: { id: true, date: true, reference: true, description: true, source: true },
        },
      },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });
    let balance = toCents(opening._sum.debit) - toCents(opening._sum.credit);
    const openingCents = balance;
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        address: customer.address,
      },
      from,
      to,
      openingCents,
      lines: lines.map((line) => {
        balance += toCents(line.debit) - toCents(line.credit);
        return {
          date: fromDbDate(line.entry.date),
          reference: line.entry.reference,
          description: line.entry.description,
          source: line.entry.source,
          journalEntryId: line.entry.id,
          chargesCents: toCents(line.debit),
          paymentsCents: toCents(line.credit),
          balanceCents: balance,
        };
      }),
      closingCents: balance,
    };
  }
}
