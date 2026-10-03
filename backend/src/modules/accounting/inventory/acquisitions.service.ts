import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, VehicleCostCategory } from '@prisma/client';
import type { AcquisitionInput, ReportQuery } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { addDays, fromDbDate, toDbDate, todayIso } from '../core/dates';
import {
  assertNotAlreadyInStock,
  dealerProvince,
  lockDealerVehicle,
  nextNumber,
  requireVendor,
} from '../core/documents';
import { fromCents, sumCents, toCents } from '../core/money';
import { bankGlAccount } from '../banking/bank-accounts';
import { PostingService, type LedgerLine } from '../journal/posting.service';
import { TaxService, recoverableAccountKey } from '../tax/tax.service';
import { resolveRange } from '../reports/date-ranges';

type Tx = Prisma.TransactionClient;

/** The cost components of a purchase, and the cost category each one is. */
const COMPONENTS: Array<{
  field: 'purchasePrice' | 'auctionFee' | 'transportation' | 'inspection' | 'reconditioning' | 'otherCosts';
  category: VehicleCostCategory;
  label: string;
}> = [
  { field: 'purchasePrice', category: 'PURCHASE', label: 'Purchase price' },
  { field: 'auctionFee', category: 'AUCTION_FEE', label: 'Auction fee' },
  { field: 'transportation', category: 'TRANSPORTATION', label: 'Transportation' },
  { field: 'inspection', category: 'INSPECTION', label: 'Inspection' },
  { field: 'reconditioning', category: 'MECHANICAL_REPAIR', label: 'Reconditioning' },
  { field: 'otherCosts', category: 'OTHER', label: 'Other direct costs' },
];

/**
 * Buying a vehicle into inventory.
 *
 * One transaction: every cost component is debited to Vehicle Inventory
 * against the vehicle (so its book value is derived from the ledger, never a
 * typed-in total), recoverable GST/HST/QST to its own account, and the credit
 * goes to the bank, to Accounts Payable (with a vendor bill) or to Floor Plan
 * Financing (with a note). The costs also appear on the existing Costs page.
 */
