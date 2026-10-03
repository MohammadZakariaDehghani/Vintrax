import { centsToDecimalString } from '@vintrax/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, JournalKind, JournalSource, TaxType, VehicleCostCategory } from '@prisma/client';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromCents, sumCents, toCents } from '../core/money';
import { fromDbDate, toDbDate, todayIso, type IsoDate } from '../core/dates';
import { assertPeriodOpen, fiscalCalendarOf } from '../periods/fiscal-periods';
import type { SystemKey } from '../accounts/chart-of-accounts';

export interface LedgerLine {
  accountId: string;
  /** Integer cents; a line is a debit or a credit. Zero lines are dropped. */
  debit: number;
  credit: number;
  description?: string | null;
  vehicleId?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
  costCategory?: VehicleCostCategory | null;
  taxType?: TaxType | null;
}

export interface PostingRequest {
  date: IsoDate;
  description: string;
  memo?: string | null;
  source: JournalSource;
  kind?: JournalKind;
  sourceType?: string | null;
  sourceId?: string | null;
  lines: LedgerLine[];
  /** Automatic entries post; a manual entry may be kept as a draft. */
  status?: 'POSTED' | 'DRAFT';
  /** Set only by `reverse`. */
  reversalOfId?: string | null;
}

export interface PostedEntry {
  id: string;
  number: number;
  reference: string;
  totalCents: number;
}

type Tx = Prisma.TransactionClient;

/**
 * The only way anything reaches the ledger.
 *
 * Every business flow (a sale, a bill, a deposit…) builds its lines and calls
 * `post` inside its own transaction, so the document, its journal entry, its
 * tax lines and its audit record commit together or not at all. The checks
 * here are repeated by the database (see the migration): an entry that does
 * not balance cannot commit even if this code had a bug.
 */
