import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { addDays, fromDbDate, todayIso } from '../core/dates';
import { PostingService, type LedgerLine } from '../journal/posting.service';
import { accountTotals, debitBalance } from '../reports/ledger';
import { ensureFiscalYear, fiscalCalendarOf } from './fiscal-periods';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async list(ctx: AccountingContext) {
    // The current year always exists, so the screen has something to show.
    await this.prisma.$transaction(async (tx) => {
      await ensureFiscalYear(
        tx,
        ctx.dealerId,
        todayIso(),
        await fiscalCalendarOf(tx, ctx.dealerId),
      );
    });
    const years = await this.prisma.fiscalYear.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: { startDate: 'desc' },
      include: { periods: { orderBy: { number: 'asc' } } },
    });
    const drafts = await this.prisma.journalEntry.groupBy({
      by: ['date'],
      where: { dealerId: ctx.dealerId, status: 'DRAFT' },
      _count: true,
    });
    return years.map((year) => ({
      id: year.id,
      name: year.name,
      startDate: fromDbDate(year.startDate),
      endDate: fromDbDate(year.endDate),
      status: year.status,
      closedAt: year.closedAt?.toISOString() ?? null,
      closingEntryId: year.closingEntryId,
      periods: year.periods.map((period) => ({
        id: period.id,
        number: period.number,
        name: period.name,
        quarter: Math.ceil(period.number / 3),
        startDate: fromDbDate(period.startDate),
        endDate: fromDbDate(period.endDate),
        status: period.status,
        closedAt: period.closedAt?.toISOString() ?? null,
        reopenedAt: period.reopenedAt?.toISOString() ?? null,
        reopenReason: period.reopenReason,
        draftEntries: drafts
          .filter((row) => row.date >= period.startDate && row.date <= period.endDate)
          .reduce((sum, row) => sum + row._count, 0),
      })),
    }));
  }

  /** Creates next year's periods ahead of time (otherwise the first posting does). */
  async openYear(ctx: AccountingContext, date: string) {
    return this.prisma.$transaction(async (tx) => {
      const year = await ensureFiscalYear(
        tx,
        ctx.dealerId,
        date,
        await fiscalCalendarOf(tx, ctx.dealerId),
      );
      await recordAudit(tx, ctx, {
        action: 'period.year_opened',
        entityType: 'FiscalYear',
        entityId: year.id,
      });
      return year;
    });
  }

  async closePeriod(ctx: AccountingContext, periodId: string, reason: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const period = await this.requirePeriod(tx, ctx, periodId);
      if (period.status === 'CLOSED')
        throw new ConflictException(`${period.name} is already closed`);
      const drafts = await tx.journalEntry.count({
        where: {
          dealerId: ctx.dealerId,
          status: 'DRAFT',
          date: { gte: period.startDate, lte: period.endDate },
        },
      });
      if (drafts > 0) {
        throw new ConflictException(
          `Post or delete the ${drafts} draft entr${drafts === 1 ? 'y' : 'ies'} in ${period.name} first`,
        );
      }
      await tx.accountingPeriod.update({
        where: { id: period.id },
        data: { status: 'CLOSED', closedAt: new Date(), closedById: ctx.userId },
      });
      await recordAudit(tx, ctx, {
        action: 'period.closed',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        before: { status: 'OPEN' },
        after: { status: 'CLOSED', name: period.name },
        reason,
      });
      return { id: period.id, status: 'CLOSED' as const };
    });
  }

  async reopenPeriod(ctx: AccountingContext, periodId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await this.requirePeriod(tx, ctx, periodId);
      if (period.status === 'OPEN') throw new ConflictException(`${period.name} is already open`);
      if (period.fiscalYear.status === 'CLOSED') {
        throw new ConflictException(
          `${period.fiscalYear.name} has been closed at year end; reopen the year first`,
        );
      }
      await tx.accountingPeriod.update({
        where: { id: period.id },
        data: {
          status: 'OPEN',
          reopenedAt: new Date(),
          reopenedById: ctx.userId,
          reopenReason: reason,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'period.reopened',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        before: { status: 'CLOSED' },
        after: { status: 'OPEN', name: period.name },
        reason,
      });
      return { id: period.id, status: 'OPEN' as const };
    });
  }

  /**
   * Year-end close: zeroes every revenue, cost-of-sales and expense account
   * into Retained Earnings with one closing entry dated the last day of the
   * year, then closes the year and all its periods. Balance-sheet accounts
   * carry into the new year as its opening balances.
   */
  async closeYear(ctx: AccountingContext, fiscalYearId: string, reason: string | null) {
    return this.prisma.$transaction(
      async (tx) => {
        const year = await tx.fiscalYear.findFirst({
          where: { id: fiscalYearId, dealerId: ctx.dealerId },
          include: { periods: true },
        });
        if (!year) throw new NotFoundException('Fiscal year not found');
        if (year.status === 'CLOSED') throw new ConflictException(`${year.name} is already closed`);
        const endDate = fromDbDate(year.endDate);
        if (endDate >= todayIso()) {
          throw new BadRequestException(`${year.name} has not ended yet`);
        }
        const earlierOpen = await tx.fiscalYear.findFirst({
          where: { dealerId: ctx.dealerId, status: 'OPEN', endDate: { lt: year.startDate } },
          select: { name: true },
        });
        if (earlierOpen) throw new ConflictException(`Close ${earlierOpen.name} first`);
        const drafts = await tx.journalEntry.count({
          where: {
            dealerId: ctx.dealerId,
            status: 'DRAFT',
            date: { gte: year.startDate, lte: year.endDate },
          },
        });
        if (drafts > 0)
          throw new ConflictException(
            `Post or delete the ${drafts} draft entries in ${year.name} first`,
          );

        // The closing entry is dated in the last period, which must be open
        // while it posts; the whole year is closed straight after.
        const lastPeriod = year.periods.find((period) => period.number === 12);
        if (lastPeriod?.status === 'CLOSED') {
          await tx.accountingPeriod.update({
            where: { id: lastPeriod.id },
            data: { status: 'OPEN' },
          });
        }

        const accounts = await tx.acctAccount.findMany({
          where: { dealerId: ctx.dealerId, type: { in: ['REVENUE', 'COGS', 'EXPENSE'] } },
          select: { id: true },
        });
        const totals = await accountTotals(tx, ctx.dealerId, {
          to: endDate,
          accountIds: accounts.map((account) => account.id),
        });
        const { RETAINED_EARNINGS: retained } = await this.posting.accounts(tx, ctx.dealerId, [
          'RETAINED_EARNINGS',
        ]);

        const lines: LedgerLine[] = [];
        let netDebit = 0; // debit-positive sum of the P&L balances
        for (const account of accounts) {
          const balance = debitBalance(totals.get(account.id));
          if (balance === 0) continue;
          netDebit += balance;
          lines.push({
            accountId: account.id,
            debit: balance < 0 ? -balance : 0,
            credit: balance > 0 ? balance : 0,
            description: 'Year-end close',
          });
        }
        let closingEntryId: string | null = null;
        if (lines.length > 0 && netDebit !== 0) {
          // Net income (credit-positive P&L) goes to retained earnings as a credit.
          lines.push({
            accountId: retained,
            debit: netDebit > 0 ? netDebit : 0,
            credit: netDebit < 0 ? -netDebit : 0,
            description: `${year.name} net ${netDebit < 0 ? 'income' : 'loss'}`,
          });
        }
        if (lines.length >= 2) {
          const entry = await this.posting.post(tx, ctx, {
            date: endDate,
            description: `Year-end close ${year.name}`,
            memo: reason,
            source: 'YEAR_END_CLOSE',
            kind: 'CLOSING',
            sourceType: 'FiscalYear',
            sourceId: year.id,
            lines,
          });
          closingEntryId = entry.id;
        }

        await tx.accountingPeriod.updateMany({
          where: { fiscalYearId: year.id },
          data: { status: 'CLOSED', closedAt: new Date(), closedById: ctx.userId },
        });
        await tx.fiscalYear.update({
          where: { id: year.id },
          data: { status: 'CLOSED', closedAt: new Date(), closedById: ctx.userId, closingEntryId },
        });
        // The next year exists, so its opening balances are visible at once.
        await ensureFiscalYear(
          tx,
          ctx.dealerId,
          addDays(endDate, 1),
          await fiscalCalendarOf(tx, ctx.dealerId),
        );

        await recordAudit(tx, ctx, {
          action: 'period.year_closed',
          entityType: 'FiscalYear',
          entityId: year.id,
          after: { name: year.name, closingEntryId, netIncomeCents: -netDebit },
          reason,
        });
        return { id: year.id, closingEntryId, netIncomeCents: -netDebit };
      },
      { timeout: 30_000 },
    );
  }

  /** Undoes a year-end close: reopens the year and reverses its closing entry. */
  async reopenYear(ctx: AccountingContext, fiscalYearId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const year = await tx.fiscalYear.findFirst({
        where: { id: fiscalYearId, dealerId: ctx.dealerId },
      });
      if (!year) throw new NotFoundException('Fiscal year not found');
      if (year.status !== 'CLOSED') throw new ConflictException(`${year.name} is not closed`);
      const laterClosed = await tx.fiscalYear.findFirst({
        where: { dealerId: ctx.dealerId, status: 'CLOSED', startDate: { gt: year.endDate } },
        select: { name: true },
      });
      if (laterClosed) throw new ConflictException(`Reopen ${laterClosed.name} first`);

      await tx.fiscalYear.update({
        where: { id: year.id },
        data: { status: 'OPEN', closedAt: null },
      });
      await tx.accountingPeriod.updateMany({
        where: { fiscalYearId: year.id },
        data: {
          status: 'OPEN',
          reopenedAt: new Date(),
          reopenedById: ctx.userId,
          reopenReason: reason,
        },
      });
      if (year.closingEntryId) {
        await this.posting.reverse(tx, ctx, year.closingEntryId, {
          date: fromDbDate(year.endDate),
          reason,
        });
        await tx.fiscalYear.update({ where: { id: year.id }, data: { closingEntryId: null } });
      }
      await recordAudit(tx, ctx, {
        action: 'period.year_reopened',
        entityType: 'FiscalYear',
        entityId: year.id,
        reason,
      });
      return { id: year.id, status: 'OPEN' as const };
    });
  }

  private async requirePeriod(tx: Tx, ctx: AccountingContext, periodId: string) {
    const period = await tx.accountingPeriod.findFirst({
      where: { id: periodId, dealerId: ctx.dealerId },
      include: { fiscalYear: { select: { name: true, status: true } } },
    });
    if (!period) throw new NotFoundException('Period not found');
    return period;
  }
}
