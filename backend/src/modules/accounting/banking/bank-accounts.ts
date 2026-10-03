import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AcctAccountSubtype, BankAccountType, Prisma } from '@prisma/client';
import type { BankAccountInput } from '@vintrax/shared';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromCents } from '../core/money';
import { typeOf } from '../accounts/chart-of-accounts';
import type { PostingService } from '../journal/posting.service';

type Tx = Prisma.TransactionClient;

/** Where each kind of account sits in the chart, and its code range. */
const GL_FOR_TYPE: Record<BankAccountType, { subtype: AcctAccountSubtype; from: number; to: number }> = {
  CASH: { subtype: 'CASH', from: 1001, to: 1009 },
  CHEQUING: { subtype: 'BANK', from: 1010, to: 1099 },
  SAVINGS: { subtype: 'BANK', from: 1010, to: 1099 },
  CREDIT_CARD: { subtype: 'CREDIT_CARD', from: 2050, to: 2079 },
  LINE_OF_CREDIT: { subtype: 'CURRENT_LIABILITY', from: 2080, to: 2099 },
};

/** Money accounts a payment may come from or go to. */
export const MONEY_SUBTYPES: AcctAccountSubtype[] = ['CASH', 'BANK', 'CREDIT_CARD', 'CURRENT_LIABILITY'];

/**
 * Creates a bank (or cash, or card) account with its own ledger account, and
 * posts its opening balance against Owner Equity. Only the last four digits
 * of an account number are ever stored.
 */
export async function createBankAccount(
  tx: Tx,
  ctx: AccountingContext,
  posting: PostingService,
  input: BankAccountInput & { useGlAccountId?: string },
): Promise<{ id: string; glAccountId: string }> {
  const placement = GL_FOR_TYPE[input.type];

  let glAccountId = input.useGlAccountId;
  if (!glAccountId) {
    const existing = await tx.acctAccount.findMany({
      where: { dealerId: ctx.dealerId },
      select: { code: true },
    });
    const taken = new Set(existing.map((account) => account.code));
    let code: string | null = null;
    for (let candidate = placement.from; candidate <= placement.to; candidate += 1) {
      if (!taken.has(String(candidate))) {
        code = String(candidate);
        break;
      }
    }
    if (!code) throw new ConflictException('No free account code for another account of this kind');
    const gl = await tx.acctAccount.create({
      data: {
        dealerId: ctx.dealerId,
        code,
        name: input.name,
        type: typeOf(placement.subtype),
        subtype: placement.subtype,
        description: input.bankName ? `${input.bankName}${input.accountNumberLast4 ? ` ····${input.accountNumberLast4}` : ''}` : null,
      },
      select: { id: true },
    });
    glAccountId = gl.id;
  }

  const bank = await tx.bankAccount.create({
    data: {
      dealerId: ctx.dealerId,
      name: input.name,
      bankName: input.bankName,
      type: input.type,
      accountNumberLast4: input.accountNumberLast4,
      glAccountId,
      openingBalance: fromCents(input.openingBalance),
      openingDate: new Date(`${input.openingDate}T00:00:00.000Z`),
    },
    select: { id: true },
  });

  if (input.openingBalance !== 0) {
    const { OWNER_EQUITY: equity } = await posting.accounts(tx, ctx.dealerId, ['OWNER_EQUITY']);
    const isAsset = typeOf(placement.subtype) === 'ASSET';
    // For an asset a positive balance is money held; for a card or line of
    // credit it is money owed.
    const debitBank = isAsset ? input.openingBalance > 0 : input.openingBalance < 0;
    const amount = Math.abs(input.openingBalance);
    const entry = await posting.post(tx, ctx, {
      date: input.openingDate,
      description: `Opening balance — ${input.name}`,
      source: 'OPENING_BALANCE',
      kind: 'OPENING',
      sourceType: 'BankAccount',
      sourceId: bank.id,
      lines: [
        { accountId: glAccountId, debit: debitBank ? amount : 0, credit: debitBank ? 0 : amount },
        { accountId: equity, debit: debitBank ? 0 : amount, credit: debitBank ? amount : 0 },
      ],
    });
    await tx.bankTransaction.create({
      data: {
        dealerId: ctx.dealerId,
        bankAccountId: bank.id,
        kind: 'ADJUSTMENT',
        date: new Date(`${input.openingDate}T00:00:00.000Z`),
        amount: fromCents(input.openingBalance),
        counterAccountId: equity,
        description: 'Opening balance',
        journalEntryId: entry.id,
        createdById: ctx.userId,
      },
    });
  }

  await recordAudit(tx, ctx, {
    action: 'bank.account_created',
    entityType: 'BankAccount',
    entityId: bank.id,
    after: { name: input.name, type: input.type, last4: input.accountNumberLast4, openingBalanceCents: input.openingBalance },
  });
  return { id: bank.id, glAccountId };
}

/** The bank account's ledger account, checked to belong to this dealer. */
export async function bankGlAccount(
  tx: Tx,
  ctx: AccountingContext,
  bankAccountId: string,
): Promise<{ id: string; glAccountId: string; name: string; type: BankAccountType }> {
  const bank = await tx.bankAccount.findFirst({
    where: { id: bankAccountId, dealerId: ctx.dealerId },
    select: { id: true, glAccountId: true, name: true, type: true, isActive: true },
  });
  if (!bank) throw new BadRequestException('Bank account not found');
  if (!bank.isActive) throw new BadRequestException(`${bank.name} is closed`);
  return bank;
}