@Injectable()
export class PostingService {
  async post(tx: Tx, ctx: AccountingContext, request: PostingRequest): Promise<PostedEntry> {
    const status = request.status ?? 'POSTED';
    const lines = normaliseLines(request.lines);
    const total = assertBalanced(lines, status === 'POSTED');

    await this.assertLinesBelongToDealer(tx, ctx, lines);

    // Allocating the number locks this dealer's settings row, which serialises
    // postings per dealer: fiscal-year creation and inventory checks that
    // follow cannot race another posting for the same dealer.
    const settings = await tx.accountingSettings.update({
      where: { dealerId: ctx.dealerId },
      data: { nextJournalNumber: { increment: 1 } },
      select: { nextJournalNumber: true, journalPrefix: true },
    });
    const number = settings.nextJournalNumber - 1;
    const reference = `${settings.journalPrefix}${String(number).padStart(6, '0')}`;

    if (status === 'POSTED') {
      await assertPeriodOpen(tx, ctx.dealerId, request.date, await fiscalCalendarOf(tx, ctx.dealerId));
    }

    const entry = await tx.journalEntry.create({
      data: {
        dealerId: ctx.dealerId,
        number,
        reference,
        date: toDbDate(request.date),
        description: request.description,
        memo: request.memo ?? null,
        source: request.source,
        kind: request.kind ?? 'STANDARD',
        status,
        sourceType: request.sourceType ?? null,
        sourceId: request.sourceId ?? null,
        reversalOfId: request.reversalOfId ?? null,
        total: fromCents(total),
        createdById: ctx.userId,
        postedById: status === 'POSTED' ? ctx.userId : null,
        postedAt: status === 'POSTED' ? new Date() : null,
        lines: {
          create: lines.map((line, index) => ({
            dealerId: ctx.dealerId,
            lineNo: index + 1,
            accountId: line.accountId,
            debit: fromCents(line.debit),
            credit: fromCents(line.credit),
            description: line.description ?? null,
            vehicleId: line.vehicleId ?? null,
            customerId: line.customerId ?? null,
            vendorId: line.vendorId ?? null,
            costCategory: line.costCategory ?? null,
            taxType: line.taxType ?? null,
          })),
        },
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: status === 'POSTED' ? 'journal.posted' : 'journal.draft_created',
      entityType: 'JournalEntry',
      entityId: entry.id,
      after: {
        reference,
        date: request.date,
        source: request.source,
        description: request.description,
        totalCents: total,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          vehicleId: line.vehicleId ?? undefined,
        })),
      },
    });

    return { id: entry.id, number, reference, totalCents: total };
  }

  /** Posts a draft entry after re-validating it. */
  async postDraft(tx: Tx, ctx: AccountingContext, entryId: string): Promise<PostedEntry> {
    const entry = await tx.journalEntry.findFirst({
      where: { id: entryId, dealerId: ctx.dealerId },
      include: { lines: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'DRAFT') throw new ConflictException('This entry is already posted');

    const lines = entry.lines.map((line) => ({
      accountId: line.accountId,
      debit: toCents(line.debit),
      credit: toCents(line.credit),
      vehicleId: line.vehicleId,
      customerId: line.customerId,
      vendorId: line.vendorId,
    }));
    const total = assertBalanced(normaliseLines(lines), true);
    await this.assertLinesBelongToDealer(tx, ctx, lines);
    const date = fromDbDate(entry.date);
    await assertPeriodOpen(tx, ctx.dealerId, date, await fiscalCalendarOf(tx, ctx.dealerId));

    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { status: 'POSTED', total: fromCents(total), postedAt: new Date(), postedById: ctx.userId },
    });
    await recordAudit(tx, ctx, {
      action: 'journal.posted',
      entityType: 'JournalEntry',
      entityId: entry.id,
      before: { status: 'DRAFT' },
      after: { status: 'POSTED', totalCents: total },
    });
    return { id: entry.id, number: entry.number, reference: entry.reference, totalCents: total };
  }

  /**
   * Posts the mirror image of a posted entry and marks the original reversed.
   * The reversal is dated the original's date when that period is open,
   * otherwise today — a closed period is never written into.
   */
  async reverse(
    tx: Tx,
    ctx: AccountingContext,
    entryId: string,
    options: { date?: IsoDate | null; reason: string },
  ): Promise<PostedEntry> {
    const entry = await tx.journalEntry.findFirst({
      where: { id: entryId, dealerId: ctx.dealerId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, reversedBy: { select: { id: true } } },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== 'POSTED') throw new ConflictException('Only a posted entry can be reversed');
    if (entry.reversedBy || entry.reversedAt) {
      throw new ConflictException(`${entry.reference} has already been reversed`);
    }
    if (entry.kind === 'REVERSAL') {
      throw new ConflictException('A reversal cannot itself be reversed; post a new entry instead');
    }

    let date = options.date ?? fromDbDate(entry.date);
    if (!options.date) {
      const period = await tx.accountingPeriod.findFirst({
        where: { dealerId: ctx.dealerId, startDate: { lte: entry.date }, endDate: { gte: entry.date } },
        select: { status: true },
      });
      if (period?.status === 'CLOSED') date = todayIso();
    }
    if (date < fromDbDate(entry.date)) {
      throw new BadRequestException('A reversal cannot be dated before the entry it reverses');
    }

    const posted = await this.post(tx, ctx, {
      date,
      description: `Reversal of ${entry.reference}: ${entry.description}`.slice(0, 200),
      memo: options.reason,
      source: 'REVERSAL',
      // Undoing a year-end close is itself closing bookkeeping, so the P&L
      // (which leaves closing entries out) is unaffected either way.
      kind: entry.kind === 'CLOSING' ? 'CLOSING' : 'REVERSAL',
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversalOfId: entry.id,
      lines: entry.lines.map((line) => ({
        accountId: line.accountId,
        debit: toCents(line.credit),
        credit: toCents(line.debit),
        description: line.description,
        vehicleId: line.vehicleId,
        customerId: line.customerId,
        vendorId: line.vendorId,
        costCategory: line.costCategory,
        taxType: line.taxType,
      })),
    });

    // The reversal carries the link; the original records when and why.
    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { reversedAt: new Date(), reversalReason: options.reason },
    });

    await recordAudit(tx, ctx, {
      action: 'journal.reversed',
      entityType: 'JournalEntry',
      entityId: entry.id,
      after: { reversalEntryId: posted.id, reversalReference: posted.reference, date },
      reason: options.reason,
    });
    return posted;
  }

  /** Resolves posting accounts by their stable system keys. */
  async accounts<K extends SystemKey>(
    tx: Tx,
    dealerId: string,
    keys: readonly K[],
  ): Promise<Record<K, string>> {
    const rows = await tx.acctAccount.findMany({
      where: { dealerId, systemKey: { in: [...keys] } },
      select: { id: true, systemKey: true, isActive: true },
    });
    const map = {} as Record<K, string>;
    for (const key of keys) {
      const row = rows.find((candidate) => candidate.systemKey === key);
      if (!row) {
        throw new ConflictException(
          `The ${key.toLowerCase().replace(/_/g, ' ')} account is missing from the chart of accounts`,
        );
      }
      map[key] = row.id;
    }
    return map;
  }

  private async assertLinesBelongToDealer(
    tx: Tx,
    ctx: AccountingContext,
    lines: readonly LedgerLine[],
  ): Promise<void> {
    const accountIds = unique(lines.map((line) => line.accountId));
    const accounts = await tx.acctAccount.findMany({
      where: { dealerId: ctx.dealerId, id: { in: accountIds } },
      select: { id: true, isActive: true, subtype: true, name: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('One of the accounts does not exist in this chart of accounts');
    }
    const inactive = accounts.find((account) => !account.isActive);
    if (inactive) throw new BadRequestException(`${inactive.name} is inactive`);
    const computed = accounts.find((account) => account.subtype === 'CURRENT_YEAR_EARNINGS');
    if (computed) {
      throw new BadRequestException(`${computed.name} is calculated; post to Retained Earnings instead`);
    }

    const vehicleIds = unique(lines.map((line) => line.vehicleId).filter(isString));
    if (vehicleIds.length > 0) {
      const count = await tx.vehicle.count({
        where: { id: { in: vehicleIds }, sellerId: ctx.ownerUserId },
      });
      if (count !== vehicleIds.length) throw new BadRequestException('Vehicle not found in your inventory');
    }
    const customerIds = unique(lines.map((line) => line.customerId).filter(isString));
    if (customerIds.length > 0) {
      const count = await tx.customer.count({ where: { id: { in: customerIds }, dealerId: ctx.dealerId } });
      if (count !== customerIds.length) throw new BadRequestException('Customer not found');
    }
    const vendorIds = unique(lines.map((line) => line.vendorId).filter(isString));
    if (vendorIds.length > 0) {
      const count = await tx.vendor.count({ where: { id: { in: vendorIds }, dealerId: ctx.dealerId } });
      if (count !== vendorIds.length) throw new BadRequestException('Vendor not found');
    }
  }
}

function normaliseLines(lines: readonly LedgerLine[]): LedgerLine[] {
  const kept: LedgerLine[] = [];
  for (const line of lines) {
    if (!Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit)) {
      throw new BadRequestException('Amounts must be whole cents');
    }
    if (line.debit < 0 || line.credit < 0) {
      throw new BadRequestException('A journal line cannot be negative');
    }
    if (line.debit > 0 && line.credit > 0) {
      throw new BadRequestException('A journal line is either a debit or a credit, not both');
    }
    if (line.debit === 0 && line.credit === 0) continue;
    kept.push(line);
  }
  return kept;
}

/** Debits = credits, at least two lines and a non-zero total. Returns the total. */
export function assertBalanced(lines: readonly LedgerLine[], strict = true): number {
  const debits = sumCents(lines.map((line) => line.debit));
  const credits = sumCents(lines.map((line) => line.credit));
  if (debits !== credits) {
    throw new BadRequestException(
      `Debits (${centsToDecimalString(debits)}) must equal credits (${centsToDecimalString(credits)})`,
    );
  }
  if (strict && (lines.length < 2 || debits === 0)) {
    throw new BadRequestException('A journal entry needs at least one debit and one credit');
  }
  return debits;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
