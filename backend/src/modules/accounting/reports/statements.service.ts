import { Injectable } from '@nestjs/common';
import type { AcctAccountSubtype, AcctAccountType, Prisma } from '@prisma/client';
import {
  SUBTYPE_BALANCE_SHEET_GROUP,
  SUBTYPE_CASH_FLOW,
  isDebitNormal,
  type ReportQuery,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { addDays, fromDbDate, toDbDate, todayIso, type DateRange, type IsoDate } from '../core/dates';
import { sumCents, toCents } from '../core/money';
import { accountTotals, debitBalance, normalBalance, type AccountTotals } from './ledger';
import { comparisonRange, resolveRange, type ResolvedRange } from './date-ranges';

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AcctAccountType;
  subtype: AcctAccountSubtype;
}

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amountCents: number;
  compareCents?: number;
}

export interface StatementSection {
  key: string;
  label: string;
  lines: StatementLine[];
  totalCents: number;
  compareTotalCents?: number;
}

/**
 * The financial statements, built only from posted journal lines. None of
 * these read a sale, bill or expense: if it is not in the ledger it is not in
 * the statements.
 */
@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

  private accounts(dealerId: string): Promise<AccountRow[]> {
    return this.prisma.acctAccount.findMany({
      where: { dealerId },
      select: { id: true, code: true, name: true, type: true, subtype: true },
      orderBy: { code: 'asc' },
    });
  }

  // --- Trial balance ------------------------------------------------------------

  async trialBalance(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query);
    const [accounts, before, during] = await Promise.all([
      this.accounts(ctx.dealerId),
      accountTotals(this.prisma, ctx.dealerId, { to: addDays(range.from, -1) }),
      accountTotals(this.prisma, ctx.dealerId, { from: range.from, to: range.to }),
    ]);
    const rows = accounts
      .map((account) => {
        const opening = debitBalance(before.get(account.id));
        const period = during.get(account.id) ?? { debitCents: 0, creditCents: 0 };
        const closing = opening + period.debitCents - period.creditCents;
        return {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          openingCents: opening,
          debitCents: period.debitCents,
          creditCents: period.creditCents,
          closingCents: closing,
          // A trial balance shows each closing balance in its debit or credit column.
          closingDebitCents: closing > 0 ? closing : 0,
          closingCreditCents: closing < 0 ? -closing : 0,
        };
      })
      .filter((row) => row.openingCents !== 0 || row.debitCents !== 0 || row.creditCents !== 0);
    const totals = {
      debitCents: sumCents(rows.map((row) => row.debitCents)),
      creditCents: sumCents(rows.map((row) => row.creditCents)),
      closingDebitCents: sumCents(rows.map((row) => row.closingDebitCents)),
      closingCreditCents: sumCents(rows.map((row) => row.closingCreditCents)),
    };
    return {
      range,
      rows,
      totals,
      balanced:
        totals.debitCents === totals.creditCents &&
        totals.closingDebitCents === totals.closingCreditCents,
    };
  }

  // --- General ledger -----------------------------------------------------------------

  async generalLedger(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'THIS_MONTH');
    let vehicleIds: string[] | undefined;
    if (query.vin) {
      const vehicles = await this.prisma.vehicle.findMany({
        where: { sellerId: ctx.ownerUserId, vin: { contains: query.vin, mode: 'insensitive' } },
        select: { id: true },
      });
      vehicleIds = vehicles.map((vehicle) => vehicle.id);
    }
    const lineWhere: Prisma.JournalLineWhereInput = {
      dealerId: ctx.dealerId,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.vehicleId
        ? { vehicleId: query.vehicleId }
        : vehicleIds
          ? { vehicleId: { in: vehicleIds } }
          : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
    };
    const entryWhere: Prisma.JournalEntryWhereInput = {
      status: 'POSTED',
      ...(query.source ? { source: query.source } : {}),
      ...(query.userId ? { createdById: query.userId } : {}),
      ...(query.reference ? { reference: { contains: query.reference, mode: 'insensitive' } } : {}),
    };

    const opening = await this.prisma.journalLine.aggregate({
      where: { ...lineWhere, entry: { ...entryWhere, date: { lt: toDbDate(range.from) } } },
      _sum: { debit: true, credit: true },
    });
    const where: Prisma.JournalLineWhereInput = {
      ...lineWhere,
      entry: { ...entryWhere, date: { gte: toDbDate(range.from), lte: toDbDate(range.to) } },
    };
    const [count, sums, lines] = await Promise.all([
      this.prisma.journalLine.count({ where }),
      this.prisma.journalLine.aggregate({ where, _sum: { debit: true, credit: true } }),
      this.prisma.journalLine.findMany({
        where,
        include: {
          account: { select: { id: true, code: true, name: true, type: true } },
          entry: {
            select: {
              id: true,
              date: true,
              reference: true,
              description: true,
              source: true,
              sourceType: true,
              sourceId: true,
              createdById: true,
            },
          },
          vehicle: { select: { id: true, vin: true, year: true, make: true, model: true } },
          customer: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
        },
        orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }, { lineNo: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    // A running balance only makes sense within one account.
    const account = query.accountId
      ? await this.prisma.acctAccount.findFirst({
          where: { id: query.accountId, dealerId: ctx.dealerId },
        })
      : null;
    const openingDebit = toCents(opening._sum.debit) - toCents(opening._sum.credit);
    let pageStart = openingDebit;
    if (account && query.page > 1) {
      const earlier = await this.prisma.journalLine.findMany({
        where,
        select: { debit: true, credit: true },
        orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }, { lineNo: 'asc' }],
        take: (query.page - 1) * query.pageSize,
      });
      pageStart += sumCents(earlier.map((line) => toCents(line.debit) - toCents(line.credit)));
    }
    let running = pageStart;
    const sign = account && !isDebitNormal(account.type) ? -1 : 1;
    const debits = toCents(sums._sum.debit);
    const credits = toCents(sums._sum.credit);
    return {
      range,
      account: account
        ? { id: account.id, code: account.code, name: account.name, type: account.type }
        : null,
      openingCents: sign * openingDebit,
      debitsCents: debits,
      creditsCents: credits,
      closingCents: sign * (openingDebit + debits - credits),
      items: lines.map((line) => {
        const debit = toCents(line.debit);
        const credit = toCents(line.credit);
        running += debit - credit;
        return {
          lineId: line.id,
          date: fromDbDate(line.entry.date),
          journalEntryId: line.entry.id,
          reference: line.entry.reference,
          description: line.description ?? line.entry.description,
          source: line.entry.source,
          sourceType: line.entry.sourceType,
          sourceId: line.entry.sourceId,
          account: { id: line.account.id, code: line.account.code, name: line.account.name },
          vehicle: line.vehicle,
          customer: line.customer,
          vendor: line.vendor,
          debitCents: debit,
          creditCents: credit,
          balanceCents: account ? sign * running : null,
        };
      }),
      total: count,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(count / query.pageSize)),
    };
  }

  // --- Profit and loss ------------------------------------------------------------------

  async profitAndLoss(
    ctx: AccountingContext,
    query: ReportQuery & { columns?: 'TOTAL' | 'MONTHLY' },
  ) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query);
    const compare = query.compare !== 'NONE' ? comparisonRange(range, query.compare) : null;
    const accounts = await this.accounts(ctx.dealerId);
    const current = await accountTotals(this.prisma, ctx.dealerId, {
      from: range.from,
      to: range.to,
      excludeClosing: true,
    });
    const previous = compare
      ? await accountTotals(this.prisma, ctx.dealerId, {
          from: compare.from,
          to: compare.to,
          excludeClosing: true,
        })
      : null;
    const statement = buildProfitAndLoss(accounts, current, previous);

    let months: Array<{
      from: IsoDate;
      to: IsoDate;
      label: string;
      netIncomeCents: number;
      revenueCents: number;
      grossProfitCents: number;
    }> | null = null;
    if (query.columns === 'MONTHLY') {
      months = [];
      let start = `${range.from.slice(0, 7)}-01`;
      while (start <= range.to && months.length < 24) {
        const end = addDays(addMonthsIso(start, 1), -1);
        const from = start < range.from ? range.from : start;
        const to = end > range.to ? range.to : end;
        const totals = await accountTotals(this.prisma, ctx.dealerId, {
          from,
          to,
          excludeClosing: true,
        });
        const pl = buildProfitAndLoss(accounts, totals, null);
        months.push({
          from,
          to,
          label: new Date(`${start}T00:00:00Z`).toLocaleDateString('en-CA', {
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          }),
          revenueCents: pl.revenue.totalCents,
          grossProfitCents: pl.grossProfitCents,
          netIncomeCents: pl.netIncomeCents,
        });
        start = addMonthsIso(start, 1);
      }
    }
    return { range, compareRange: compare, ...statement, months };
  }

  // --- Balance sheet --------------------------------------------------------------------

  async balanceSheet(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'YEAR_TO_DATE');
    // A balance sheet is a position on a day: a period that ends in the
    // future (the current fiscal year) is shown as of today.
    const today = todayIso();
    const asOf = range.to > today ? today : range.to;
    const compareAsOf = query.compare !== 'NONE' ? comparisonRange(range, query.compare).to : null;
    const accounts = await this.accounts(ctx.dealerId);
    const sheet = await this.sheetAt(ctx.dealerId, accounts, asOf);
    const previous = compareAsOf ? await this.sheetAt(ctx.dealerId, accounts, compareAsOf) : null;
    if (previous) {
      for (const section of sheet.sections) {
        const other = previous.sections.find((candidate) => candidate.key === section.key);
        section.compareTotalCents = other?.totalCents ?? 0;
        for (const line of section.lines) {
          line.compareCents =
            other?.lines.find((candidate) => candidate.accountId === line.accountId)?.amountCents ??
            0;
        }
      }
    }
    return {
      asOf,
      compareAsOf,
      ...sheet,
      compare: previous
        ? {
            totalAssetsCents: previous.totalAssetsCents,
            totalLiabilitiesCents: previous.totalLiabilitiesCents,
            totalEquityCents: previous.totalEquityCents,
          }
        : null,
    };
  }

  private async sheetAt(dealerId: string, accounts: AccountRow[], asOf: IsoDate) {
    const totals = await accountTotals(this.prisma, dealerId, { to: asOf });
    const groups: Array<{ key: string; label: string }> = [
      { key: 'CURRENT_ASSETS', label: 'Current assets' },
      { key: 'FIXED_ASSETS', label: 'Fixed assets' },
      { key: 'CURRENT_LIABILITIES', label: 'Current liabilities' },
      { key: 'LONG_TERM_LIABILITIES', label: 'Long-term liabilities' },
      { key: 'EQUITY', label: 'Equity' },
    ];
    const sections: StatementSection[] = groups.map((group) => {
      const lines = accounts
        .filter(
          (account) =>
            SUBTYPE_BALANCE_SHEET_GROUP[account.subtype] === group.key &&
            account.subtype !== 'CURRENT_YEAR_EARNINGS',
        )
        .map((account) => ({
          accountId: account.id,
          code: account.code,
          name: account.name,
          // Assets debit-positive (accumulated depreciation shows negative);
          // liabilities and equity credit-positive.
          amountCents:
            account.type === 'ASSET'
              ? debitBalance(totals.get(account.id))
              : -debitBalance(totals.get(account.id)),
        }))
        .filter((line) => line.amountCents !== 0);
      return {
        key: group.key,
        label: group.label,
        lines,
        totalCents: sumCents(lines.map((line) => line.amountCents)),
      };
    });

    // Current year earnings: every revenue, cost and expense balance not yet
    // closed into retained earnings.
    const earnings = -sumCents(
      accounts
        .filter(
          (account) =>
            account.type === 'REVENUE' || account.type === 'COGS' || account.type === 'EXPENSE',
        )
        .map((account) => debitBalance(totals.get(account.id))),
    );
    const cye = accounts.find((account) => account.subtype === 'CURRENT_YEAR_EARNINGS');
    const equity = sections.find((section) => section.key === 'EQUITY')!;
    if (earnings !== 0 || cye) {
      equity.lines.push({
        accountId: cye?.id ?? 'current-year-earnings',
        code: cye?.code ?? '',
        name: cye?.name ?? 'Current Year Earnings',
        amountCents: earnings,
      });
      equity.totalCents += earnings;
    }

    const totalAssets = sumCents(
      sections.filter((s) => s.key.endsWith('ASSETS')).map((s) => s.totalCents),
    );
    const totalLiabilities = sumCents(
      sections.filter((s) => s.key.endsWith('LIABILITIES')).map((s) => s.totalCents),
    );
    const totalEquity = equity.totalCents;
    return {
      sections,
      totalAssetsCents: totalAssets,
      totalLiabilitiesCents: totalLiabilities,
      totalEquityCents: totalEquity,
      /** Assets = Liabilities + Equity. False would mean a broken ledger. */
      balanced: totalAssets === totalLiabilities + totalEquity,
    };
  }

  // --- Cash flow (indirect method) --------------------------------------------------------

  async cashFlow(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query);
    const accounts = await this.accounts(ctx.dealerId);
    return { range, ...(await this.cashFlowFor(ctx.dealerId, accounts, range)) };
  }

  async cashFlowFor(dealerId: string, accounts: AccountRow[], range: DateRange) {
    const before = await accountTotals(this.prisma, dealerId, {
      to: addDays(range.from, -1),
      excludeClosing: true,
    });
    const at = await accountTotals(this.prisma, dealerId, { to: range.to, excludeClosing: true });
    const during = await accountTotals(this.prisma, dealerId, {
      from: range.from,
      to: range.to,
      excludeClosing: true,
    });

    const netIncome = -sumCents(
      accounts
        .filter(
          (account) =>
            account.type === 'REVENUE' || account.type === 'COGS' || account.type === 'EXPENSE',
        )
        .map((account) => debitBalance(during.get(account.id))),
    );

    const sections: Record<'OPERATING' | 'INVESTING' | 'FINANCING', StatementLine[]> = {
      OPERATING: [],
      INVESTING: [],
      FINANCING: [],
    };
    let cashBefore = 0;
    let cashAfter = 0;
    for (const account of accounts) {
      const section = SUBTYPE_CASH_FLOW[account.subtype];
      if (!section) continue;
      const change = debitBalance(at.get(account.id)) - debitBalance(before.get(account.id));
      if (section === 'CASH') {
        cashBefore += debitBalance(before.get(account.id));
        cashAfter += debitBalance(at.get(account.id));
        continue;
      }
      if (change === 0) continue;
      // An asset going up uses cash; a liability or equity going up provides it.
      sections[section].push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        amountCents: -change,
      });
    }
    const operating = netIncome + sumCents(sections.OPERATING.map((line) => line.amountCents));
    const investing = sumCents(sections.INVESTING.map((line) => line.amountCents));
    const financing = sumCents(sections.FINANCING.map((line) => line.amountCents));
    const netChange = operating + investing + financing;
    return {
      netIncomeCents: netIncome,
      operating: { lines: sections.OPERATING, totalCents: operating },
      investing: { lines: sections.INVESTING, totalCents: investing },
      financing: { lines: sections.FINANCING, totalCents: financing },
      netChangeCents: netChange,
      beginningCashCents: cashBefore,
      endingCashCents: cashAfter,
      /** Beginning + net change = ending; false would mean an unclassified account. */
      reconciles: cashBefore + netChange === cashAfter,
    };
  }

  /** The net income for a range (closing entries excluded). */
  async netIncome(dealerId: string, range: DateRange): Promise<number> {
    const accounts = await this.accounts(dealerId);
    const totals = await accountTotals(this.prisma, dealerId, {
      from: range.from,
      to: range.to,
      excludeClosing: true,
    });
    return buildProfitAndLoss(accounts, totals, null).netIncomeCents;
  }

  /** Balance of every account as of a date, for dashboards. */
  async balancesAt(dealerId: string, asOf: IsoDate) {
    const accounts = await this.accounts(dealerId);
    const totals = await accountTotals(this.prisma, dealerId, { to: asOf });
    return accounts.map((account) => ({
      ...account,
      balanceCents: normalBalance(account.type, totals.get(account.id)),
    }));
  }
}

