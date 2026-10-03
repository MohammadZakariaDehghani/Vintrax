import type { Prisma } from '@prisma/client';
import { isDebitNormal, type AccountType } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { toDbDate, type IsoDate } from '../core/dates';
import { toCents } from '../core/money';

type Db = Prisma.TransactionClient | PrismaService;

export interface AccountTotals {
  debitCents: number;
  creditCents: number;
}

/**
 * Debit and credit totals per account over posted entries, optionally in a
 * date range. This is the one query every statement is built on: reports read
 * the ledger, never the documents that produced it.
 */
export async function accountTotals(
  db: Db,
  dealerId: string,
  options: {
    from?: IsoDate | null;
    to?: IsoDate | null;
    /** Leave out year-end closing entries (for P&L and cash-flow periods). */
    excludeClosing?: boolean;
    accountIds?: string[];
    vehicleId?: string;
  } = {},
): Promise<Map<string, AccountTotals>> {
  const date: Prisma.DateTimeFilter = {};
  if (options.from) date.gte = toDbDate(options.from);
  if (options.to) date.lte = toDbDate(options.to);

  const rows = await db.journalLine.groupBy({
    by: ['accountId'],
    where: {
      dealerId,
      ...(options.accountIds ? { accountId: { in: options.accountIds } } : {}),
      ...(options.vehicleId ? { vehicleId: options.vehicleId } : {}),
      entry: {
        status: 'POSTED',
        ...(Object.keys(date).length ? { date } : {}),
        ...(options.excludeClosing ? { kind: { not: 'CLOSING' } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });

  const map = new Map<string, AccountTotals>();
  for (const row of rows) {
    map.set(row.accountId, {
      debitCents: toCents(row._sum.debit),
      creditCents: toCents(row._sum.credit),
    });
  }
  return map;
}

/** A balance in the account's normal direction (positive = normal). */
export function normalBalance(type: AccountType, totals: AccountTotals | undefined): number {
  if (!totals) return 0;
  return isDebitNormal(type)
    ? totals.debitCents - totals.creditCents
    : totals.creditCents - totals.debitCents;
}

/** Debit-positive balance (debits − credits). */
export function debitBalance(totals: AccountTotals | undefined): number {
  return totals ? totals.debitCents - totals.creditCents : 0;
}
