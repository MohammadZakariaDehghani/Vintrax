import { Injectable } from '@nestjs/common';
import { AGING_BUCKETS, type AgingBucket, type ReportQuery } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import {
  addDays,
  addMonths,
  daysBetween,
  fromDbDate,
  todayIso,
  toDbDate,
  type DateRange,
  type IsoDate,
} from '../core/dates';
import { sumCents, toCents } from '../core/money';
import { RECONDITIONING_CATEGORIES } from '../accounts/chart-of-accounts';
import { TaxService } from '../tax/tax.service';
import { agingBucket, emptyBuckets } from './aging';
import { accountTotals, debitBalance, normalBalance } from './ledger';
import { comparisonRange, fiscalCalendar, rangeFor, resolveRange } from './date-ranges';
import { StatementsService } from './statements.service';

export interface VehicleProfitRow {
  vehicleId: string;
  vin: string | null;
  stockNumber: string | null;
  year: number;
  make: string;
  model: string;
  bodyType: string;
  purchaseCostCents: number;
  additionalCostsCents: number;
  reconditioningCents: number;
  totalCostCents: number;
  bookValueCents: number;
  acquiredOn: IsoDate | null;
  soldOn: IsoDate | null;
  daysInInventory: number | null;
  salePriceCents: number | null;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number | null;
  grossMarginBasisPoints: number | null;
  status: 'IN_STOCK' | 'SOLD';
  saleId: string | null;
  salesperson: { id: string; name: string } | null;
}

