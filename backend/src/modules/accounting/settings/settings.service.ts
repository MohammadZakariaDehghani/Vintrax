import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACCOUNTING_PERMISSIONS,
  STAFF_ROLE_PERMISSIONS,
  type AccountingSettingsInput,
  type AccountingSetupInput,
  type DealerStaffRole,
  type StaffMemberInput,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthUser } from '../../../common/auth/auth-user';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { fromDbDate, todayIso } from '../core/dates';
import { DEFAULT_CHART, typeOf } from '../accounts/chart-of-accounts';
import { PostingService } from '../journal/posting.service';
import { ensureFiscalYear } from '../periods/fiscal-periods';
import { createBankAccount } from '../banking/bank-accounts';

@Injectable()
export class AccountingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  /** What the portal needs to decide what to show: set up yet, and what may I do. */
  async status(ctx: AccountingContext) {
    const [dealer, settings] = await Promise.all([
      this.prisma.dealer.findUniqueOrThrow({
        where: { id: ctx.dealerId },
        select: { id: true, name: true, province: true, businessNumber: true },
      }),
      this.prisma.accountingSettings.findUnique({ where: { dealerId: ctx.dealerId } }),
    ]);
    return {
      setUp: Boolean(settings),
      dealer,
      role: ctx.role,
      permissions: ACCOUNTING_PERMISSIONS.filter((permission) => ctx.permissions.has(permission)),
      settings: settings ? this.toSettings(settings) : null,
    };
  }

  /**
   * One-time setup: settings, the default chart of accounts, the current
   * fiscal year, a cash account and (optionally) a chequing account with its
   * opening balance — all in one transaction.
   */
  async setup(ctx: AccountingContext, input: AccountingSetupInput) {
    const existing = await this.prisma.accountingSettings.findUnique({
      where: { dealerId: ctx.dealerId },
    });
    if (existing) throw new ConflictException('Accounting is already set up for this dealership');

    await this.prisma.$transaction(
      async (tx) => {
        await tx.accountingSettings.create({
          data: {
            dealerId: ctx.dealerId,
            legalName: input.legalName,
            businessNumber: input.businessNumber,
            gstHstNumber: input.gstHstNumber,
            pstNumber: input.pstNumber,
            qstNumber: input.qstNumber,
            province: input.province,
            fiscalYearStartMonth: input.fiscalYearStartMonth,
            fiscalYearStartDay: input.fiscalYearStartDay,
            taxFilingFrequency: input.taxFilingFrequency,
          },
        });
        await tx.acctAccount.createMany({
          data: DEFAULT_CHART.map((account) => ({
            dealerId: ctx.dealerId,
            code: account.code,
            name: account.name,
            type: typeOf(account.subtype),
            subtype: account.subtype,
            systemKey: account.systemKey ?? null,
            isSystem: Boolean(account.systemKey),
            description: account.description ?? null,
          })),
        });

        const today = todayIso();
        const year = await ensureFiscalYear(tx, ctx.dealerId, today, {
          startMonth: input.fiscalYearStartMonth,
          startDay: input.fiscalYearStartDay,
        });

        const cashGl = await tx.acctAccount.findFirstOrThrow({
          where: { dealerId: ctx.dealerId, systemKey: 'CASH' },
          select: { id: true },
        });
        const cash = await createBankAccount(tx, ctx, this.posting, {
          name: 'Cash on hand',
          bankName: null,
          type: 'CASH',
          accountNumberLast4: null,
          openingBalance: 0,
          openingDate: year.startDate,
          useGlAccountId: cashGl.id,
        });

        let defaultBank = cash.id;
        if (input.openingBank) {
          const chequing = await createBankAccount(tx, ctx, this.posting, {
            name: input.openingBank.name,
            bankName: input.openingBank.bankName,
            type: 'CHEQUING',
            accountNumberLast4: input.openingBank.accountNumberLast4,
            openingBalance: input.openingBank.openingBalance,
            openingDate: today,
          });
          defaultBank = chequing.id;
        }
        await tx.accountingSettings.update({
          where: { dealerId: ctx.dealerId },
          data: { defaultBankAccountId: defaultBank },
        });

        await recordAudit(tx, ctx, {
          action: 'accounting.setup',
          entityType: 'AccountingSettings',
          entityId: ctx.dealerId,
          after: {
            ...input,
            openingBank: input.openingBank ? { name: input.openingBank.name } : null,
          },
        });
      },
      { timeout: 30_000 },
    );
    return this.status(ctx);
  }

  async settings(ctx: AccountingContext) {
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { dealerId: ctx.dealerId },
    });
    return this.toSettings(settings);
  }

  async updateSettings(ctx: AccountingContext, input: AccountingSettingsInput) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.accountingSettings.findUniqueOrThrow({
        where: { dealerId: ctx.dealerId },
      });
      const calendarChanged =
        (input.fiscalYearStartMonth !== undefined &&
          input.fiscalYearStartMonth !== current.fiscalYearStartMonth) ||
        (input.fiscalYearStartDay !== undefined &&
          input.fiscalYearStartDay !== current.fiscalYearStartDay);
      if (calendarChanged) {
        const posted = await tx.journalEntry.count({
          where: { dealerId: ctx.dealerId, status: 'POSTED' },
        });
        if (posted > 0) {
          throw new ConflictException(
            'The fiscal year cannot change once entries are posted; your accountant can close the year and start the new calendar',
          );
        }
        await tx.accountingPeriod.deleteMany({ where: { dealerId: ctx.dealerId } });
        await tx.fiscalYear.deleteMany({ where: { dealerId: ctx.dealerId } });
      }
      if (input.defaultBankAccountId) {
        const bank = await tx.bankAccount.findFirst({
          where: { id: input.defaultBankAccountId, dealerId: ctx.dealerId },
        });
        if (!bank) throw new BadRequestException('Bank account not found');
      }
      if (
        input.nextJournalNumber !== undefined &&
        input.nextJournalNumber < current.nextJournalNumber
      ) {
        throw new BadRequestException('Journal numbers can only move forward');
      }
      if (
        input.nextInvoiceNumber !== undefined &&
        input.nextInvoiceNumber < current.nextInvoiceNumber
      ) {
        throw new BadRequestException('Invoice numbers can only move forward');
      }
      const updated = await tx.accountingSettings.update({
        where: { dealerId: ctx.dealerId },
        data: input,
      });
      await recordAudit(tx, ctx, {
        action: 'accounting.settings_updated',
        entityType: 'AccountingSettings',
        entityId: ctx.dealerId,
        before: this.toSettings(current),
        after: this.toSettings(updated),
      });
      return this.toSettings(updated);
    });
  }

  // --- Team ----------------------------------------------------------------

  async team(ctx: AccountingContext) {
    const dealer = await this.prisma.dealer.findUniqueOrThrow({
      where: { id: ctx.dealerId },
      select: { owner: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    const members = await this.prisma.dealerMember.findMany({
      where: { dealerId: ctx.dealerId },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return [
      {
        id: null,
        userId: dealer.owner.id,
        name: `${dealer.owner.firstName} ${dealer.owner.lastName}`,
        email: dealer.owner.email,
        role: 'OWNER' as DealerStaffRole,
        permissions: [...STAFF_ROLE_PERMISSIONS.OWNER],
      },
      ...members.map((member) => ({
        id: member.id,
        userId: member.userId,
        name: `${member.user.firstName} ${member.user.lastName}`,
        email: member.user.email,
        role: member.role,
        permissions: [...STAFF_ROLE_PERMISSIONS[member.role]],
      })),
    ];
  }

  /** Adds an existing Vintrax account to the dealership's staff. */
  async addMember(ctx: AccountingContext, input: StaffMemberInput) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true, status: true },
      });
      if (!user) {
        throw new NotFoundException(
          'No Vintrax account uses that email. Ask them to sign up first.',
        );
      }
      if (user.id === ctx.ownerUserId) throw new ConflictException('That is the dealership owner');
      if (user.status !== 'ACTIVE' && user.status !== 'PENDING') {
        throw new BadRequestException('That account is not active');
      }
      const exists = await tx.dealerMember.findUnique({
        where: { dealerId_userId: { dealerId: ctx.dealerId, userId: user.id } },
      });
      if (exists) throw new ConflictException('That person is already on the team');
      const member = await tx.dealerMember.create({
        data: { dealerId: ctx.dealerId, userId: user.id, role: input.role, addedById: ctx.userId },
      });
      await recordAudit(tx, ctx, {
        action: 'team.member_added',
        entityType: 'DealerMember',
        entityId: member.id,
        after: { userId: user.id, role: input.role },
      });
      return { id: member.id };
    });
  }

  async changeMemberRole(ctx: AccountingContext, memberId: string, role: DealerStaffRole) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.dealerMember.findFirst({
        where: { id: memberId, dealerId: ctx.dealerId },
      });
      if (!member) throw new NotFoundException('Team member not found');
      if (member.userId === ctx.userId)
        throw new ForbiddenException('You cannot change your own role');
      await tx.dealerMember.update({ where: { id: member.id }, data: { role } });
      await recordAudit(tx, ctx, {
        action: 'team.member_role_changed',
        entityType: 'DealerMember',
        entityId: member.id,
        before: { role: member.role },
        after: { role },
      });
      return { id: member.id, role };
    });
  }

  async removeMember(ctx: AccountingContext, memberId: string) {
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.dealerMember.findFirst({
        where: { id: memberId, dealerId: ctx.dealerId },
      });
      if (!member) throw new NotFoundException('Team member not found');
      await tx.dealerMember.delete({ where: { id: member.id } });
      await recordAudit(tx, ctx, {
        action: 'team.member_removed',
        entityType: 'DealerMember',
        entityId: member.id,
        before: { userId: member.userId, role: member.role },
      });
    });
  }

  /** The dealerships a signed-in person can open the books of. */
  async myDealerships(user: AuthUser) {
    const owned = await this.prisma.dealer.findUnique({
      where: { ownerId: user.id },
      select: { id: true, name: true },
    });
    const staff = await this.prisma.dealerMember.findMany({
      where: { userId: user.id },
      select: { role: true, dealer: { select: { id: true, name: true } } },
    });
    return [
      ...(owned
        ? [{ dealerId: owned.id, name: owned.name, role: 'OWNER' as DealerStaffRole }]
        : []),
      ...staff
        .filter((row) => row.dealer.id !== owned?.id)
        .map((row) => ({ dealerId: row.dealer.id, name: row.dealer.name, role: row.role })),
    ];
  }

  private toSettings(settings: {
    legalName: string;
    businessNumber: string | null;
    gstHstNumber: string | null;
    pstNumber: string | null;
    qstNumber: string | null;
    province: string;
    fiscalYearStartMonth: number;
    fiscalYearStartDay: number;
    currency: string;
    taxFilingFrequency: string;
    defaultBankAccountId: string | null;
    invoicePrefix: string;
    nextInvoiceNumber: number;
    journalPrefix: string;
    nextJournalNumber: number;
    allowNegativeInventory: boolean;
    createdAt: Date;
  }) {
    return {
      legalName: settings.legalName,
      businessNumber: settings.businessNumber,
      gstHstNumber: settings.gstHstNumber,
      pstNumber: settings.pstNumber,
      qstNumber: settings.qstNumber,
      province: settings.province,
      fiscalYearStartMonth: settings.fiscalYearStartMonth,
      fiscalYearStartDay: settings.fiscalYearStartDay,
      currency: settings.currency,
      taxFilingFrequency: settings.taxFilingFrequency,
      defaultBankAccountId: settings.defaultBankAccountId,
      invoicePrefix: settings.invoicePrefix,
      nextInvoiceNumber: settings.nextInvoiceNumber,
      journalPrefix: settings.journalPrefix,
      nextJournalNumber: settings.nextJournalNumber,
      allowNegativeInventory: settings.allowNegativeInventory,
      setUpOn: fromDbDate(settings.createdAt),
    };
  }
}
