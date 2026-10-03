import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { centsToDecimalString, type FloorPlanNoteInput, type FloorPlanPaymentInput } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { daysBetween, fromDbDate, toDbDate, todayIso } from '../core/dates';
import { lockDealerVehicle, requireVendor } from '../core/documents';
import { fromCents, sumCents, toCents } from '../core/money';
import { bankGlAccount } from '../banking/bank-accounts';
import { PostingService, type LedgerLine } from '../journal/posting.service';

/**
 * Floor plan financing: a lender pays for a vehicle and the dealer owes it
 * until the car sells. The liability is Floor Plan Financing, tagged with
 * the vehicle; principal payments reduce it, interest is an expense.
 */
@Injectable()
export class FloorPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  async notes(ctx: AccountingContext, query: { status?: string; lenderId?: string; vehicleId?: string }) {
    const rows = await this.prisma.floorPlanNote.findMany({
      where: {
        dealerId: ctx.dealerId,
        ...(query.status === 'ACTIVE' || query.status === 'PAID_OFF' ? { status: query.status } : {}),
        ...(query.lenderId ? { lenderVendorId: query.lenderId } : {}),
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      },
      orderBy: [{ status: 'asc' }, { originationDate: 'asc' }],
      include: {
        lender: { select: { id: true, name: true } },
        vehicle: { select: { id: true, vin: true, year: true, make: true, model: true, status: true } },
        transactions: { orderBy: { date: 'asc' } },
      },
    });
    const today = todayIso();
    return rows.map((row) => {
      const outstanding = toCents(row.principal) - toCents(row.principalPaid);
      return {
        id: row.id,
        lender: row.lender,
        vehicle: row.vehicle,
        principalCents: toCents(row.principal),
        principalPaidCents: toCents(row.principalPaid),
        interestPaidCents: toCents(row.interestPaid),
        outstandingCents: outstanding,
        interestRate: row.interestRate.toString(),
        originationDate: fromDbDate(row.originationDate),
        maturityDate: row.maturityDate ? fromDbDate(row.maturityDate) : null,
        daysOutstanding: daysBetween(fromDbDate(row.originationDate), today),
        status: row.status,
        reference: row.reference,
        // Sold but not paid off: the lender's collateral is gone.
        soldOutOfTrust: row.status === 'ACTIVE' && row.vehicle.status === 'SOLD',
        transactions: row.transactions.map((transaction) => ({
          id: transaction.id,
          kind: transaction.kind,
          date: fromDbDate(transaction.date),
          principalCents: toCents(transaction.principal),
          interestCents: toCents(transaction.interest),
          journalEntryId: transaction.journalEntryId,
        })),
      };
    });
  }

  /** Floor-plans a vehicle already in stock: the lender's advance lands in the bank. */
  async createNote(ctx: AccountingContext, input: FloorPlanNoteInput) {
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await lockDealerVehicle(tx, ctx, input.vehicleId);
      const lender = await requireVendor(tx, ctx, input.lenderVendorId);
      const active = await tx.floorPlanNote.findFirst({
        where: { dealerId: ctx.dealerId, vehicleId: vehicle.id, status: 'ACTIVE' },
      });
      if (active) throw new ConflictException('This vehicle is already floor-planned');
      const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
      const { FLOOR_PLAN: floorPlan } = await this.posting.accounts(tx, ctx.dealerId, ['FLOOR_PLAN']);
      const note = await tx.floorPlanNote.create({
        data: {
          dealerId: ctx.dealerId,
          lenderVendorId: lender.id,
          vehicleId: vehicle.id,
          principal: fromCents(input.principal),
          interestRate: input.interestRate,
          originationDate: toDbDate(input.originationDate),
          maturityDate: input.maturityDate ? toDbDate(input.maturityDate) : null,
          reference: input.reference,
        },
      });
      const entry = await this.posting.post(tx, ctx, {
        date: input.originationDate,
        description: `Floor plan advance — ${lender.name} — ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        source: 'FLOOR_PLAN',
        sourceType: 'FloorPlanNote',
        sourceId: note.id,
        lines: [
          { accountId: bank.glAccountId, debit: input.principal, credit: 0, vendorId: lender.id, vehicleId: vehicle.id },
          { accountId: floorPlan, debit: 0, credit: input.principal, vendorId: lender.id, vehicleId: vehicle.id },
        ],
      });
      await tx.floorPlanNote.update({ where: { id: note.id }, data: { journalEntryId: entry.id } });
      await recordAudit(tx, ctx, {
        action: 'floor_plan.advanced',
        entityType: 'FloorPlanNote',
        entityId: note.id,
        after: { lenderId: lender.id, vehicleId: vehicle.id, principalCents: input.principal, journal: entry.reference },
      });
      return { id: note.id, journalEntryId: entry.id };
    });
  }

  /** A principal payment, an interest payment, or the payoff of what is left. */
  async pay(ctx: AccountingContext, noteId: string, input: FloorPlanPaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FloorPlanNote" WHERE "id" = ${noteId}::uuid FOR UPDATE`;
      const note = await tx.floorPlanNote.findFirst({
        where: { id: noteId, dealerId: ctx.dealerId },
        include: { lender: true, vehicle: { select: { year: true, make: true, model: true } } },
      });
      if (!note) throw new NotFoundException('Floor plan not found');
      if (note.status !== 'ACTIVE') throw new ConflictException('This floor plan is paid off');
      if (input.date < fromDbDate(note.originationDate)) {
        throw new BadRequestException('A payment cannot predate the advance');
      }
      const outstanding = toCents(note.principal) - toCents(note.principalPaid);
      const principal = input.kind === 'PAYOFF' ? outstanding : input.kind === 'INTEREST_PAYMENT' ? 0 : input.principal;
      const interest = input.interest;
      if (principal > outstanding) {
        throw new BadRequestException(`Only ${centsToDecimalString(outstanding)} is outstanding`);
      }
      if (principal + interest === 0) throw new BadRequestException('Nothing to pay');

      const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
      const { FLOOR_PLAN: floorPlan, INTEREST_EXPENSE: interestExpense } = await this.posting.accounts(tx, ctx.dealerId, [
        'FLOOR_PLAN',
        'INTEREST_EXPENSE',
      ]);
      const lines: LedgerLine[] = [
        { accountId: floorPlan, debit: principal, credit: 0, description: 'Floor plan principal', vendorId: note.lenderVendorId, vehicleId: note.vehicleId },
        { accountId: interestExpense, debit: interest, credit: 0, description: 'Floor plan interest', vendorId: note.lenderVendorId, vehicleId: note.vehicleId },
        { accountId: bank.glAccountId, debit: 0, credit: principal + interest, vendorId: note.lenderVendorId },
      ];
      const transaction = await tx.floorPlanTransaction.create({
        data: {
          noteId: note.id,
          kind: input.kind,
          date: toDbDate(input.date),
          principal: fromCents(principal),
          interest: fromCents(interest),
          bankAccountId: bank.id,
        },
      });
      const entry = await this.posting.post(tx, ctx, {
        date: input.date,
        description: `Floor plan ${input.kind === 'PAYOFF' ? 'payoff' : 'payment'} — ${note.lender.name} — ${note.vehicle.year} ${note.vehicle.make} ${note.vehicle.model}`,
        source: 'FLOOR_PLAN',
        sourceType: 'FloorPlanNote',
        sourceId: note.id,
        lines,
      });
      await tx.floorPlanTransaction.update({ where: { id: transaction.id }, data: { journalEntryId: entry.id } });
      const principalPaid = toCents(note.principalPaid) + principal;
      await tx.floorPlanNote.update({
        where: { id: note.id },
        data: {
          principalPaid: fromCents(principalPaid),
          interestPaid: fromCents(toCents(note.interestPaid) + interest),
          status: principalPaid >= toCents(note.principal) ? 'PAID_OFF' : 'ACTIVE',
        },
      });
      await recordAudit(tx, ctx, {
        action: 'floor_plan.payment',
        entityType: 'FloorPlanNote',
        entityId: note.id,
        after: { kind: input.kind, principalCents: principal, interestCents: interest, journal: entry.reference },
      });
      return { id: transaction.id, journalEntryId: entry.id };
    });
  }

  /** Outstanding by lender, and each lender's statement of advances and payments. */
  async summary(ctx: AccountingContext) {
    const notes = await this.notes(ctx, {});
    const lenders = new Map<string, { lender: { id: string; name: string }; outstandingCents: number; interestPaidCents: number; vehicles: number }>();
    for (const note of notes) {
      const row = lenders.get(note.lender.id) ?? { lender: note.lender, outstandingCents: 0, interestPaidCents: 0, vehicles: 0 };
      row.outstandingCents += note.status === 'ACTIVE' ? note.outstandingCents : 0;
      row.interestPaidCents += note.interestPaidCents;
      row.vehicles += note.status === 'ACTIVE' ? 1 : 0;
      lenders.set(note.lender.id, row);
    }
    return {
      totalOutstandingCents: sumCents(notes.filter((note) => note.status === 'ACTIVE').map((note) => note.outstandingCents)),
      totalInterestPaidCents: sumCents(notes.map((note) => note.interestPaidCents)),
      soldOutOfTrust: notes.filter((note) => note.soldOutOfTrust).length,
      byLender: [...lenders.values()],
      notes,
    };
  }
}