function addMonthsIso(date: IsoDate, months: number): IsoDate {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * Revenue − cost of sales = gross profit; − operating expenses = operating
 * income; + other income − other expenses (interest) = net income.
 */
export function buildProfitAndLoss(
  accounts: AccountRow[],
  current: Map<string, AccountTotals>,
  previous: Map<string, AccountTotals> | null,
) {
  const section = (
    key: string,
    label: string,
    filter: (account: AccountRow) => boolean,
  ): StatementSection => {
    const lines = accounts
      .filter(filter)
      .map((account) => ({
        accountId: account.id,
        code: account.code,
        name: account.name,
        amountCents: normalBalance(account.type, current.get(account.id)),
        ...(previous
          ? { compareCents: normalBalance(account.type, previous.get(account.id)) }
          : {}),
      }))
      .filter((line) => line.amountCents !== 0 || (line.compareCents ?? 0) !== 0);
    return {
      key,
      label,
      lines,
      totalCents: sumCents(lines.map((line) => line.amountCents)),
      ...(previous
        ? { compareTotalCents: sumCents(lines.map((line) => line.compareCents ?? 0)) }
        : {}),
    };
  };
  const revenue = section('REVENUE', 'Revenue', (a) => a.subtype === 'OPERATING_REVENUE');
  const cogs = section('COGS', 'Cost of sales', (a) => a.type === 'COGS');
  const expenses = section(
    'OPERATING_EXPENSES',
    'Operating expenses',
    (a) => a.subtype === 'OPERATING_EXPENSE',
  );
  const otherIncome = section('OTHER_INCOME', 'Other income', (a) => a.subtype === 'OTHER_INCOME');
  const otherExpense = section(
    'OTHER_EXPENSE',
    'Interest and other expenses',
    (a) => a.subtype === 'OTHER_EXPENSE',
  );

  const grossProfit = revenue.totalCents - cogs.totalCents;
  const operatingIncome = grossProfit - expenses.totalCents;
  const netIncome = operatingIncome + otherIncome.totalCents - otherExpense.totalCents;
  const compare = previous
    ? {
        grossProfitCents: (revenue.compareTotalCents ?? 0) - (cogs.compareTotalCents ?? 0),
        operatingIncomeCents:
          (revenue.compareTotalCents ?? 0) -
          (cogs.compareTotalCents ?? 0) -
          (expenses.compareTotalCents ?? 0),
        netIncomeCents:
          (revenue.compareTotalCents ?? 0) -
          (cogs.compareTotalCents ?? 0) -
          (expenses.compareTotalCents ?? 0) +
          (otherIncome.compareTotalCents ?? 0) -
          (otherExpense.compareTotalCents ?? 0),
      }
    : null;
  return {
    revenue,
    cogs,
    grossProfitCents: grossProfit,
    grossMarginBasisPoints:
      revenue.totalCents > 0 ? Math.round((grossProfit * 10_000) / revenue.totalCents) : null,
    expenses,
    operatingIncomeCents: operatingIncome,
    otherIncome,
    otherExpense,
    netIncomeCents: netIncome,
    compare,
  };
}

export type { ResolvedRange };
