import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Province, VehicleCostCategory } from '@prisma/client';
import type { BillInput, ReportQuery } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { daysBetween, fromDbDate, toDbDate, todayIso } from '../core/dates';
import { dealerProvince, nextNumber, requireAccount, requireDealerVehicle, requireVendor } from '../core/documents';
import { allocateCents, fromCents, sumCents, toCents } from '../core/money';
import { PostingService, type LedgerLine } from '../journal/posting.service';
import { TaxService, recoverableAccountKey } from '../tax/tax.service';
import { agingBucket } from '../reports/aging';

const BILLABLE_ASSET_SUBTYPES = ['INVENTORY', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET'];

/**
 * Accounts payable: vendor bills and credit notes. A bill debits what was
 * bought (an expense, cost of sales, a fixed asset, or a vehicle's inventory
 * cost), debits recoverable GST/HST/QST to its own account, folds
 * non-recoverable PST into the cost, and credits Accounts Payable.
 */
@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly tax: TaxService,
  ) {}

  async list(ctx: AccountingContext, query: ReportQuery) {
    const rows = await this.prisma.vendorBill.findMany({
      where: {
        dealerId: ctx.dealerId,
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.q
          ? { OR: [{ vendorReference: { contains: query.q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: [{ dueDate: 'asc' }],
      include: { vendor: { select: { id: true, name: true } } },
      take: 1000,
    });
    const today = todayIso();
    return rows.map((row) => {
      const balance = toCents(row.total) - toCents(row.amountPaid);
      const dueDate = fromDbDate(row.dueDate);
      const open = row.status !== 'VOID' && balance > 0;
      return {
        id: row.id,
        number: row.number,
        kind: row.kind,
        vendor: row.vendor,
        vendorReference: row.vendorReference,
        date: fromDbDate(row.date),
        dueDate,
        subtotalCents: toCents(row.subtotal),
        taxCents: toCents(row.taxTotal),
        totalCents: toCents(row.total),
        paidCents: toCents(row.amountPaid),
        balanceCents: row.status === 'VOID' ? 0 : balance,
        status: row.status,
        daysUntilDue: open ? daysBetween(today, dueDate) : null,
        agingBucket: open && row.kind === 'BILL' ? agingBucket(dueDate, today) : null,
        journalEntryId: row.journalEntryId,
      };
    });
  }

  async create(ctx: AccountingContext, input: BillInput) {
    return this.prisma.$transaction(async (tx) => {
      const vendor = await requireVendor(tx, ctx, input.vendorId);
      const { VEHICLE_INVENTORY: inventory, AP: ap } = await this.posting.accounts(tx, ctx.dealerId, [
        'VEHICLE_INVENTORY',
        'AP',
      ]);
      for (const line of input.lines) {
        const account = await requireAccount(tx, ctx, line.accountId);
        const allowed =
          account.type === 'EXPENSE' ||
          account.type === 'COGS' ||
          (account.type === 'ASSET' && BILLABLE_ASSET_SUBTYPES.includes(account.subtype));
        if (!allowed) throw new BadRequestException(`A bill cannot be charged to ${account.name}`);
        if (account.id === inventory && !line.vehicleId) {
          throw new BadRequestException('Choose the vehicle a vehicle-inventory line belongs to');
        }
        if (line.vehicleId) await requireDealerVehicle(tx, ctx, line.vehicleId);
      }

      const { province: dealerHome } = await dealerProvince(tx, ctx.dealerId);
      const province = (input.taxProvince ?? vendor.province ?? dealerHome) as Province;
      const tax = input.vendorChargedTax
        ? await this.tax.calculate(tx, ctx.dealerId, {
            province,
            date: input.date,
            lines: input.lines.map((line) => ({ category: line.taxCategory, amountCents: line.amount })),
          })
        : null;
      const recoverable = (tax?.components ?? []).filter((component) => component.recoverable);
      const nonRecoverable = (tax?.components ?? []).filter((component) => !component.recoverable);
      const nonRecoverableCents = sumCents(nonRecoverable.map((component) => component.taxCents));
      // PST the dealer cannot recover is part of what each line cost.
      const loaded = allocateCents(
        nonRecoverableCents,
        input.lines.map((line) => line.amount),
      ).map((extra, index) => input.lines[index]!.amount + extra);

      const subtotal = sumCents(input.lines.map((line) => line.amount));
      const taxTotal = sumCents((tax?.components ?? []).map((component) => component.taxCents));
      const total = subtotal + taxTotal;
      const credit = input.kind === 'CREDIT_NOTE';

      const bill = await tx.vendorBill.create({
        data: {
          dealerId: ctx.dealerId,
          number: await nextNumber(tx, ctx.dealerId, 'nextBillNumber'),
          kind: input.kind,
          vendorId: vendor.id,
          vendorReference: input.vendorReference,
          date: toDbDate(input.date),
          dueDate: toDbDate(input.dueDate),
          lines: input.lines.map((line, index) => ({
            accountId: line.accountId,
            description: line.description,
            amountCents: line.amount,
            costCents: loaded[index],
            vehicleId: line.vehicleId,
            costCategory: line.costCategory,
            taxCategory: line.taxCategory,
          })),
          subtotal: fromCents(subtotal),
          taxTotal: fromCents(taxTotal),
          total: fromCents(total),
          notes: input.notes,
          createdById: ctx.userId,
        },
      });

      const lines: LedgerLine[] = input.lines.map((line, index) => ({
        accountId: line.accountId,
        debit: credit ? 0 : loaded[index]!,
        credit: credit ? loaded[index]! : 0,
        description: line.description,
        vendorId: vendor.id,
        vehicleId: line.vehicleId,
        costCategory: line.accountId === inventory ? ((line.costCategory as VehicleCostCategory | null) ?? 'OTHER') : null,
      }));
      for (const component of recoverable) {
        const key = recoverableAccountKey(component.taxType);
        const { [key]: account } = await this.posting.accounts(tx, ctx.dealerId, [key]);
        lines.push({
          accountId: account,
          debit: credit ? 0 : component.taxCents,
          credit: credit ? component.taxCents : 0,
          description: `${component.taxType} ${credit ? 'credited' : 'paid'} (recoverable)`,
          taxType: component.taxType,
          vendorId: vendor.id,
        });
      }
      lines.push({
        accountId: ap,
        debit: credit ? total : 0,
        credit: credit ? 0 : total,
        description: `${credit ? 'Credit note' : 'Bill'} ${input.vendorReference ?? `#${bill.number}`}`,
        vendorId: vendor.id,
      });

      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: `${credit ? 'Vendor credit' : 'Vendor bill'} — ${vendor.name}${input.vendorReference ? ` ${input.vendorReference}` : ''}`,
        memo: input.notes,
        source: credit ? 'VENDOR_CREDIT' : 'VENDOR_BILL',
        sourceType: 'VendorBill',
        sourceId: bill.id,
        lines,
      });
      await tx.vendorBill.update({ where: { id: bill.id }, data: { journalEntryId: entry.id } });

      // Vehicle costs billed here show on the vehicle's Costs page too.
      const vehicleLines = input.lines
        .map((line, index) => ({ line, cost: loaded[index]! }))
        .filter(({ line }) => line.accountId === inventory && line.vehicleId);
      if (vehicleLines.length > 0) {
        await tx.vehicleCost.createMany({
          data: vehicleLines.map(({ line, cost }) => ({
            vehicleId: line.vehicleId!,
            category: (line.costCategory as VehicleCostCategory | null) ?? 'OTHER',
            description: line.description,
            amountCents: credit ? -cost : cost,
            incurredOn: toDbDate(input.date),
            vendor: vendor.name,
            reference: input.vendorReference,
            recordedById: ctx.userId,
            journalEntryId: entry.id,
          })),
        });
      }

      if (tax) {
        await this.tax.recordTaxLines(tx, ctx, {
          calculation: credit
            ? {
                ...tax,
                grossCents: -tax.grossCents,
                components: tax.components.map((component) => ({
                  ...component,
                  taxCents: -component.taxCents,
                  taxableCents: -component.taxableCents,
                  tradeInDeductedCents: -component.tradeInDeductedCents,
                })),
              }
            : tax,
          province,
          date: input.date,
          direction: 'PAID',
          sourceType: 'VendorBill',
          sourceId: bill.id,
          journalEntryId: entry.id,
        });
      }

      await recordAudit(tx, ctx, {
        action: credit ? 'bill.credit_created' : 'bill.created',
        entityType: 'VendorBill',
        entityId: bill.id,
        after: { vendorId: vendor.id, totalCents: total, taxCents: taxTotal, journal: entry.reference },
      });
      return { id: bill.id, number: bill.number, totalCents: total, journalEntryId: entry.id };
    });
  }

  /** Uses a vendor's credit note against one of their bills. No cash moves. */
  async applyCredit(ctx: AccountingContext, creditId: string, billId: string, amount: number) {
    return this.prisma.$transaction(async (tx) => {
      const [credit, bill] = await Promise.all([
        tx.vendorBill.findFirst({ where: { id: creditId, dealerId: ctx.dealerId, kind: 'CREDIT_NOTE' } }),
        tx.vendorBill.findFirst({ where: { id: billId, dealerId: ctx.dealerId, kind: 'BILL' } }),
      ]);
      if (!credit || !bill) throw new NotFoundException('Credit note or bill not found');
      if (credit.vendorId !== bill.vendorId) throw new BadRequestException('The credit and the bill are from different vendors');
      if (credit.status === 'VOID' || bill.status === 'VOID') throw new ConflictException('One of them is void');
      const creditLeft = toCents(credit.total) - toCents(credit.amountPaid);
      const billLeft = toCents(bill.total) - toCents(bill.amountPaid);
      if (amount > creditLeft || amount > billLeft) throw new BadRequestException('That is more than is open on one of them');
      await tx.vendorBill.update({
        where: { id: credit.id },
        data: { amountPaid: fromCents(toCents(credit.amountPaid) + amount), status: settlement(toCents(credit.total), toCents(credit.amountPaid) + amount) },
      });
      await tx.vendorBill.update({
        where: { id: bill.id },
        data: { amountPaid: fromCents(toCents(bill.amountPaid) + amount), status: settlement(toCents(bill.total), toCents(bill.amountPaid) + amount) },
      });
      await recordAudit(tx, ctx, {
        action: 'bill.credit_applied',
        entityType: 'VendorBill',
        entityId: bill.id,
        after: { creditId: credit.id, amountCents: amount },
      });
      return { billId: bill.id, creditId: credit.id };
    });
  }

  async void(ctx: AccountingContext, billId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findFirst({ where: { id: billId, dealerId: ctx.dealerId } });
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.status === 'VOID') throw new ConflictException('This bill is already void');
      if (toCents(bill.amountPaid) > 0) throw new ConflictException('Payments or credits are applied; reverse them first');
      const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: bill.journalEntryId! } });
      if (entry.sourceType !== 'VendorBill') {
        throw new ConflictException(`This bill came from a ${entry.sourceType}; void it there`);
      }
      const reversal = await this.posting.reverse(tx, ctx, entry.id, { reason });
      await this.tax.reverseTaxLines(tx, ctx, { sourceType: 'VendorBill', sourceId: bill.id, date: todayIso(), journalEntryId: reversal.id });
      await tx.vehicleCost.deleteMany({ where: { journalEntryId: entry.id } });
      await tx.vendorBill.update({ where: { id: bill.id }, data: { status: 'VOID', voidEntryId: reversal.id } });
      await recordAudit(tx, ctx, {
        action: 'bill.voided',
        entityType: 'VendorBill',
        entityId: bill.id,
        before: { status: bill.status },
        after: { status: 'VOID', reversal: reversal.reference },
        reason,
      });
      return { id: bill.id };
    });
  }

  /** Everything with one vendor, oldest first, with a running balance owed. */
  async statement(ctx: AccountingContext, vendorId: string, from: string, to: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, dealerId: ctx.dealerId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const ap = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId, subtype: 'PAYABLE' },
      select: { id: true },
    });
    const apIds = ap.map((account) => account.id);
    const opening = await this.prisma.journalLine.aggregate({
      where: {
        dealerId: ctx.dealerId,
        vendorId,
        accountId: { in: apIds },
        entry: { status: 'POSTED', date: { lt: toDbDate(from) } },
      },
      _sum: { debit: true, credit: true },
    });
    const lines = await this.prisma.journalLine.findMany({
      where: {
        dealerId: ctx.dealerId,
        vendorId,
        accountId: { in: apIds },
        entry: { status: 'POSTED', date: { gte: toDbDate(from), lte: toDbDate(to) } },
      },
      include: { entry: { select: { id: true, date: true, reference: true, description: true, source: true } } },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });
    let balance = toCents(opening._sum.credit) - toCents(opening._sum.debit);
    const openingCents = balance;
    return {
      vendor: { id: vendor.id, name: vendor.name, email: vendor.email },
      from,
      to,
      openingCents,
      lines: lines.map((line) => {
        balance += toCents(line.credit) - toCents(line.debit);
        return {
          date: fromDbDate(line.entry.date),
          reference: line.entry.reference,
          description: line.entry.description,
          source: line.entry.source,
          journalEntryId: line.entry.id,
          billedCents: toCents(line.credit),
          paidCents: toCents(line.debit),
          balanceCents: balance,
        };
      }),
      closingCents: balance,
    };
  }
}

export function settlement(total: number, paid: number) {
  if (paid <= 0) return 'OPEN' as const;
  if (paid >= total) return 'PAID' as const;
  return 'PARTIAL' as const;
}