@Injectable()
export class AcquisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly tax: TaxService,
  ) {}

  async list(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query);
    const rows = await this.prisma.vehicleAcquisition.findMany({
      where: {
        dealerId: ctx.dealerId,
        date: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      },
      orderBy: { date: 'desc' },
      include: {
        vehicle: { select: { id: true, vin: true, year: true, make: true, model: true, stockNumber: true } },
        vendor: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
      take: 500,
    });
    return {
      range,
      items: rows.map((row) => ({
        id: row.id,
        date: fromDbDate(row.date),
        method: row.method,
        vehicle: row.vehicle,
        vendor: row.vendor,
        customer: row.customer,
        purchasePriceCents: toCents(row.purchasePrice),
        additionalCostsCents:
          toCents(row.auctionFee) + toCents(row.transportation) + toCents(row.inspection) + toCents(row.reconditioning) + toCents(row.otherCosts),
        taxCents: toCents(row.taxTotal),
        totalCents: toCents(row.total),
        settlement: row.settlement,
        status: row.status,
        journalEntryId: row.journalEntryId,
        reference: row.reference,
      })),
    };
  }

  async create(ctx: AccountingContext, input: AcquisitionInput) {
    return this.prisma.$transaction(
      async (tx) => {
        const vehicle = await lockDealerVehicle(tx, ctx, input.vehicleId);
        await assertNotAlreadyInStock(tx, ctx, vehicle.id);
        const vendor = input.vendorId ? await requireVendor(tx, ctx, input.vendorId) : null;
        const { province } = await dealerProvince(tx, ctx.dealerId);

        const components = COMPONENTS.map((component) => ({ ...component, cents: input[component.field] })).filter(
          (component) => component.cents > 0,
        );
        const costCents = sumCents(components.map((component) => component.cents));

        // GST/HST/QST a registered vendor charged is recoverable. A dealer buys
        // for resale, so provincial sales tax is not charged on the vehicle.
        const tax = input.vendorChargedTax
          ? await this.tax.calculate(tx, ctx.dealerId, {
              province,
              date: input.date,
              lines: components.map((component) => ({
                category: component.field === 'purchasePrice' ? 'VEHICLE' : 'GENERAL',
                amountCents: component.cents,
              })),
            })
          : null;
        const taxComponents = (tax?.components ?? []).filter((component) => component.recoverable);
        const taxCents = sumCents(taxComponents.map((component) => component.taxCents));
        const totalCents = costCents + taxCents;

        const accounts = await this.posting.accounts(tx, ctx.dealerId, ['VEHICLE_INVENTORY', 'AP', 'FLOOR_PLAN']);
        const lines: LedgerLine[] = components.map((component) => ({
          accountId: accounts.VEHICLE_INVENTORY,
          debit: component.cents,
          credit: 0,
          description: component.label,
          vehicleId: vehicle.id,
          vendorId: vendor?.id ?? null,
          costCategory: component.category,
        }));
        for (const component of taxComponents) {
          const { [recoverableAccountKey(component.taxType)]: account } = await this.posting.accounts(tx, ctx.dealerId, [
            recoverableAccountKey(component.taxType),
          ]);
          lines.push({
            accountId: account,
            debit: component.taxCents,
            credit: 0,
            description: `${component.taxType} paid (recoverable)`,
            taxType: component.taxType,
            vehicleId: vehicle.id,
          });
        }

        let bankAccountId: string | null = null;
        let floorPrincipal = 0;
        if (input.settlement === 'PAID') {
          const bank = await bankGlAccount(tx, ctx, input.bankAccountId!);
          bankAccountId = bank.id;
          lines.push({ accountId: bank.glAccountId, debit: 0, credit: totalCents, description: 'Paid', vendorId: vendor?.id ?? null });
        } else if (input.settlement === 'ON_ACCOUNT') {
          lines.push({ accountId: accounts.AP, debit: 0, credit: totalCents, description: 'On account', vendorId: vendor!.id });
        } else {
          const terms = input.floorPlan!;
          const lender = await requireVendor(tx, ctx, terms.lenderVendorId);
          floorPrincipal = terms.principal > 0 ? terms.principal : totalCents;
          if (floorPrincipal > totalCents) {
            throw new BadRequestException('The floor plan advance is more than the purchase');
          }
          lines.push({
            accountId: accounts.FLOOR_PLAN,
            debit: 0,
            credit: floorPrincipal,
            description: `Floor plan — ${lender.name}`,
            vendorId: lender.id,
            vehicleId: vehicle.id,
          });
          if (floorPrincipal < totalCents) {
            if (!input.bankAccountId) {
              throw new BadRequestException('Choose the account the rest was paid from');
            }
            const bank = await bankGlAccount(tx, ctx, input.bankAccountId);
            bankAccountId = bank.id;
            lines.push({ accountId: bank.glAccountId, debit: 0, credit: totalCents - floorPrincipal, description: 'Paid' });
          }
        }

        const acquisition = await tx.vehicleAcquisition.create({
          data: {
            dealerId: ctx.dealerId,
            vehicleId: vehicle.id,
            method: input.method,
            vendorId: vendor?.id ?? null,
            date: toDbDate(input.date),
            purchasePrice: fromCents(input.purchasePrice),
            auctionFee: fromCents(input.auctionFee),
            transportation: fromCents(input.transportation),
            inspection: fromCents(input.inspection),
            reconditioning: fromCents(input.reconditioning),
            otherCosts: fromCents(input.otherCosts),
            taxTotal: fromCents(taxCents),
            total: fromCents(totalCents),
            settlement: input.settlement,
            paymentMethod: input.paymentMethod ?? null,
            bankAccountId,
            reference: input.reference,
            notes: input.notes,
            createdById: ctx.userId,
          },
        });

        const entry = await this.posting.post(tx, ctx, {
          date: input.date,
          description: `Purchase — ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.vin ? ` (${vehicle.vin})` : ''}`,
          memo: input.notes,
          source: 'VEHICLE_ACQUISITION',
          sourceType: 'VehicleAcquisition',
          sourceId: acquisition.id,
          lines,
        });

        let billId: string | null = null;
        if (input.settlement === 'ON_ACCOUNT') {
          const bill = await tx.vendorBill.create({
            data: {
              dealerId: ctx.dealerId,
              number: await nextNumber(tx, ctx.dealerId, 'nextBillNumber'),
              vendorId: vendor!.id,
              vendorReference: input.reference,
              date: toDbDate(input.date),
              dueDate: toDbDate(input.dueDate ?? addDays(input.date, vendor!.paymentTermsDays)),
              lines: components.map((component) => ({
                description: `${component.label} — ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                amountCents: component.cents,
                vehicleId: vehicle.id,
              })),
              subtotal: fromCents(costCents),
              taxTotal: fromCents(taxCents),
              total: fromCents(totalCents),
              journalEntryId: entry.id,
              createdById: ctx.userId,
            },
          });
          billId = bill.id;
        }

        let floorPlanNoteId: string | null = null;
        if (input.settlement === 'FLOOR_PLAN') {
          const terms = input.floorPlan!;
          const note = await tx.floorPlanNote.create({
            data: {
              dealerId: ctx.dealerId,
              lenderVendorId: terms.lenderVendorId,
              vehicleId: vehicle.id,
              principal: fromCents(floorPrincipal),
              interestRate: terms.interestRate,
              originationDate: toDbDate(input.date),
              maturityDate: terms.maturityDate ? toDbDate(terms.maturityDate) : null,
              journalEntryId: entry.id,
              reference: terms.reference,
            },
          });
          floorPlanNoteId = note.id;
        }

        await tx.vehicleAcquisition.update({
          where: { id: acquisition.id },
          data: { journalEntryId: entry.id, billId, floorPlanNoteId },
        });

        // The existing Costs page reads VehicleCost; keep it in step.
        await tx.vehicleCost.createMany({
          data: components.map((component) => ({
            vehicleId: vehicle.id,
            category: component.category,
            description: component.label,
            amountCents: component.cents,
            incurredOn: toDbDate(input.date),
            vendor: vendor?.name ?? null,
            reference: input.reference,
            recordedById: ctx.userId,
            journalEntryId: entry.id,
          })),
        });

        if (tax && taxComponents.length > 0) {
          await this.tax.recordTaxLines(tx, ctx, {
            calculation: { ...tax, components: taxComponents },
            province,
            date: input.date,
            direction: 'PAID',
            sourceType: 'VehicleAcquisition',
            sourceId: acquisition.id,
            journalEntryId: entry.id,
          });
        }

        await recordAudit(tx, ctx, {
          action: 'vehicle.acquired',
          entityType: 'VehicleAcquisition',
          entityId: acquisition.id,
          after: {
            vehicleId: vehicle.id,
            method: input.method,
            costCents,
            taxCents,
            settlement: input.settlement,
            journal: entry.reference,
          },
        });
        return { id: acquisition.id, journalEntryId: entry.id, reference: entry.reference, totalCents, billId, floorPlanNoteId };
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Voids a purchase entered in error: reverses its entry and tax lines and
   * removes its costs from the Costs page. Refused once money has moved on
   * its bill or floor plan, or once the vehicle has been sold.
   */
  async void(ctx: AccountingContext, acquisitionId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const acquisition = await tx.vehicleAcquisition.findFirst({
        where: { id: acquisitionId, dealerId: ctx.dealerId },
      });
      if (!acquisition) throw new NotFoundException('Purchase not found');
      if (acquisition.status !== 'POSTED') throw new ConflictException('This purchase is already void');
      if (acquisition.method === 'TRADE_IN') {
        throw new ConflictException('A trade-in is undone by reversing the sale it came with');
      }
      await lockDealerVehicle(tx, ctx, acquisition.vehicleId);
      const sold = await tx.vehicleSale.findFirst({
        where: { dealerId: ctx.dealerId, vehicleId: acquisition.vehicleId, status: 'POSTED', saleDate: { gte: acquisition.date } },
      });
      if (sold) throw new ConflictException('The vehicle has been sold; reverse the sale first');
      if (acquisition.billId) {
        const bill = await tx.vendorBill.findUniqueOrThrow({ where: { id: acquisition.billId } });
        if (toCents(bill.amountPaid) > 0) throw new ConflictException('The bill has payments; reverse them first');
        await tx.vendorBill.update({ where: { id: bill.id }, data: { status: 'VOID' } });
      }
      if (acquisition.floorPlanNoteId) {
        const note = await tx.floorPlanNote.findUniqueOrThrow({ where: { id: acquisition.floorPlanNoteId } });
        if (toCents(note.principalPaid) > 0 || toCents(note.interestPaid) > 0) {
          throw new ConflictException('The floor plan has payments; reverse them first');
        }
        await tx.floorPlanNote.update({ where: { id: note.id }, data: { status: 'PAID_OFF' } });
      }
      const reversal = await this.posting.reverse(tx, ctx, acquisition.journalEntryId!, { reason });
      await this.tax.reverseTaxLines(tx, ctx, {
        sourceType: 'VehicleAcquisition',
        sourceId: acquisition.id,
        date: todayIso(),
        journalEntryId: reversal.id,
      });
      await tx.vehicleCost.deleteMany({ where: { journalEntryId: acquisition.journalEntryId! } });
      await tx.vehicleAcquisition.update({ where: { id: acquisition.id }, data: { status: 'VOID' } });
      await recordAudit(tx, ctx, {
        action: 'vehicle.acquisition_voided',
        entityType: 'VehicleAcquisition',
        entityId: acquisition.id,
        before: { status: 'POSTED' },
        after: { status: 'VOID', reversal: reversal.reference },
        reason,
      });
      return { id: acquisition.id, reversalEntryId: reversal.id };
    });
  }
}

export type { Tx as AcquisitionTx };
