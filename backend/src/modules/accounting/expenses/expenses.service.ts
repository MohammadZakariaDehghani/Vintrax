import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Province, VehicleCostCategory } from '@prisma/client';
import type { ExpenseInput, RecurringExpenseInput, ReportQuery } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { addMonths, addDays, fromDbDate, toDbDate, todayIso } from '../core/dates';
import {
  dealerProvince,
  nextNumber,
  requireAccount,
  requireDealerVehicle,
  requireVendor,
} from '../core/documents';
import { fromCents, sumCents, toCents } from '../core/money';
import { bankGlAccount } from '../banking/bank-accounts';
import { PostingService, type LedgerLine } from '../journal/posting.service';
import { TaxService, recoverableAccountKey } from '../tax/tax.service';
import { resolveRange } from '../reports/date-ranges';

type Tx = Prisma.TransactionClient;

/**
 * Expenses paid on the spot (by cash, bank or card). The treatment decides
 * where the cost lands:
 *
 *  - OPERATING      a dealership expense account
 *  - VEHICLE_COST   the vehicle's inventory cost (it raises book value and so
 *                   cost of sales when the car sells)
 *  - COGS           cost of sales directly
 *  - CAPITAL        a fixed asset
 *
 * Recoverable GST/HST/QST goes to its own account; PST is part of the cost.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly tax: TaxService,
  ) {}

  async list(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'THIS_MONTH');
    const rows = await this.prisma.expense.findMany({
      where: {
        dealerId: ctx.dealerId,
        date: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.q ? { description: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      include: {
        vendor: { select: { id: true, name: true } },
        account: { select: { id: true, code: true, name: true } },
        vehicle: { select: { id: true, vin: true, year: true, make: true, model: true } },
        bankAccount: { select: { id: true, name: true } },
      },
      take: 1000,
    });
    const items = rows.map((row) => ({
      id: row.id,
      number: row.number,
      date: fromDbDate(row.date),
      vendor: row.vendor,
      account: row.account,
      treatment: row.treatment,
      vehicle: row.vehicle,
      costCategory: row.costCategory,
      description: row.description,
      amountCents: toCents(row.amount),
      taxCents: toCents(row.taxTotal),
      totalCents: toCents(row.total),
      method: row.method,
      bankAccount: row.bankAccount,
      reference: row.reference,
      status: row.status,
      recurring: Boolean(row.recurringExpenseId),
      journalEntryId: row.journalEntryId,
    }));
    return {
      range,
      items,
      totalCents: sumCents(
        items.filter((item) => item.status === 'POSTED').map((item) => item.totalCents),
      ),
    };
  }

  async create(
    ctx: AccountingContext,
    input: ExpenseInput,
    recurringExpenseId: string | null = null,
  ) {
    return this.prisma.$transaction((tx) => this.post(tx, ctx, input, recurringExpenseId));
  }

  private async post(
    tx: Tx,
    ctx: AccountingContext,
    input: ExpenseInput,
    recurringExpenseId: string | null,
  ) {
    const vendor = input.vendorId ? await requireVendor(tx, ctx, input.vendorId) : null;
    const vehicle = input.vehicleId ? await requireDealerVehicle(tx, ctx, input.vehicleId) : null;
    const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
    const { VEHICLE_INVENTORY: inventory } = await this.posting.accounts(tx, ctx.dealerId, [
      'VEHICLE_INVENTORY',
    ]);

    let debitAccount = input.accountId;
    if (input.treatment === 'VEHICLE_COST') {
      debitAccount = inventory;
    } else {
      const account = await requireAccount(tx, ctx, input.accountId);
      const ok =
        (input.treatment === 'OPERATING' && account.type === 'EXPENSE') ||
        (input.treatment === 'COGS' && account.type === 'COGS') ||
        (input.treatment === 'CAPITAL' && account.subtype === 'FIXED_ASSET');
      if (!ok) {
        throw new BadRequestException(
          input.treatment === 'OPERATING'
            ? 'Choose an expense account'
            : input.treatment === 'COGS'
              ? 'Choose a cost-of-sales account'
              : 'Choose a fixed-asset account',
        );
      }
    }

    const { province: dealerHome } = await dealerProvince(tx, ctx.dealerId);
    const province = (input.taxProvince ?? dealerHome) as Province;
    const tax = input.applyTax
      ? await this.tax.calculate(tx, ctx.dealerId, {
          province,
          date: input.date,
          lines: [{ category: input.taxCategory, amountCents: input.amount }],
        })
      : null;
    const recoverable = (tax?.components ?? []).filter((component) => component.recoverable);
    const nonRecoverable = sumCents(
      (tax?.components ?? []).filter((c) => !c.recoverable).map((c) => c.taxCents),
    );
    const taxTotal = sumCents((tax?.components ?? []).map((component) => component.taxCents));
    const total = input.amount + taxTotal;
    const cost = input.amount + nonRecoverable;
    const costCategory: VehicleCostCategory | null =
      input.treatment === 'VEHICLE_COST'
        ? ((input.costCategory as VehicleCostCategory | null) ?? 'OTHER')
        : null;

    const expense = await tx.expense.create({
      data: {
        dealerId: ctx.dealerId,
        number: await nextNumber(tx, ctx.dealerId, 'nextExpenseNumber'),
        date: toDbDate(input.date),
        vendorId: vendor?.id ?? null,
        accountId: debitAccount,
        treatment: input.treatment,
        vehicleId: vehicle?.id ?? null,
        costCategory,
        description: input.description,
        amount: fromCents(input.amount),
        taxTotal: fromCents(taxTotal),
        total: fromCents(total),
        taxProvince: province,
        method: input.method,
        bankAccountId: bank.id,
        reference: input.reference,
        notes: input.notes,
        recurringExpenseId,
        createdById: ctx.userId,
      },
    });

    const lines: LedgerLine[] = [
      {
        accountId: debitAccount,
        debit: cost,
        credit: 0,
        description: input.description,
        vendorId: vendor?.id ?? null,
        vehicleId: vehicle?.id ?? null,
        costCategory,
      },
    ];
    for (const component of recoverable) {
      const key = recoverableAccountKey(component.taxType);
      const { [key]: account } = await this.posting.accounts(tx, ctx.dealerId, [key]);
      lines.push({
        accountId: account,
        debit: component.taxCents,
        credit: 0,
        description: `${component.taxType} paid (recoverable)`,
        taxType: component.taxType,
        vendorId: vendor?.id ?? null,
      });
    }
    lines.push({
      accountId: bank.glAccountId,
      debit: 0,
      credit: total,
      description: input.description,
      vendorId: vendor?.id ?? null,
    });

    const entry = await this.posting.post(tx, ctx, {
      date: input.date,
      description: `Expense #${expense.number} — ${input.description}${vendor ? ` (${vendor.name})` : ''}`,
      memo: input.notes,
      source: input.treatment === 'VEHICLE_COST' ? 'VEHICLE_COST' : 'EXPENSE',
      sourceType: 'Expense',
      sourceId: expense.id,
      lines,
    });

    let vehicleCostId: string | null = null;
    if (input.treatment === 'VEHICLE_COST' && vehicle) {
      const vehicleCost = await tx.vehicleCost.create({
        data: {
          vehicleId: vehicle.id,
          category: costCategory!,
          description: input.description,
          amountCents: cost,
          incurredOn: toDbDate(input.date),
          vendor: vendor?.name ?? null,
          reference: input.reference,
          recordedById: ctx.userId,
          journalEntryId: entry.id,
        },
      });
      vehicleCostId = vehicleCost.id;
    }
    await tx.expense.update({
      where: { id: expense.id },
      data: { journalEntryId: entry.id, vehicleCostId },
    });

    if (tax) {
      await this.tax.recordTaxLines(tx, ctx, {
        calculation: tax,
        province,
        date: input.date,
        direction: 'PAID',
        sourceType: 'Expense',
        sourceId: expense.id,
        journalEntryId: entry.id,
      });
    }
    await recordAudit(tx, ctx, {
      action: 'expense.created',
      entityType: 'Expense',
      entityId: expense.id,
      after: {
        number: expense.number,
        treatment: input.treatment,
        accountId: debitAccount,
        vehicleId: vehicle?.id,
        amountCents: input.amount,
        taxCents: taxTotal,
        journal: entry.reference,
      },
    });
    return { id: expense.id, number: expense.number, totalCents: total, journalEntryId: entry.id };
  }

  async reverse(ctx: AccountingContext, expenseId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id: expenseId, dealerId: ctx.dealerId },
      });
      if (!expense) throw new NotFoundException('Expense not found');
      if (expense.status !== 'POSTED')
        throw new ConflictException('This expense is already reversed');
      const reconciled = await tx.journalLine.count({
        where: { entryId: expense.journalEntryId!, reconciliationId: { not: null } },
      });
      if (reconciled > 0)
        throw new ConflictException(
          'This expense has been reconciled with the bank; post an adjustment instead',
        );
      if (expense.vehicleId && expense.treatment === 'VEHICLE_COST') {
        const sold = await tx.vehicleSale.findFirst({
          where: {
            dealerId: ctx.dealerId,
            vehicleId: expense.vehicleId,
            status: 'POSTED',
            saleDate: { gte: expense.date },
          },
        });
        if (sold)
          throw new ConflictException(
            'The vehicle has been sold since; post an adjustment instead',
          );
      }
      const reversal = await this.posting.reverse(tx, ctx, expense.journalEntryId!, { reason });
      await this.tax.reverseTaxLines(tx, ctx, {
        sourceType: 'Expense',
        sourceId: expense.id,
        date: todayIso(),
        journalEntryId: reversal.id,
      });
      if (expense.vehicleCostId)
        await tx.vehicleCost.deleteMany({ where: { id: expense.vehicleCostId } });
      await tx.expense.update({
        where: { id: expense.id },
        data: { status: 'VOID', reversalEntryId: reversal.id },
      });
      await recordAudit(tx, ctx, {
        action: 'expense.reversed',
        entityType: 'Expense',
        entityId: expense.id,
        before: { status: 'POSTED' },
        after: { status: 'VOID', reversal: reversal.reference },
        reason,
      });
      return { id: expense.id, reversalEntryId: reversal.id };
    });
  }

  // --- Recurring expenses ---------------------------------------------------

  async recurring(ctx: AccountingContext) {
    const rows = await this.prisma.recurringExpense.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: { nextDate: 'asc' },
      include: {
        account: { select: { id: true, code: true, name: true } },
        bankAccount: { select: { id: true, name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      vendorId: row.vendorId,
      account: row.account,
      amountCents: toCents(row.amount),
      applyTax: row.applyTax,
      method: row.method,
      bankAccount: row.bankAccount,
      frequency: row.frequency,
      nextDate: fromDbDate(row.nextDate),
      endDate: row.endDate ? fromDbDate(row.endDate) : null,
      isActive: row.isActive,
      due: row.isActive && fromDbDate(row.nextDate) <= todayIso(),
    }));
  }

  async createRecurring(ctx: AccountingContext, input: RecurringExpenseInput) {
    return this.prisma.$transaction(async (tx) => {
      const account = await requireAccount(tx, ctx, input.accountId);
      if (account.type !== 'EXPENSE') throw new BadRequestException('Choose an expense account');
      await bankGlAccount(tx, ctx, input.bankAccountId);
      if (input.vendorId) await requireVendor(tx, ctx, input.vendorId);
      const row = await tx.recurringExpense.create({
        data: {
          dealerId: ctx.dealerId,
          description: input.description,
          vendorId: input.vendorId,
          accountId: input.accountId,
          amount: fromCents(input.amount),
          applyTax: input.applyTax,
          method: input.method,
          bankAccountId: input.bankAccountId,
          frequency: input.frequency,
          nextDate: toDbDate(input.nextDate),
          endDate: input.endDate ? toDbDate(input.endDate) : null,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'expense.recurring_created',
        entityType: 'RecurringExpense',
        entityId: row.id,
        after: input,
      });
      return { id: row.id };
    });
  }

  async setRecurringActive(ctx: AccountingContext, id: string, isActive: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.recurringExpense.findFirst({ where: { id, dealerId: ctx.dealerId } });
      if (!row) throw new NotFoundException('Recurring expense not found');
      await tx.recurringExpense.update({ where: { id }, data: { isActive } });
      await recordAudit(tx, ctx, {
        action: isActive ? 'expense.recurring_resumed' : 'expense.recurring_paused',
        entityType: 'RecurringExpense',
        entityId: id,
      });
      return { id, isActive };
    });
  }

  /**
   * Posts every recurring expense that has come due, once per occurrence up to
   * today. There is no scheduler in Vintrax, so someone with permission runs
   * this (the accounting overview offers it when something is due).
   */
  async postDueRecurring(ctx: AccountingContext) {
    const today = todayIso();
    const due = await this.prisma.recurringExpense.findMany({
      where: { dealerId: ctx.dealerId, isActive: true, nextDate: { lte: toDbDate(today) } },
    });
    const posted: Array<{ id: string; number: number }> = [];
    for (const template of due) {
      await this.prisma.$transaction(async (tx) => {
        let next = fromDbDate(template.nextDate);
        let guard = 0;
        while (next <= today && guard < 60) {
          if (template.endDate && next > fromDbDate(template.endDate)) break;
          const result = await this.post(
            tx,
            ctx,
            {
              date: next,
              vendorId: template.vendorId,
              accountId: template.accountId,
              treatment: 'OPERATING',
              vehicleId: null,
              costCategory: null,
              description: template.description,
              amount: toCents(template.amount),
              applyTax: template.applyTax,
              taxCategory: 'GENERAL',
              taxProvince: null,
              method: template.method,
              bankAccountId: template.bankAccountId,
              reference: null,
              notes: 'Recurring expense',
            },
            template.id,
          );
          posted.push({ id: result.id, number: result.number });
          next = advance(next, template.frequency);
          guard += 1;
        }
        await tx.recurringExpense.update({
          where: { id: template.id },
          data: {
            nextDate: toDbDate(next),
            isActive: template.endDate ? next <= fromDbDate(template.endDate) : true,
          },
        });
      });
    }
    return { posted };
  }
}

function advance(date: string, frequency: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'): string {
  if (frequency === 'WEEKLY') return addDays(date, 7);
  if (frequency === 'MONTHLY') return addMonths(date, 1);
  if (frequency === 'QUARTERLY') return addMonths(date, 3);
  return addMonths(date, 12);
}
