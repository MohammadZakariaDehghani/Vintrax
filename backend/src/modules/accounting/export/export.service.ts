import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  EXPENSE_TREATMENT_LABELS,
  JOURNAL_SOURCE_LABELS,
  TAX_RETURN_KIND_LABELS,
  type ExportQuery,
  type ExportableReport,
} from '@vintrax/shared';
import type { AccountingContext } from '../core/context';
import { todayIso } from '../core/dates';
import { ExpensesService } from '../expenses/expenses.service';
import { JournalService } from '../journal/journal.service';
import { BankingService } from '../banking/banking.service';
import { OperationsReportsService } from '../reports/operations.service';
import { StatementsService, type StatementSection } from '../reports/statements.service';
import { resolveRange } from '../reports/date-ranges';
import { TaxService } from '../tax/tax.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { toPdfFile } from './pdf';
import { centsDisplay, centsText, toCsvFile, type ReportTable } from './table';
import { toXlsxFile } from './xlsx';

/** The most rows one export carries — a ledger beyond that is split by date. */
const EXPORT_ROW_LIMIT = 20_000;

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

type Row = ReportTable['rows'][number];

/**
 * Every exportable report flattened to one table, then written as CSV, Excel
 * or PDF. The figures come from the same services as the screens, so an
 * export always matches what the dealer saw.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: StatementsService,
    private readonly operations: OperationsReportsService,
    private readonly journal: JournalService,
    private readonly expenses: ExpensesService,
    private readonly banking: BankingService,
    private readonly tax: TaxService,
  ) {}

  async export(ctx: AccountingContext, report: ExportableReport, query: ExportQuery) {
    const table = await this.table(ctx, report, query);
    const dealer = await this.prisma.dealer.findUnique({ where: { id: ctx.dealerId }, select: { name: true } });
    if (dealer?.name) table.subtitle = table.subtitle ? `${dealer.name} · ${table.subtitle}` : dealer.name;
    const body =
      query.format === 'xlsx' ? toXlsxFile(table) : query.format === 'pdf' ? toPdfFile(table) : toCsvFile(table);
    return {
      body,
      contentType: CONTENT_TYPES[query.format],
      fileName: `${report}-${todayIso()}.${query.format}`,
    };
  }

  async table(ctx: AccountingContext, report: ExportableReport, query: ExportQuery): Promise<ReportTable> {
    const all = { ...query, page: 1, pageSize: EXPORT_ROW_LIMIT };
    switch (report) {
      case 'general-ledger': {
        const ledger = await this.statements.generalLedger(ctx, all);
        return {
          title: ledger.account ? `General ledger — ${ledger.account.code} ${ledger.account.name}` : 'General ledger',
          subtitle: `${ledger.range.from} to ${ledger.range.to}`,
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'reference', label: 'Reference' },
            { key: 'account', label: 'Account' },
            { key: 'description', label: 'Description' },
            { key: 'source', label: 'Source' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'party', label: 'Customer / vendor' },
            { key: 'debit', label: 'Debit', kind: 'money' },
            { key: 'credit', label: 'Credit', kind: 'money' },
            ...(ledger.account ? [{ key: 'balance', label: 'Balance', kind: 'money' as const }] : []),
          ],
          rows: [
            ...(ledger.account ? [{ description: 'Opening balance', balance: ledger.openingCents }] : []),
            ...ledger.items.map((item) => ({
              date: item.date,
              reference: item.reference,
              account: `${item.account.code} ${item.account.name}`,
              description: item.description,
              source: JOURNAL_SOURCE_LABELS[item.source],
              vehicle: item.vehicle ? item.vehicle.vin ?? `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}` : '',
              party: item.customer?.name ?? item.vendor?.name ?? '',
              debit: item.debitCents || null,
              credit: item.creditCents || null,
              balance: item.balanceCents,
            })),
          ],
          totals: {
            description: 'Totals',
            debit: ledger.debitsCents,
            credit: ledger.creditsCents,
            ...(ledger.account ? { balance: ledger.closingCents } : {}),
          },
        };
      }

      case 'trial-balance': {
        const tb = await this.statements.trialBalance(ctx, query);
        return {
          title: 'Trial balance',
          subtitle: `${tb.range.from} to ${tb.range.to}${tb.balanced ? '' : ' · OUT OF BALANCE'}`,
          columns: [
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Account' },
            { key: 'opening', label: 'Opening (Dr+/Cr−)', kind: 'money' },
            { key: 'debit', label: 'Period debits', kind: 'money' },
            { key: 'credit', label: 'Period credits', kind: 'money' },
            { key: 'closingDebit', label: 'Closing debit', kind: 'money' },
            { key: 'closingCredit', label: 'Closing credit', kind: 'money' },
          ],
          rows: tb.rows.map((row) => ({
            code: row.code,
            name: row.name,
            opening: row.openingCents,
            debit: row.debitCents,
            credit: row.creditCents,
            closingDebit: row.closingDebitCents || null,
            closingCredit: row.closingCreditCents || null,
          })),
          totals: {
            name: 'Totals',
            debit: tb.totals.debitCents,
            credit: tb.totals.creditCents,
            closingDebit: tb.totals.closingDebitCents,
            closingCredit: tb.totals.closingCreditCents,
          },
        };
      }

      case 'profit-loss': {
        const pl = await this.statements.profitAndLoss(ctx, query);
        const compare = Boolean(pl.compare);
        const rows: Row[] = [];
        const section = (s: StatementSection) => {
          rows.push({ name: s.label });
          for (const line of s.lines) rows.push({ code: line.code, name: `  ${line.name}`, amount: line.amountCents, compare: line.compareCents });
          rows.push({ name: `Total ${s.label.toLowerCase()}`, amount: s.totalCents, compare: s.compareTotalCents });
        };
        section(pl.revenue);
        section(pl.cogs);
        rows.push({ name: 'Gross profit', amount: pl.grossProfitCents, compare: pl.compare?.grossProfitCents });
        section(pl.expenses);
        rows.push({ name: 'Operating income', amount: pl.operatingIncomeCents, compare: pl.compare?.operatingIncomeCents });
        if (pl.otherIncome.lines.length) section(pl.otherIncome);
        if (pl.otherExpense.lines.length) section(pl.otherExpense);
        return {
          title: 'Profit and loss',
          subtitle: `${pl.range.from} to ${pl.range.to}${pl.compareRange ? ` · compared with ${pl.compareRange.from} to ${pl.compareRange.to}` : ''}`,
          columns: [
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Line' },
            { key: 'amount', label: 'Amount', kind: 'money' },
            ...(compare ? [{ key: 'compare', label: 'Comparison', kind: 'money' as const }] : []),
          ],
          rows,
          totals: { name: 'Net income', amount: pl.netIncomeCents, compare: pl.compare?.netIncomeCents },
        };
      }

      case 'balance-sheet': {
        const bs = await this.statements.balanceSheet(ctx, query);
        const compare = Boolean(bs.compareAsOf);
        const rows: Row[] = [];
        for (const section of bs.sections) {
          if (section.lines.length === 0) continue;
          rows.push({ name: section.label });
          for (const line of section.lines) rows.push({ code: line.code, name: `  ${line.name}`, amount: line.amountCents, compare: line.compareCents });
          rows.push({ name: `Total ${section.label.toLowerCase()}`, amount: section.totalCents, compare: section.compareTotalCents });
          if (section.key === 'FIXED_ASSETS') rows.push({ name: 'Total assets', amount: bs.totalAssetsCents, compare: bs.compare?.totalAssetsCents });
          if (section.key === 'LONG_TERM_LIABILITIES') rows.push({ name: 'Total liabilities', amount: bs.totalLiabilitiesCents, compare: bs.compare?.totalLiabilitiesCents });
        }
        return {
          title: 'Balance sheet',
          subtitle: `As of ${bs.asOf}${bs.compareAsOf ? ` · compared with ${bs.compareAsOf}` : ''}${bs.balanced ? '' : ' · OUT OF BALANCE'}`,
          columns: [
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Line' },
            { key: 'amount', label: 'Amount', kind: 'money' },
            ...(compare ? [{ key: 'compare', label: 'Comparison', kind: 'money' as const }] : []),
          ],
          rows,
          totals: {
            name: 'Total liabilities and equity',
            amount: bs.totalLiabilitiesCents + bs.totalEquityCents,
            compare: bs.compare ? bs.compare.totalLiabilitiesCents + bs.compare.totalEquityCents : undefined,
          },
        };
      }

      case 'cash-flow': {
        const cf = await this.statements.cashFlow(ctx, query);
        const rows: Row[] = [{ name: 'Operating activities' }, { name: '  Net income', amount: cf.netIncomeCents }];
        for (const line of cf.operating.lines) rows.push({ code: line.code, name: `  ${line.name}`, amount: line.amountCents });
        rows.push({ name: 'Net cash from operating activities', amount: cf.operating.totalCents });
        rows.push({ name: 'Investing activities' });
        for (const line of cf.investing.lines) rows.push({ code: line.code, name: `  ${line.name}`, amount: line.amountCents });
        rows.push({ name: 'Net cash from investing activities', amount: cf.investing.totalCents });
        rows.push({ name: 'Financing activities' });
        for (const line of cf.financing.lines) rows.push({ code: line.code, name: `  ${line.name}`, amount: line.amountCents });
        rows.push({ name: 'Net cash from financing activities', amount: cf.financing.totalCents });
        rows.push({ name: 'Net change in cash', amount: cf.netChangeCents });
        rows.push({ name: 'Cash at beginning of period', amount: cf.beginningCashCents });
        return {
          title: 'Cash flow statement',
          subtitle: `${cf.range.from} to ${cf.range.to} · indirect method`,
          columns: [
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Line' },
            { key: 'amount', label: 'Amount', kind: 'money' },
          ],
          rows,
          totals: { name: 'Cash at end of period', amount: cf.endingCashCents },
        };
      }

      case 'tax': {
        const range = await resolveRange(this.prisma, ctx.dealerId, query);
        const summary = await this.tax.summary(ctx, range.from, range.to);
        return {
          title: 'Sales tax summary',
          subtitle: `${range.from} to ${range.to} · for review, not tax advice`,
          columns: [
            { key: 'kind', label: 'Return' },
            { key: 'taxable', label: 'Taxable sales', kind: 'money' },
            { key: 'exempt', label: 'Exempt sales', kind: 'money' },
            { key: 'collected', label: 'Tax collected', kind: 'money' },
            { key: 'paid', label: 'Tax paid', kind: 'money' },
            { key: 'recoverable', label: 'Input tax credits', kind: 'money' },
            { key: 'adjustments', label: 'Adjustments', kind: 'money' },
            { key: 'net', label: 'Net payable', kind: 'money' },
            { key: 'transactions', label: 'Transactions', kind: 'number' },
          ],
          rows: summary.map((row) => ({
            kind: TAX_RETURN_KIND_LABELS[row.kind],
            taxable: row.taxableSalesCents,
            exempt: row.exemptSalesCents,
            collected: row.collectedCents,
            paid: row.paidCents,
            recoverable: row.recoverableCents,
            adjustments: row.adjustmentsCents,
            net: row.netCents,
            transactions: row.transactions,
          })),
        };
      }

      case 'ar-aging':
      case 'ap-aging': {
        const receivable = report === 'ar-aging';
        const asOf = query.to ?? todayIso();
        const aging = receivable ? await this.operations.arAging(ctx, asOf) : await this.operations.apAging(ctx, asOf);
        const groups = receivable
          ? (aging as Awaited<ReturnType<OperationsReportsService['arAging']>>).byCustomer.map((row) => ({ name: row.customer.name, buckets: row.buckets, totalCents: row.totalCents }))
          : (aging as Awaited<ReturnType<OperationsReportsService['apAging']>>).byVendor.map((row) => ({ name: row.vendor.name, buckets: row.buckets, totalCents: row.totalCents }));
        return {
          title: receivable ? 'Accounts receivable aging' : 'Accounts payable aging',
          subtitle: `As of ${aging.asOf}`,
          columns: [
            { key: 'name', label: receivable ? 'Customer' : 'Vendor' },
            ...AGING_BUCKETS.map((bucket) => ({ key: bucket, label: AGING_BUCKET_LABELS[bucket], kind: 'money' as const })),
            { key: 'total', label: 'Total', kind: 'money' },
          ],
          rows: groups.map((group) => ({
            name: group.name,
            ...Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, group.buckets[bucket]])),
            total: group.totalCents,
          })),
          totals: {
            name: 'Total',
            ...Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, aging.buckets[bucket]])),
            total: aging.totalCents,
          },
        };
      }

      case 'inventory-valuation': {
        const valuation = await this.operations.inventoryValuation(ctx, query.to ?? todayIso());
        return {
          title: 'Inventory valuation',
          subtitle: `As of ${valuation.asOf} · ${valuation.units} units${valuation.differenceCents ? ` · differs from ledger by ${centsDisplay(valuation.differenceCents)}` : ''}`,
          columns: [
            { key: 'stock', label: 'Stock #' },
            { key: 'vin', label: 'VIN' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'acquired', label: 'Acquired' },
            { key: 'days', label: 'Days in stock', kind: 'number' },
            { key: 'purchase', label: 'Purchase', kind: 'money' },
            { key: 'additional', label: 'Additional costs', kind: 'money' },
            { key: 'book', label: 'Book value', kind: 'money' },
          ],
          rows: valuation.rows.map((row) => ({
            stock: row.stockNumber,
            vin: row.vin,
            vehicle: `${row.year} ${row.make} ${row.model}`,
            acquired: row.acquiredOn,
            days: row.daysInInventory,
            purchase: row.purchaseCostCents,
            additional: row.additionalCostsCents,
            book: row.bookValueCents,
          })),
          totals: { vehicle: 'Total', book: valuation.totalCents },
        };
      }

      case 'vehicle-profitability': {
        const result = await this.operations.vehicleProfitability(ctx, query);
        return {
          title: 'Vehicle profitability',
          subtitle: result.range ? `${result.range.from} to ${result.range.to}` : 'All vehicles',
          columns: [
            { key: 'stock', label: 'Stock #' },
            { key: 'vin', label: 'VIN' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'status', label: 'Status' },
            { key: 'acquired', label: 'Acquired' },
            { key: 'sold', label: 'Sold' },
            { key: 'days', label: 'Days', kind: 'number' },
            { key: 'cost', label: 'Total cost', kind: 'money' },
            { key: 'revenue', label: 'Revenue', kind: 'money' },
            { key: 'cogs', label: 'Cost of sale', kind: 'money' },
            { key: 'profit', label: 'Gross profit', kind: 'money' },
            { key: 'margin', label: 'Margin', kind: 'percent' },
            { key: 'salesperson', label: 'Salesperson' },
          ],
          rows: result.rows.map((row) => ({
            stock: row.stockNumber,
            vin: row.vin,
            vehicle: `${row.year} ${row.make} ${row.model}`,
            status: row.status === 'SOLD' ? 'Sold' : 'In stock',
            acquired: row.acquiredOn,
            sold: row.soldOn,
            days: row.daysInInventory,
            cost: row.totalCostCents,
            revenue: row.status === 'SOLD' ? row.revenueCents : null,
            cogs: row.status === 'SOLD' ? row.cogsCents : null,
            profit: row.grossProfitCents,
            margin: row.grossMarginBasisPoints,
            salesperson: row.salesperson?.name ?? '',
          })),
          totals: {
            vehicle: `${result.totals.vehicles} vehicles, ${result.totals.sold} sold`,
            cost: result.totals.totalCostCents,
            revenue: result.totals.revenueCents,
            profit: result.totals.grossProfitCents,
          },
        };
      }

      case 'journal-entries': {
        const list = await this.journal.list(ctx, all);
        return {
          title: 'Journal entries',
          subtitle: `${list.range.from} to ${list.range.to}`,
          columns: [
            { key: 'number', label: 'No.', kind: 'number' },
            { key: 'reference', label: 'Reference' },
            { key: 'date', label: 'Date' },
            { key: 'description', label: 'Description' },
            { key: 'source', label: 'Source' },
            { key: 'kind', label: 'Type' },
            { key: 'status', label: 'Status' },
            { key: 'total', label: 'Amount', kind: 'money' },
          ],
          rows: list.items.map((item) => ({
            number: item.number,
            reference: item.reference,
            date: item.date,
            description: item.description,
            source: JOURNAL_SOURCE_LABELS[item.source],
            kind: item.kind,
            status: item.reversed ? 'Reversed' : item.status === 'POSTED' ? 'Posted' : 'Draft',
            total: item.totalCents,
          })),
        };
      }

      case 'expenses': {
        const list = await this.expenses.list(ctx, query);
        return {
          title: 'Expenses',
          subtitle: `${list.range.from} to ${list.range.to}`,
          columns: [
            { key: 'number', label: 'No.' },
            { key: 'date', label: 'Date' },
            { key: 'vendor', label: 'Vendor' },
            { key: 'account', label: 'Account' },
            { key: 'treatment', label: 'Treatment' },
            { key: 'vehicle', label: 'Vehicle' },
            { key: 'description', label: 'Description' },
            { key: 'amount', label: 'Amount', kind: 'money' },
            { key: 'tax', label: 'Tax', kind: 'money' },
            { key: 'total', label: 'Total', kind: 'money' },
            { key: 'status', label: 'Status' },
          ],
          rows: list.items.map((item) => ({
            number: item.number,
            date: item.date,
            vendor: item.vendor?.name ?? '',
            account: item.account ? `${item.account.code} ${item.account.name}` : '',
            treatment: EXPENSE_TREATMENT_LABELS[item.treatment],
            vehicle: item.vehicle ? item.vehicle.vin ?? `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}` : '',
            description: item.description,
            amount: item.amountCents,
            tax: item.taxCents,
            total: item.totalCents,
            status: item.status,
          })),
          totals: { description: 'Total posted', total: list.totalCents },
        };
      }

      case 'reconciliation': {
        if (!query.reconciliationId) throw new BadRequestException('Choose a reconciliation to export');
        const rec = await this.banking.reconciliation(ctx, query.reconciliationId);
        return {
          title: `Bank reconciliation — ${rec.bankAccount.name}`,
          subtitle: `Statement date ${rec.statementDate} · ${rec.status === 'COMPLETED' ? 'completed' : 'in progress'} · statement ${centsDisplay(rec.statementBalanceCents)}, cleared ${centsDisplay(rec.clearedBalanceCents)}, difference ${centsDisplay(rec.differenceCents)}`,
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'reference', label: 'Reference' },
            { key: 'description', label: 'Description' },
            { key: 'amount', label: 'Amount', kind: 'money' },
            { key: 'cleared', label: 'Cleared' },
          ],
          rows: [
            { description: 'Beginning balance', amount: rec.beginningBalanceCents },
            ...rec.items.map((item) => ({
              date: item.date,
              reference: item.reference,
              description: item.description,
              amount: item.amountCents,
              cleared: item.cleared ? 'Yes' : 'No',
            })),
          ],
          totals: { description: 'Cleared balance', amount: rec.clearedBalanceCents },
        };
      }

      case 'kpis': {
        const kpis = await this.operations.kpis(ctx, query);
        const rows: Row[] = [
          { metric: 'Units sold', value: kpis.unitsSold, kind: 'number' },
          { metric: 'Average selling price', value: kpis.averageSellingPriceCents, kind: 'money' },
          { metric: 'Average gross profit per vehicle', value: kpis.averageGrossProfitCents, kind: 'money' },
          { metric: 'Gross margin', value: kpis.grossMarginBasisPoints === null ? null : `${(kpis.grossMarginBasisPoints / 100).toFixed(2)}%`, kind: 'text' },
          { metric: 'Inventory turnover', value: kpis.inventoryTurnover === null ? null : String(kpis.inventoryTurnover), kind: 'text' },
          { metric: 'Average days in inventory', value: kpis.averageDaysInInventory, kind: 'number' },
          { metric: 'Average vehicle cost', value: kpis.averageVehicleCostCents, kind: 'money' },
          { metric: 'Reconditioning per vehicle', value: kpis.reconditioningPerVehicleCents, kind: 'money' },
          { metric: 'Advertising per vehicle sold', value: kpis.advertisingPerVehicleCents, kind: 'money' },
          { metric: 'Revenue per unit', value: kpis.revenuePerUnitCents, kind: 'money' },
          { metric: 'Expense per unit', value: kpis.expensePerUnitCents, kind: 'money' },
          { metric: 'Net profit per unit', value: kpis.netProfitPerUnitCents, kind: 'money' },
        ];
        // One value column, so money values are written as text here.
        return {
          title: 'Dealership KPIs',
          subtitle: `${kpis.range.from} to ${kpis.range.to}`,
          columns: [
            { key: 'metric', label: 'Metric' },
            { key: 'value', label: 'Value' },
          ],
          rows: rows.map((row) => ({
            metric: row.metric,
            value:
              row.kind === 'money' && typeof row.value === 'number'
                ? centsText(row.value)
                : row.value === null || row.value === undefined
                  ? '—'
                  : String(row.value),
          })),
        };
      }

      case 'monthly': {
        const month = query.month ?? (query.from ?? todayIso()).slice(0, 7);
        const result = await this.operations.monthly(ctx, month, query.compare === 'PREVIOUS_YEAR' ? 'SAME_MONTH_LAST_YEAR' : 'PREVIOUS_MONTH');
        const metrics: Array<[string, keyof typeof result.current, 'money' | 'number']> = [
          ['Revenue', 'revenueCents', 'money'],
          ['Cost of sales', 'cogsCents', 'money'],
          ['Gross profit', 'grossProfitCents', 'money'],
          ['Expenses', 'expensesCents', 'money'],
          ['Net profit', 'netProfitCents', 'money'],
          ['Vehicles sold', 'unitsSold', 'number'],
          ['Average sale price', 'averageSalePriceCents', 'money'],
          ['Average gross profit', 'averageGrossProfitCents', 'money'],
          ['Tax collected', 'taxCollectedCents', 'money'],
          ['Tax paid', 'taxPaidCents', 'money'],
          ['Net tax payable', 'taxPayableCents', 'money'],
          ['Net cash flow', 'netCashFlowCents', 'money'],
          ['Accounts receivable', 'arCents', 'money'],
          ['Accounts payable', 'apCents', 'money'],
          ['Inventory', 'inventoryCents', 'money'],
        ];
        const text = (value: number, kind: 'money' | 'number') => (kind === 'money' ? centsText(value) : String(value));
        return {
          title: `Monthly report — ${month}`,
          subtitle: `Compared with ${result.compareRange.from} to ${result.compareRange.to}`,
          columns: [
            { key: 'metric', label: 'Metric' },
            { key: 'current', label: month },
            { key: 'previous', label: 'Comparison' },
            { key: 'change', label: 'Change' },
          ],
          rows: metrics.map(([label, key, kind]) => {
            const current = result.current[key];
            const previous = result.previous[key];
            return {
              metric: label,
              current: text(current, kind),
              previous: text(previous, kind),
              change: text(current - previous, kind),
            };
          }),
        };
      }

      default: {
        const never: never = report;
        throw new BadRequestException(`Unknown report ${String(never)}`);
      }
    }
  }
}
