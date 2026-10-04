import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SUBTYPE_TYPE,
  type AccountCreateInput,
  type AccountUpdateInput,
  type AccountSubtype,
  type AccountType,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import type { IsoDate } from '../core/dates';
import { accountTotals, normalBalance } from '../reports/ledger';

export interface AccountView {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  systemKey: string | null;
  isSystem: boolean;
  isActive: boolean;
  parentId: string | null;
  description: string | null;
  /** In the account's normal direction, as of the requested date. */
  balanceCents: number;
  isBankAccount: boolean;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: AccountingContext, asOf?: IsoDate): Promise<AccountView[]> {
    const [accounts, totals, banks] = await Promise.all([
      this.prisma.acctAccount.findMany({
        where: { dealerId: ctx.dealerId },
        orderBy: { code: 'asc' },
      }),
      accountTotals(this.prisma, ctx.dealerId, { to: asOf ?? null }),
      this.prisma.bankAccount.findMany({
        where: { dealerId: ctx.dealerId },
        select: { glAccountId: true },
      }),
    ]);
    const bankGl = new Set(banks.map((bank) => bank.glAccountId));
    return accounts.map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      systemKey: account.systemKey,
      isSystem: account.isSystem,
      isActive: account.isActive,
      parentId: account.parentId,
      description: account.description,
      balanceCents: normalBalance(account.type, totals.get(account.id)),
      isBankAccount: bankGl.has(account.id),
    }));
  }

  async create(ctx: AccountingContext, input: AccountCreateInput) {
    if (input.subtype === 'CURRENT_YEAR_EARNINGS') {
      throw new BadRequestException(
        'Current year earnings is calculated; there is one such account',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.parentId) await this.requireAccount(tx, ctx, input.parentId);
      try {
        const account = await tx.acctAccount.create({
          data: {
            dealerId: ctx.dealerId,
            code: input.code,
            name: input.name,
            type: SUBTYPE_TYPE[input.subtype],
            subtype: input.subtype,
            parentId: input.parentId,
            description: input.description,
          },
        });
        await recordAudit(tx, ctx, {
          action: 'account.created',
          entityType: 'AcctAccount',
          entityId: account.id,
          after: { code: account.code, name: account.name, subtype: account.subtype },
        });
        return { id: account.id };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(`Account code ${input.code} is already used`);
        }
        throw error;
      }
    });
  }

  async update(ctx: AccountingContext, accountId: string, input: AccountUpdateInput) {
    return this.prisma.$transaction(async (tx) => {
      const account = await this.requireAccount(tx, ctx, accountId);
      if (input.isActive === false) {
        if (account.isSystem) {
          throw new ConflictException(
            'This account is used by automatic postings and stays active',
          );
        }
        const bank = await tx.bankAccount.findFirst({
          where: { glAccountId: account.id, isActive: true },
        });
        if (bank) throw new ConflictException('Close the bank account first');
        const totals = await accountTotals(tx, ctx.dealerId, { accountIds: [account.id] });
        if (normalBalance(account.type, totals.get(account.id)) !== 0) {
          throw new ConflictException(
            'An account with a balance cannot be deactivated; move the balance first',
          );
        }
      }
      if (input.parentId) {
        if (input.parentId === account.id)
          throw new BadRequestException('An account cannot be its own parent');
        await this.requireAccount(tx, ctx, input.parentId);
      }
      const updated = await tx.acctAccount.update({
        where: { id: account.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        },
      });
      await recordAudit(tx, ctx, {
        action: 'account.updated',
        entityType: 'AcctAccount',
        entityId: account.id,
        before: {
          name: account.name,
          isActive: account.isActive,
          description: account.description,
        },
        after: { name: updated.name, isActive: updated.isActive, description: updated.description },
      });
      return { id: updated.id };
    });
  }

  private async requireAccount(
    tx: Prisma.TransactionClient,
    ctx: AccountingContext,
    accountId: string,
  ) {
    const account = await tx.acctAccount.findFirst({
      where: { id: accountId, dealerId: ctx.dealerId },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }
}