/** Inventory, receivables, payables and the dealership KPIs — from the ledger. */
@Injectable()
export class OperationsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: StatementsService,
    private readonly tax: TaxService,
  ) {}

  // --- Aging ------------------------------------------------------------------------

  async arAging(ctx: AccountingContext, asOf: IsoDate = todayIso()) {
    const invoices = await this.prisma.customerInvoice.findMany({
      where: {
        dealerId: ctx.dealerId,
        status: { in: ['OPEN', 'PARTIAL'] },
        date: { lte: toDbDate(asOf) },
      },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const byCustomer = new Map<
      string,
      {
        customer: { id: string; name: string };
        buckets: Record<AgingBucket, number>;
        totalCents: number;
        invoices: number;
      }
    >();
    const totals = emptyBuckets();
    const items = invoices.map((invoice) => {
      const balance = toCents(invoice.total) - toCents(invoice.amountPaid);
      const bucket = agingBucket(fromDbDate(invoice.dueDate), asOf);
      const row = byCustomer.get(invoice.customerId) ?? {
        customer: invoice.customer,
        buckets: emptyBuckets(),
        totalCents: 0,
        invoices: 0,
      };
      row.buckets[bucket] += balance;
      row.totalCents += balance;
      row.invoices += 1;
      byCustomer.set(invoice.customerId, row);
      totals[bucket] += balance;
      return {
        id: invoice.id,
        number: invoice.number,
        customer: invoice.customer,
        date: fromDbDate(invoice.date),
        dueDate: fromDbDate(invoice.dueDate),
        daysOverdue: Math.max(0, daysBetween(fromDbDate(invoice.dueDate), asOf)),
        bucket,
        balanceCents: balance,
      };
    });
    return {
      asOf,
      buckets: totals,
      totalCents: sumCents(AGING_BUCKETS.map((bucket) => totals[bucket])),
      byCustomer: [...byCustomer.values()].sort((a, b) => b.totalCents - a.totalCents),
      items,
    };
  }

  async apAging(ctx: AccountingContext, asOf: IsoDate = todayIso()) {
    const bills = await this.prisma.vendorBill.findMany({
      where: {
        dealerId: ctx.dealerId,
        kind: 'BILL',
        status: { in: ['OPEN', 'PARTIAL'] },
        date: { lte: toDbDate(asOf) },
      },
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const byVendor = new Map<
      string,
      {
        vendor: { id: string; name: string };
        buckets: Record<AgingBucket, number>;
        totalCents: number;
        bills: number;
      }
    >();
    const totals = emptyBuckets();
    const items = bills.map((bill) => {
      const balance = toCents(bill.total) - toCents(bill.amountPaid);
      const dueDate = fromDbDate(bill.dueDate);
      const bucket = agingBucket(dueDate, asOf);
      const row = byVendor.get(bill.vendorId) ?? {
        vendor: bill.vendor,
        buckets: emptyBuckets(),
        totalCents: 0,
        bills: 0,
      };
      row.buckets[bucket] += balance;
      row.totalCents += balance;
      row.bills += 1;
      byVendor.set(bill.vendorId, row);
      totals[bucket] += balance;
      return {
        id: bill.id,
        number: bill.number,
        vendor: bill.vendor,
        vendorReference: bill.vendorReference,
        date: fromDbDate(bill.date),
        dueDate,
        daysUntilDue: daysBetween(asOf, dueDate),
        bucket,
        balanceCents: balance,
      };
    });
    return {
      asOf,
      buckets: totals,
      totalCents: sumCents(AGING_BUCKETS.map((bucket) => totals[bucket])),
      byVendor: [...byVendor.values()].sort((a, b) => b.totalCents - a.totalCents),
      items,
      upcoming: items.filter((item) => item.daysUntilDue >= 0 && item.daysUntilDue <= 14),
    };
  }

  // --- Vehicle profitability -----------------------------------------------------------

  /**
   * One row per vehicle that has been on the books: its costs, book value,
   * sale, gross profit and days in stock — every figure from journal lines
   * tagged with the vehicle, none of them a stored profit number.
   */
  async vehicleRows(ctx: AccountingContext): Promise<VehicleProfitRow[]> {
    const accounts = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId },
      select: { id: true, type: true, systemKey: true },
    });
    const inventory = accounts.find((account) => account.systemKey === 'VEHICLE_INVENTORY')!.id;
    const typeOf = new Map(accounts.map((account) => [account.id, account.type]));

    const byAccount = await this.prisma.journalLine.groupBy({
      by: ['vehicleId', 'accountId'],
      where: { dealerId: ctx.dealerId, vehicleId: { not: null }, entry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    const byCategory = await this.prisma.journalLine.groupBy({
      by: ['vehicleId', 'costCategory'],
      where: {
        dealerId: ctx.dealerId,
        vehicleId: { not: null },
        accountId: inventory,
        costCategory: { not: null },
        entry: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });
    const vehicleIds = [...new Set(byAccount.map((row) => row.vehicleId!))];
    if (vehicleIds.length === 0) return [];

    const [vehicles, acquisitions, sales] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { id: { in: vehicleIds }, sellerId: ctx.ownerUserId },
        select: {
          id: true,
          vin: true,
          stockNumber: true,
          year: true,
          make: true,
          model: true,
          bodyType: true,
        },
      }),
      this.prisma.vehicleAcquisition.findMany({
        where: { dealerId: ctx.dealerId, vehicleId: { in: vehicleIds }, status: 'POSTED' },
        select: { vehicleId: true, date: true },
        orderBy: { date: 'desc' },
      }),
      this.prisma.vehicleSale.findMany({
        where: { dealerId: ctx.dealerId, vehicleId: { in: vehicleIds }, status: 'POSTED' },
        select: {
          id: true,
          vehicleId: true,
          saleDate: true,
          salePrice: true,
          discount: true,
          salesperson: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { saleDate: 'desc' },
      }),
    ]);

    const today = todayIso();
    return vehicles.map((vehicle) => {
      const mine = byAccount.filter((row) => row.vehicleId === vehicle.id);
      const sum = (filter: (accountId: string) => boolean, sign: 1 | -1) =>
        sumCents(
          mine
            .filter((row) => filter(row.accountId))
            .map((row) => sign * (toCents(row._sum.debit) - toCents(row._sum.credit))),
        );
      const bookValue = sum((id) => id === inventory, 1);
      const cogs = sum((id) => typeOf.get(id) === 'COGS', 1);
      const revenue = sum((id) => typeOf.get(id) === 'REVENUE', -1);
      const categories = byCategory.filter((row) => row.vehicleId === vehicle.id);
      const categoryTotal = (category: string) =>
        sumCents(
          categories
            .filter((row) => row.costCategory === category)
            .map((row) => toCents(row._sum.debit) - toCents(row._sum.credit)),
        );
      const totalCost = bookValue + cogs;
      const purchase = categoryTotal('PURCHASE');
      const recon = sumCents(RECONDITIONING_CATEGORIES.map((category) => categoryTotal(category)));
      const acquisition = acquisitions.find((row) => row.vehicleId === vehicle.id);
      const sale = sales.find((row) => row.vehicleId === vehicle.id);
      const soldOn = sale ? fromDbDate(sale.saleDate) : null;
      const acquiredOn = acquisition ? fromDbDate(acquisition.date) : null;
      const sold = Boolean(sale) && bookValue === 0;
      return {
        vehicleId: vehicle.id,
        vin: vehicle.vin,
        stockNumber: vehicle.stockNumber,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        bodyType: vehicle.bodyType,
        purchaseCostCents: purchase,
        additionalCostsCents: totalCost - purchase,
        reconditioningCents: recon,
        totalCostCents: totalCost,
        bookValueCents: bookValue,
        acquiredOn,
        soldOn: sold ? soldOn : null,
        daysInInventory: acquiredOn
          ? daysBetween(acquiredOn, sold && soldOn ? soldOn : today)
          : null,
        salePriceCents: sale && sold ? toCents(sale.salePrice) - toCents(sale.discount) : null,
        revenueCents: revenue,
        cogsCents: cogs,
        grossProfitCents: sold ? revenue - cogs : null,
        grossMarginBasisPoints:
          sold && revenue > 0 ? Math.round(((revenue - cogs) * 10_000) / revenue) : null,
        status: sold ? 'SOLD' : 'IN_STOCK',
        saleId: sold ? (sale?.id ?? null) : null,
        salesperson:
          sold && sale?.salesperson
            ? {
                id: sale.salesperson.id,
                name: `${sale.salesperson.firstName} ${sale.salesperson.lastName}`,
              }
            : null,
      };
    });
  }

  async vehicleProfitability(ctx: AccountingContext, query: ReportQuery) {
    let rows = await this.vehicleRows(ctx);
    const range =
      query.preset || (query.from && query.to)
        ? await resolveRange(this.prisma, ctx.dealerId, query)
        : null;
    if (range)
      rows = rows.filter(
        (row) =>
          (row.soldOn ?? row.acquiredOn ?? '') >= range.from &&
          (row.soldOn ?? row.acquiredOn ?? '') <= range.to,
      );
    if (query.make)
      rows = rows.filter((row) => row.make.toLowerCase() === query.make!.toLowerCase());
    if (query.model)
      rows = rows.filter((row) => row.model.toLowerCase() === query.model!.toLowerCase());
    if (query.status === 'SOLD' || query.status === 'IN_STOCK')
      rows = rows.filter((row) => row.status === query.status);
    if (query.salespersonId)
      rows = rows.filter((row) => row.salesperson?.id === query.salespersonId);
    if (query.vin) rows = rows.filter((row) => row.vin?.includes(query.vin!));
    if (query.profitability === 'PROFITABLE')
      rows = rows.filter((row) => (row.grossProfitCents ?? 0) > 0);
    if (query.profitability === 'LOSS')
      rows = rows.filter((row) => (row.grossProfitCents ?? 0) < 0);
    if (query.minAgeDays !== undefined)
      rows = rows.filter((row) => (row.daysInInventory ?? 0) >= query.minAgeDays!);
    rows.sort((a, b) =>
      (b.soldOn ?? b.acquiredOn ?? '').localeCompare(a.soldOn ?? a.acquiredOn ?? ''),
    );
    const sold = rows.filter((row) => row.status === 'SOLD');
    return {
      range,
      rows,
      totals: {
        vehicles: rows.length,
        sold: sold.length,
        totalCostCents: sumCents(rows.map((row) => row.totalCostCents)),
        revenueCents: sumCents(sold.map((row) => row.revenueCents)),
        grossProfitCents: sumCents(sold.map((row) => row.grossProfitCents ?? 0)),
      },
    };
  }

  // --- Inventory valuation -------------------------------------------------------------

  async inventoryValuation(ctx: AccountingContext, asOf: IsoDate = todayIso()) {
    const rows = (await this.vehicleRows(ctx)).filter((row) => row.bookValueCents !== 0);
    const aging = { D0_30: 0, D31_60: 0, D61_90: 0, D91_PLUS: 0 };
    const agingUnits = { D0_30: 0, D31_60: 0, D61_90: 0, D91_PLUS: 0 };
    for (const row of rows) {
      const days = row.daysInInventory ?? 0;
      const key = days <= 30 ? 'D0_30' : days <= 60 ? 'D31_60' : days <= 90 ? 'D61_90' : 'D91_PLUS';
      aging[key] += row.bookValueCents;
      agingUnits[key] += 1;
    }
    const inventory = await this.prisma.acctAccount.findFirstOrThrow({
      where: { dealerId: ctx.dealerId, systemKey: 'VEHICLE_INVENTORY' },
      select: { id: true },
    });
    const ledger = debitBalance(
      (
        await accountTotals(this.prisma, ctx.dealerId, { accountIds: [inventory.id], to: asOf })
      ).get(inventory.id),
    );
    const total = sumCents(rows.map((row) => row.bookValueCents));
    return {
      asOf,
      rows: rows.sort((a, b) => (b.daysInInventory ?? 0) - (a.daysInInventory ?? 0)),
      units: rows.length,
      totalCents: total,
      ledgerBalanceCents: ledger,
      /** Vehicle-tagged book values should add up to the inventory account. */
      differenceCents: ledger - total,
      aging,
      agingUnits,
      averageDaysInStock: rows.length
        ? Math.round(sumCents(rows.map((row) => row.daysInInventory ?? 0)) / rows.length)
        : 0,
    };
  }

  // --- KPIs ---------------------------------------------------------------------------

  async kpis(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'YEAR_TO_DATE');
    return { range, ...(await this.kpisFor(ctx, range)) };
  }

  async kpisFor(ctx: AccountingContext, range: DateRange) {
    const rows = (await this.vehicleRows(ctx)).filter(
      (row) => row.status === 'SOLD' && row.soldOn! >= range.from && row.soldOn! <= range.to,
    );
    const sales = await this.prisma.vehicleSale.findMany({
      where: {
        dealerId: ctx.dealerId,
        status: 'POSTED',
        saleDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
      },
      select: { vehicleId: true },
    });
    const units = sales.length;
    const pl = await this.statements.profitAndLoss(ctx, {
      ...baseQuery(),
      preset: 'CUSTOM',
      from: range.from,
      to: range.to,
    });
    const accounts = await this.prisma.acctAccount.findMany({
      where: {
        dealerId: ctx.dealerId,
        OR: [{ systemKey: 'ADVERTISING' }, { name: { in: ['Marketing'] } }],
      },
      select: { id: true, type: true },
    });
    const during = await accountTotals(this.prisma, ctx.dealerId, {
      from: range.from,
      to: range.to,
      excludeClosing: true,
    });
    const advertising = sumCents(
      accounts.map((account) => normalBalance(account.type, during.get(account.id))),
    );

    // Inventory turnover: cost of sales over average inventory.
    const inventory = await this.prisma.acctAccount.findFirstOrThrow({
      where: { dealerId: ctx.dealerId, systemKey: 'VEHICLE_INVENTORY' },
      select: { id: true },
    });
    const start = debitBalance(
      (
        await accountTotals(this.prisma, ctx.dealerId, {
          accountIds: [inventory.id],
          to: addDays(range.from, -1),
        })
      ).get(inventory.id),
    );
    const end = debitBalance(
      (
        await accountTotals(this.prisma, ctx.dealerId, { accountIds: [inventory.id], to: range.to })
      ).get(inventory.id),
    );
    const averageInventory = Math.round((start + end) / 2);

    const grossProfit = sumCents(rows.map((row) => row.grossProfitCents ?? 0));
    const revenue = sumCents(rows.map((row) => row.revenueCents));
    const salePrices = rows.map((row) => row.salePriceCents ?? 0);
    const per = (value: number) => (units > 0 ? Math.round(value / units) : 0);

    const group = (key: (row: VehicleProfitRow) => string) => {
      const map = new Map<
        string,
        { key: string; units: number; revenueCents: number; grossProfitCents: number }
      >();
      for (const row of rows) {
        const name = key(row);
        const entry = map.get(name) ?? {
          key: name,
          units: 0,
          revenueCents: 0,
          grossProfitCents: 0,
        };
        entry.units += 1;
        entry.revenueCents += row.revenueCents;
        entry.grossProfitCents += row.grossProfitCents ?? 0;
        map.set(name, entry);
      }
      return [...map.values()].sort((a, b) => b.units - a.units);
    };

    return {
      unitsSold: units,
      averageSellingPriceCents: rows.length ? Math.round(sumCents(salePrices) / rows.length) : 0,
      averageGrossProfitCents: rows.length ? Math.round(grossProfit / rows.length) : 0,
      grossMarginBasisPoints: revenue > 0 ? Math.round((grossProfit * 10_000) / revenue) : null,
      inventoryTurnover:
        averageInventory > 0
          ? Math.round((pl.cogs.totalCents / averageInventory) * 100) / 100
          : null,
      averageDaysInInventory: rows.length
        ? Math.round(sumCents(rows.map((row) => row.daysInInventory ?? 0)) / rows.length)
        : null,
      averageVehicleCostCents: rows.length
        ? Math.round(sumCents(rows.map((row) => row.totalCostCents)) / rows.length)
        : 0,
      reconditioningPerVehicleCents: rows.length
        ? Math.round(sumCents(rows.map((row) => row.reconditioningCents)) / rows.length)
        : 0,
      advertisingPerVehicleCents: per(advertising),
      revenuePerUnitCents: per(pl.revenue.totalCents),
      expensePerUnitCents: per(pl.expenses.totalCents),
      netProfitPerUnitCents: per(pl.netIncomeCents),
      bySalesperson: group((row) => row.salesperson?.name ?? 'Unassigned'),
      byBrand: group((row) => row.make),
      byVehicleType: group((row) => row.bodyType),
    };
  }

  // --- Monthly and fiscal-year reports -------------------------------------------------

  /** A month's figures, with the previous month or the same month last year. */
  async monthly(
    ctx: AccountingContext,
    month: string,
    compare: 'PREVIOUS_MONTH' | 'SAME_MONTH_LAST_YEAR',
  ) {
    const from = `${month}-01`;
    const range = { from, to: addDays(addMonths(from, 1), -1) };
    const other = comparisonRange(
      range,
      compare === 'PREVIOUS_MONTH' ? 'PREVIOUS_PERIOD' : 'PREVIOUS_YEAR',
    );
    const [current, previous] = await Promise.all([
      this.periodFigures(ctx, range),
      this.periodFigures(ctx, other),
    ]);
    return { month, range, compareRange: other, current, previous };
  }

  async fiscalYear(ctx: AccountingContext, which: 'CURRENT' | 'PREVIOUS') {
    const calendar = await fiscalCalendar(this.prisma, ctx.dealerId);
    const current = rangeFor('CURRENT_FISCAL_YEAR', calendar, todayIso());
    const previous = rangeFor('PREVIOUS_FISCAL_YEAR', calendar, todayIso());
    const range = which === 'CURRENT' ? current : previous;
    const other =
      which === 'CURRENT'
        ? previous
        : { from: addMonths(previous.from, -12), to: addDays(previous.from, -1) };
    const months: Array<{ label: string; revenueCents: number; netIncomeCents: number }> = [];
    for (let start = range.from; start <= range.to; start = addMonths(start, 1)) {
      const end = addDays(addMonths(start, 1), -1);
      const pl = await this.statements.profitAndLoss(ctx, {
        ...baseQuery(),
        preset: 'CUSTOM',
        from: start,
        to: end,
      });
      months.push({
        label: new Date(`${start}T00:00:00Z`).toLocaleDateString('en-CA', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        revenueCents: pl.revenue.totalCents,
        netIncomeCents: pl.netIncomeCents,
      });
    }
    return {
      range,
      compareRange: other,
      current: await this.periodFigures(ctx, range),
      previous: await this.periodFigures(ctx, other),
      months,
    };
  }

  private async periodFigures(ctx: AccountingContext, range: DateRange) {
    const pl = await this.statements.profitAndLoss(ctx, {
      ...baseQuery(),
      preset: 'CUSTOM',
      from: range.from,
      to: range.to,
    });
    const accounts = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId },
      select: { id: true, code: true, name: true, type: true, subtype: true },
    });
    const cash = await this.statements.cashFlowFor(ctx.dealerId, accounts, range);
    const at = await accountTotals(this.prisma, ctx.dealerId, { to: range.to });
    const balanceOf = (subtypes: string[]) =>
      sumCents(
        accounts
          .filter((account) => subtypes.includes(account.subtype))
          .map((account) => normalBalance(account.type, at.get(account.id))),
      );
    const taxes = await this.tax.summary(ctx, range.from, range.to);
    const sales = await this.prisma.vehicleSale.findMany({
      where: {
        dealerId: ctx.dealerId,
        status: 'POSTED',
        saleDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
      },
      select: { salePrice: true, discount: true, vehicleId: true },
    });
    const kpis = await this.kpisFor(ctx, range);
    return {
      revenueCents: pl.revenue.totalCents,
      cogsCents: pl.cogs.totalCents,
      grossProfitCents: pl.grossProfitCents,
      expensesCents:
        pl.expenses.totalCents + pl.otherExpense.totalCents - pl.otherIncome.totalCents,
      netProfitCents: pl.netIncomeCents,
      unitsSold: sales.length,
      averageSalePriceCents: sales.length
        ? Math.round(
            sumCents(sales.map((sale) => toCents(sale.salePrice) - toCents(sale.discount))) /
              sales.length,
          )
        : 0,
      averageGrossProfitCents: kpis.averageGrossProfitCents,
      taxCollectedCents: sumCents(taxes.map((row) => row.collectedCents)),
      taxPaidCents: sumCents(taxes.map((row) => row.paidCents)),
      taxPayableCents: sumCents(taxes.map((row) => row.netCents)),
      netCashFlowCents: cash.netChangeCents,
      arCents: balanceOf(['RECEIVABLE']),
      apCents: balanceOf(['PAYABLE']),
      inventoryCents: balanceOf(['INVENTORY']),
    };
  }

  // --- The overview dashboard -----------------------------------------------------------

  async dashboard(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'THIS_MONTH');
    const accounts = await this.prisma.acctAccount.findMany({
      where: { dealerId: ctx.dealerId },
      select: { id: true, code: true, name: true, type: true, subtype: true, systemKey: true },
    });
    const at = await accountTotals(this.prisma, ctx.dealerId, { to: range.to });
    const balanceOf = (filter: (account: (typeof accounts)[number]) => boolean) =>
      sumCents(
        accounts.filter(filter).map((account) => normalBalance(account.type, at.get(account.id))),
      );
    const pl = await this.statements.profitAndLoss(ctx, {
      ...baseQuery(),
      preset: 'CUSTOM',
      from: range.from,
      to: range.to,
    });
    const vehiclesSold = await this.prisma.vehicleSale.count({
      where: {
        dealerId: ctx.dealerId,
        status: 'POSTED',
        saleDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
      },
    });
    const taxBalances = (['GST_HST', 'PST', 'QST'] as const).map((kind) => {
      const payableKey = kind === 'GST_HST' ? 'GST_HST_PAYABLE' : `${kind}_PAYABLE`;
      const recoverableKey = kind === 'GST_HST' ? 'GST_HST_RECOVERABLE' : `${kind}_RECOVERABLE`;
      const payable = balanceOf((account) => account.systemKey === payableKey);
      const recoverable = balanceOf((account) => account.systemKey === recoverableKey);
      return {
        kind,
        payableCents: payable,
        recoverableCents: recoverable,
        netCents: payable - recoverable,
      };
    });
    const inventory = await this.inventoryValuation(ctx, range.to);
    const ar = await this.arAging(ctx);
    const ap = await this.apAging(ctx);
    const recurringDue = await this.prisma.recurringExpense.count({
      where: { dealerId: ctx.dealerId, isActive: true, nextDate: { lte: toDbDate(todayIso()) } },
    });
    return {
      range,
      cashCents: balanceOf((account) => account.subtype === 'CASH'),
      bankCents: balanceOf((account) => account.subtype === 'BANK'),
      accountsReceivableCents: balanceOf((account) => account.subtype === 'RECEIVABLE'),
      accountsPayableCents: balanceOf((account) => account.subtype === 'PAYABLE'),
      inventoryValueCents: balanceOf((account) => account.systemKey === 'VEHICLE_INVENTORY'),
      vehiclesSold,
      salesRevenueCents: pl.revenue.totalCents,
      cogsCents: pl.cogs.totalCents,
      grossProfitCents: pl.grossProfitCents,
      grossMarginBasisPoints: pl.grossMarginBasisPoints,
      operatingExpensesCents: pl.expenses.totalCents,
      netIncomeCents: pl.netIncomeCents,
      taxBalances,
      customerDepositsCents: balanceOf((account) => account.subtype === 'CUSTOMER_DEPOSIT'),
      floorPlanCents: balanceOf((account) => account.subtype === 'FLOOR_PLAN'),
      inventoryAging: inventory.aging,
      inventoryAgingUnits: inventory.agingUnits,
      inventoryUnits: inventory.units,
      arAging: ar.buckets,
      apAging: ap.buckets,
      upcomingBills: ap.upcoming.slice(0, 5),
      recurringExpensesDue: recurringDue,
    };
  }
}

/** The defaults a report query has, for internal calls. */
export function baseQuery(): ReportQuery {
  return { compare: 'NONE', profitability: 'ALL', page: 1, pageSize: 50 };
}
