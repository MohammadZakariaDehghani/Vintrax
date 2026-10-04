import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  centsToDecimalString,
  type BankAccountInput,
  type BankTransactionInput,
  type ReconciliationStartInput,
  type ReportQuery,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromDbDate, toDbDate } from '../core/dates';
import { requireAccount } from '../core/documents';
import { fromCents, sumCents, toCents } from '../core/money';
import { PostingService, type LedgerLine } from '../journal/posting.service';
import { accountTotals, normalBalance } from '../reports/ledger';
import { resolveRange } from '../reports/date-ranges';
import { bankGlAccount, createBankAccount } from './bank-accounts';

type Tx = Prisma.TransactionClient;

@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async accounts(ctx: AccountingContext) {
    const banks = await this.prisma.bankAccount.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        glAccount: { select: { id: true, code: true, name: true, type: true, subtype: true } },
      },
    });
    const totals = await accountTotals(this.prisma, ctx.dealerId, {
      accountIds: banks.map((bank) => bank.glAccountId),
    });
    const lastReconciled = await this.prisma.bankReconciliation.findMany({
      where: { dealerId: ctx.dealerId, status: 'COMPLETED' },
      orderBy: { statementDate: 'desc' },
      distinct: ['bankAccountId'],
      select: { bankAccountId: true, statementDate: true, endingBalance: true },
    });
    const unreconciled = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        dealerId: ctx.dealerId,
        accountId: { in: banks.map((bank) => bank.glAccountId) },
        reconciliationId: null,
        entry: { status: 'POSTED' },
      },
      _count: true,
    });
    return banks.map((bank) => {
      const last = lastReconciled.find((row) => row.bankAccountId === bank.id);
      return {
        id: bank.id,
        name: bank.name,
        bankName: bank.bankName,
        type: bank.type,
        currency: bank.currency,
        accountNumberMasked: bank.accountNumberLast4 ? `····${bank.accountNumberLast4}` : null,
        glAccount: { id: bank.glAccount.id, code: bank.glAccount.code, name: bank.glAccount.name },
        openingBalanceCents: toCents(bank.openingBalance),
        openingDate: fromDbDate(bank.openingDate),
        balanceCents: normalBalance(bank.glAccount.type, totals.get(bank.glAccountId)),
        isActive: bank.isActive,
        lastReconciledDate: last ? fromDbDate(last.statementDate) : null,
        lastReconciledBalanceCents: last ? toCents(last.endingBalance) : null,
        unreconciledCount:
          unreconciled.find((row) => row.accountId === bank.glAccountId)?._count ?? 0,
      };
    });
  }

  async createAccount(ctx: AccountingContext, input: BankAccountInput) {
    return this.prisma.$transaction((tx) => createBankAccount(tx, ctx, this.posting, input));
  }

  async updateAccount(
    ctx: AccountingContext,
    bankAccountId: string,
    input: { name?: string; bankName?: string | null; isActive?: boolean },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const bank = await tx.bankAccount.findFirst({
        where: { id: bankAccountId, dealerId: ctx.dealerId },
      });
      if (!bank) throw new NotFoundException('Bank account not found');
      if (input.isActive === false) {
        const gl = await tx.acctAccount.findUniqueOrThrow({ where: { id: bank.glAccountId } });
        const totals = await accountTotals(tx, ctx.dealerId, { accountIds: [gl.id] });
        if (normalBalance(gl.type, totals.get(gl.id)) !== 0) {
          throw new ConflictException(
            'An account with a balance cannot be closed; transfer the balance first',
          );
        }
      }
      const updated = await tx.bankAccount.update({
        where: { id: bank.id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      if (input.name)
        await tx.acctAccount.update({
          where: { id: bank.glAccountId },
          data: { name: input.name },
        });
      await recordAudit(tx, ctx, {
        action: 'bank.account_updated',
        entityType: 'BankAccount',
        entityId: bank.id,
        before: { name: bank.name, isActive: bank.isActive },
        after: { name: updated.name, isActive: updated.isActive },
      });
      return { id: updated.id };
    });
  }

  /** Every posted movement on a bank account, with a running balance. */
  async register(ctx: AccountingContext, bankAccountId: string, query: ReportQuery) {
    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, dealerId: ctx.dealerId },
      include: { glAccount: true },
    });
    if (!bank) throw new NotFoundException('Bank account not found');
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'THIS_MONTH');
    const opening = await this.prisma.journalLine.aggregate({
      where: {
        dealerId: ctx.dealerId,
        accountId: bank.glAccountId,
        entry: { status: 'POSTED', date: { lt: toDbDate(range.from) } },
      },
      _sum: { debit: true, credit: true },
    });
    const sign = bank.glAccount.type === 'ASSET' ? 1 : -1;
    let balance = sign * (toCents(opening._sum.debit) - toCents(opening._sum.credit));
    const openingCents = balance;
    const lines = await this.prisma.journalLine.findMany({
      where: {
        dealerId: ctx.dealerId,
        accountId: bank.glAccountId,
        entry: { status: 'POSTED', date: { gte: toDbDate(range.from), lte: toDbDate(range.to) } },
      },
      include: {
        entry: {
          select: { id: true, date: true, reference: true, description: true, source: true },
        },
      },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });
    return {
      bankAccount: { id: bank.id, name: bank.name },
      range,
      openingCents,
      items: lines.map((line) => {
        const amount = sign * (toCents(line.debit) - toCents(line.credit));
        balance += amount;
        return {
          lineId: line.id,
          date: fromDbDate(line.entry.date),
          reference: line.entry.reference,
          description: line.description ?? line.entry.description,
          source: line.entry.source,
          journalEntryId: line.entry.id,
          depositCents: amount > 0 ? amount : 0,
          withdrawalCents: amount < 0 ? -amount : 0,
          balanceCents: balance,
          reconciled: Boolean(line.reconciliationId),
        };
      }),
      closingCents: balance,
    };
  }

  /** Deposit, withdrawal, transfer, fee or adjustment entered from the banking screen. */
  async createTransaction(ctx: AccountingContext, input: BankTransactionInput) {
    return this.prisma.$transaction(async (tx) => {
      const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
      const amount = Math.abs(input.amount);
      let lines: LedgerLine[];
      let counterAccountId: string | null = input.counterAccountId;

      if (input.kind === 'TRANSFER') {
        const target = await bankGlAccount(tx, ctx, input.toBankAccountId!);
        lines = [
          {
            accountId: target.glAccountId,
            debit: amount,
            credit: 0,
            description: `Transfer from ${bank.name}`,
          },
          {
            accountId: bank.glAccountId,
            debit: 0,
            credit: amount,
            description: `Transfer to ${target.name}`,
          },
        ];
        counterAccountId = target.glAccountId;
      } else {
        if (input.kind === 'FEE' && !counterAccountId) {
          counterAccountId = (await this.posting.accounts(tx, ctx.dealerId, ['BANK_FEES']))
            .BANK_FEES;
        }
        const counter = await requireAccount(tx, ctx, counterAccountId!);
        if (counter.id === bank.glAccountId)
          throw new BadRequestException('Choose a different account for the other side');
        const moneyIn =
          input.kind === 'DEPOSIT' || (input.kind === 'ADJUSTMENT' && input.amount > 0);
        lines = [
          {
            accountId: bank.glAccountId,
            debit: moneyIn ? amount : 0,
            credit: moneyIn ? 0 : amount,
            description: input.description,
          },
          {
            accountId: counter.id,
            debit: moneyIn ? 0 : amount,
            credit: moneyIn ? amount : 0,
            description: input.description,
          },
        ];
      }

      const transaction = await tx.bankTransaction.create({
        data: {
          dealerId: ctx.dealerId,
          bankAccountId: bank.id,
          kind: input.kind,
          date: toDbDate(input.date),
          amount: fromCents(input.amount),
          counterAccountId,
          toBankAccountId: input.toBankAccountId,
          description: input.description,
          reference: input.reference,
          createdById: ctx.userId,
        },
      });
      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: `${kindLabel(input.kind)} — ${input.description}`,
        source: 'BANK_TRANSACTION',
        sourceType: 'BankTransaction',
        sourceId: transaction.id,
        lines,
      });
      await tx.bankTransaction.update({
        where: { id: transaction.id },
        data: { journalEntryId: entry.id },
      });
      await recordAudit(tx, ctx, {
        action: 'bank.transaction_created',
        entityType: 'BankTransaction',
        entityId: transaction.id,
        after: { kind: input.kind, amountCents: input.amount, journal: entry.reference },
      });
      return { id: transaction.id, journalEntryId: entry.id };
    });
  }

  async reverseTransaction(ctx: AccountingContext, transactionId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.bankTransaction.findFirst({
        where: { id: transactionId, dealerId: ctx.dealerId },
      });
      if (!transaction) throw new NotFoundException('Transaction not found');
      if (transaction.status !== 'POSTED')
        throw new ConflictException('This transaction is already reversed');
      if (!transaction.journalEntryId)
        throw new ConflictException('Opening balances are corrected with a journal entry');
      const reconciled = await tx.journalLine.count({
        where: { entryId: transaction.journalEntryId, reconciliationId: { not: null } },
      });
      if (reconciled > 0)
        throw new ConflictException(
          'This transaction has been reconciled; post an adjustment instead',
        );
      const reversal = await this.posting.reverse(tx, ctx, transaction.journalEntryId, { reason });
      await tx.bankTransaction.update({ where: { id: transaction.id }, data: { status: 'VOID' } });
      await recordAudit(tx, ctx, {
        action: 'bank.transaction_reversed',
        entityType: 'BankTransaction',
        entityId: transaction.id,
        after: { reversal: reversal.reference },
        reason,
      });
      return { id: transaction.id };
    });
  }

  // --- Reconciliation -------------------------------------------------------

  async reconciliations(ctx: AccountingContext, bankAccountId?: string) {
    const rows = await this.prisma.bankReconciliation.findMany({
      where: { dealerId: ctx.dealerId, ...(bankAccountId ? { bankAccountId } : {}) },
      orderBy: [{ statementDate: 'desc' }],
      include: { bankAccount: { select: { id: true, name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      bankAccount: row.bankAccount,
      statementDate: fromDbDate(row.statementDate),
      beginningBalanceCents: toCents(row.beginningBalance),
      endingBalanceCents: toCents(row.endingBalance),
      clearedBalanceCents: toCents(row.clearedBalance),
      differenceCents: toCents(row.difference),
      status: row.status,
      completedAt: row.completedAt?.toISOString() ?? null,
      adjustmentEntryId: row.adjustmentEntryId,
      adjustmentReason: row.adjustmentReason,
    }));
  }

  async startReconciliation(ctx: AccountingContext, input: ReconciliationStartInput) {
    return this.prisma.$transaction(async (tx) => {
      const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
      const open = await tx.bankReconciliation.findFirst({
        where: { dealerId: ctx.dealerId, bankAccountId: bank.id, status: 'IN_PROGRESS' },
      });
      if (open) throw new ConflictException('Finish the reconciliation already in progress first');
      const last = await tx.bankReconciliation.findFirst({
        where: { dealerId: ctx.dealerId, bankAccountId: bank.id, status: 'COMPLETED' },
        orderBy: { statementDate: 'desc' },
      });
      if (last && input.statementDate <= fromDbDate(last.statementDate)) {
        throw new BadRequestException('The statement must end after the last reconciled statement');
      }
      const beginning = input.beginningBalance ?? (last ? toCents(last.endingBalance) : 0);
      const reconciliation = await tx.bankReconciliation.create({
        data: {
          dealerId: ctx.dealerId,
          bankAccountId: bank.id,
          statementDate: toDbDate(input.statementDate),
          beginningBalance: fromCents(beginning),
          endingBalance: fromCents(input.endingBalance),
          clearedBalance: fromCents(beginning),
          difference: fromCents(input.endingBalance - beginning),
          createdById: ctx.userId,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'reconciliation.started',
        entityType: 'BankReconciliation',
        entityId: reconciliation.id,
        after: {
          bankAccountId: bank.id,
          statementDate: input.statementDate,
          endingBalanceCents: input.endingBalance,
          beginningCents: beginning,
        },
      });
      return { id: reconciliation.id };
    });
  }

  /** The statement view: every uncleared (or cleared-here) line up to the statement date. */
  async reconciliation(ctx: AccountingContext, reconciliationId: string) {
    const rec = await this.requireReconciliation(this.prisma, ctx, reconciliationId);
    const bank = await this.prisma.bankAccount.findUniqueOrThrow({
      where: { id: rec.bankAccountId },
      include: { glAccount: true },
    });
    const sign = bank.glAccount.type === 'ASSET' ? 1 : -1;
    const lines = await this.prisma.journalLine.findMany({
      where: {
        dealerId: ctx.dealerId,
        accountId: bank.glAccountId,
        entry: { status: 'POSTED', date: { lte: rec.statementDate } },
        OR: [{ reconciliationId: null }, { reconciliationId: rec.id }],
      },
      include: { entry: { select: { id: true, date: true, reference: true, description: true } } },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });
    const totals = await accountTotals(this.prisma, ctx.dealerId, {
      accountIds: [bank.glAccountId],
      to: fromDbDate(rec.statementDate),
    });
    const bookBalance = normalBalance(bank.glAccount.type, totals.get(bank.glAccountId));
    const items = lines.map((line) => ({
      lineId: line.id,
      date: fromDbDate(line.entry.date),
      reference: line.entry.reference,
      description: line.description ?? line.entry.description,
      journalEntryId: line.entry.id,
      amountCents: sign * (toCents(line.debit) - toCents(line.credit)),
      cleared: line.reconciliationId === rec.id,
    }));
    const clearedBalance =
      toCents(rec.beginningBalance) +
      sumCents(items.filter((item) => item.cleared).map((item) => item.amountCents));
    return {
      id: rec.id,
      bankAccount: { id: bank.id, name: bank.name },
      statementDate: fromDbDate(rec.statementDate),
      status: rec.status,
      beginningBalanceCents: toCents(rec.beginningBalance),
      statementBalanceCents: toCents(rec.endingBalance),
      bookBalanceCents: bookBalance,
      clearedBalanceCents: clearedBalance,
      differenceCents: toCents(rec.endingBalance) - clearedBalance,
      unreconciledCount: items.filter((item) => !item.cleared).length,
      items,
      adjustmentEntryId: rec.adjustmentEntryId,
      adjustmentReason: rec.adjustmentReason,
    };
  }

  /** Marks exactly these lines as cleared on this statement. */
  async setCleared(ctx: AccountingContext, reconciliationId: string, clearedLineIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      const rec = await this.requireReconciliation(tx, ctx, reconciliationId);
      if (rec.status !== 'IN_PROGRESS')
        throw new ConflictException('This reconciliation is completed');
      const bank = await tx.bankAccount.findUniqueOrThrow({ where: { id: rec.bankAccountId } });
      if (clearedLineIds.length > 0) {
        const eligible = await tx.journalLine.count({
          where: {
            id: { in: clearedLineIds },
            dealerId: ctx.dealerId,
            accountId: bank.glAccountId,
            entry: { status: 'POSTED', date: { lte: rec.statementDate } },
            OR: [{ reconciliationId: null }, { reconciliationId: rec.id }],
          },
        });
        if (eligible !== new Set(clearedLineIds).size) {
          throw new BadRequestException(
            'Some of those items are not on this account or are already reconciled',
          );
        }
      }
      await tx.journalLine.updateMany({
        where: { reconciliationId: rec.id, id: { notIn: clearedLineIds } },
        data: { reconciliationId: null },
      });
      if (clearedLineIds.length > 0) {
        await tx.journalLine.updateMany({
          where: { id: { in: clearedLineIds } },
          data: { reconciliationId: rec.id },
        });
      }
      await this.refreshTotals(tx, rec.id);
    });
    return this.reconciliation(ctx, reconciliationId);
  }

  /**
   * Completes the reconciliation. The difference must be zero — unless an
   * authorized user records an adjustment for it, with a reason, which posts
   * a journal entry (cleared at once) and is in the audit trail.
   */
  async completeReconciliation(
    ctx: AccountingContext,
    reconciliationId: string,
    adjustment: { accountId: string; reason: string } | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rec = await this.requireReconciliation(tx, ctx, reconciliationId);
      if (rec.status !== 'IN_PROGRESS')
        throw new ConflictException('This reconciliation is already completed');
      await this.refreshTotals(tx, rec.id);
      const fresh = await tx.bankReconciliation.findUniqueOrThrow({ where: { id: rec.id } });
      const difference = toCents(fresh.difference);
      let adjustmentEntryId: string | null = null;

      if (difference !== 0) {
        if (!adjustment) {
          throw new ConflictException({
            message: `The statement and the cleared items differ by ${centsToDecimalString(difference)}. Find the difference, or record an adjustment with a reason.`,
            code: 'RECONCILIATION_DIFFERENCE',
            differenceCents: difference,
          });
        }
        const bank = await tx.bankAccount.findUniqueOrThrow({
          where: { id: rec.bankAccountId },
          include: { glAccount: true },
        });
        const counter = await requireAccount(tx, ctx, adjustment.accountId);
        if (counter.id === bank.glAccountId)
          throw new BadRequestException('Choose the account the difference belongs in');
        const isAsset = bank.glAccount.type === 'ASSET';
        // The bank shows more than the cleared items: increase the book balance.
        const debitBank = isAsset ? difference > 0 : difference < 0;
        const amount = Math.abs(difference);
        const entry = await this.posting.post(tx, ctx, {
          date: fromDbDate(rec.statementDate),
          description: `Reconciliation adjustment — ${bank.name}`,
          memo: adjustment.reason,
          source: 'RECONCILIATION_ADJUSTMENT',
          kind: 'ADJUSTING',
          sourceType: 'BankReconciliation',
          sourceId: rec.id,
          lines: [
            {
              accountId: bank.glAccountId,
              debit: debitBank ? amount : 0,
              credit: debitBank ? 0 : amount,
              description: adjustment.reason,
            },
            {
              accountId: counter.id,
              debit: debitBank ? 0 : amount,
              credit: debitBank ? amount : 0,
              description: adjustment.reason,
            },
          ],
        });
        await tx.journalLine.updateMany({
          where: { entryId: entry.id, accountId: bank.glAccountId },
          data: { reconciliationId: rec.id },
        });
        adjustmentEntryId = entry.id;
        await this.refreshTotals(tx, rec.id);
      }

      await tx.bankReconciliation.update({
        where: { id: rec.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: ctx.userId,
          adjustmentEntryId,
          adjustmentReason: adjustment?.reason ?? null,
        },
      });
      await recordAudit(tx, ctx, {
        action: 'reconciliation.completed',
        entityType: 'BankReconciliation',
        entityId: rec.id,
        after: {
          statementBalanceCents: toCents(rec.endingBalance),
          differenceCents: difference,
          adjustmentEntryId,
        },
        reason: adjustment?.reason ?? null,
      });
      return { id: rec.id, adjustmentEntryId };
    });
  }

  /** Abandons an in-progress reconciliation, un-clearing its items. */
  async discardReconciliation(ctx: AccountingContext, reconciliationId: string) {
    await this.prisma.$transaction(async (tx) => {
      const rec = await this.requireReconciliation(tx, ctx, reconciliationId);
      if (rec.status !== 'IN_PROGRESS')
        throw new ConflictException('A completed reconciliation is kept');
      await tx.journalLine.updateMany({
        where: { reconciliationId: rec.id },
        data: { reconciliationId: null },
      });
      await tx.bankReconciliation.delete({ where: { id: rec.id } });
      await recordAudit(tx, ctx, {
        action: 'reconciliation.discarded',
        entityType: 'BankReconciliation',
        entityId: rec.id,
      });
    });
  }

  private async refreshTotals(tx: Tx, reconciliationId: string) {
    const rec = await tx.bankReconciliation.findUniqueOrThrow({
      where: { id: reconciliationId },
      include: { bankAccount: { include: { glAccount: true } } },
    });
    const sums = await tx.journalLine.aggregate({
      where: { reconciliationId },
      _sum: { debit: true, credit: true },
    });
    const sign = rec.bankAccount.glAccount.type === 'ASSET' ? 1 : -1;
    const cleared =
      toCents(rec.beginningBalance) + sign * (toCents(sums._sum.debit) - toCents(sums._sum.credit));
    await tx.bankReconciliation.update({
      where: { id: reconciliationId },
      data: {
        clearedBalance: fromCents(cleared),
        difference: fromCents(toCents(rec.endingBalance) - cleared),
      },
    });
  }

  private async requireReconciliation(
    db: Tx | PrismaService,
    ctx: AccountingContext,
    reconciliationId: string,
  ) {
    const rec = await db.bankReconciliation.findFirst({
      where: { id: reconciliationId, dealerId: ctx.dealerId },
    });
    if (!rec) throw new NotFoundException('Reconciliation not found');
    return rec;
  }
}

function kindLabel(kind: string): string {
  return (
    {
      DEPOSIT: 'Deposit',
      WITHDRAWAL: 'Withdrawal',
      TRANSFER: 'Transfer',
      FEE: 'Bank fee',
      ADJUSTMENT: 'Adjustment',
    }[kind] ?? kind
  );
}
