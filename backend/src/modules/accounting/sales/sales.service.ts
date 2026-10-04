import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Province } from '@prisma/client';
import {
  centsToDecimalString,
  saleInputToForm,
  saleSchema,
  type ReportQuery,
  type SaleInput,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { addDays, fromDbDate, toDbDate, todayIso } from '../core/dates';
import {
  dealerProvince,
  lockDealerVehicle,
  nextInvoiceNumber,
  nextNumber,
  requireCustomer,
  requireVendor,
} from '../core/documents';
import { fromCents, toCents } from '../core/money';
import { bankGlAccount } from '../banking/bank-accounts';
import { PostingService, type LedgerLine } from '../journal/posting.service';
import { TaxService, payableAccountKey } from '../tax/tax.service';
import type { TaxCalculation } from '../tax/tax-engine';
import { accountTotals, debitBalance } from '../reports/ledger';
import { resolveRange } from '../reports/date-ranges';
import { depositStatus } from './deposits.service';

type Tx = Prisma.TransactionClient;

/** Everything a sale works out before it posts — shown to the user as the deal recap. */
export interface SaleComputation {
  province: Province;
  vehicleNetCents: number;
  feesCents: number;
  subtotalCents: number;
  tax: TaxCalculation;
  taxTotalCents: number;
  totalCents: number;
  tradeAllowanceCents: number;
  tradeAcquisitionCostCents: number;
  overAllowanceCents: number;
  lienPayoffCents: number;
  depositsCents: number;
  downPaymentCents: number;
  financedCents: number;
  balanceDueCents: number;
  costOfSaleCents: number;
  grossProfitCents: number;
  grossMarginBasisPoints: number | null;
  warnings: string[];
}

/**
 * Vehicle sales: the deal desk's quote, draft, post and reverse.
 *
 * Posting is one database transaction — validate, calculate tax, read the
 * vehicle's book value from the ledger, relieve inventory to cost of sales,
 * bring in the trade-in as inventory, apply deposits, raise the receivables,
 * mark the vehicle sold, write the audit record — and either all of it
 * happens or none of it does.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly tax: TaxService,
  ) {}

  /**
   * The dealership's vehicles for the deal desk and purchase forms: what is in
   * stock (not sold or archived) by default, or a search over all of them.
   * Staff who are not the owner reach the inventory only through this.
   */
  async vehicleOptions(ctx: AccountingContext, q?: string, includeSold = false) {
    const term = q?.trim();
    const rows = await this.prisma.vehicle.findMany({
      where: {
        sellerId: ctx.ownerUserId,
        ...(includeSold ? {} : { status: { notIn: ['SOLD', 'ARCHIVED'] } }),
        ...(term
          ? {
              OR: [
                { vin: { contains: term, mode: 'insensitive' } },
                { stockNumber: { contains: term, mode: 'insensitive' } },
                { make: { contains: term, mode: 'insensitive' } },
                { model: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        vin: true,
        stockNumber: true,
        year: true,
        make: true,
        model: true,
        trim: true,
        status: true,
        priceCad: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      vin: row.vin,
      stockNumber: row.stockNumber,
      label: `${row.year} ${row.make} ${row.model}${row.trim ? ` ${row.trim}` : ''}`,
      status: row.status,
      askingPriceCents: row.priceCad * 100,
    }));
  }

  async list(ctx: AccountingContext, query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'THIS_MONTH');
    const where: Prisma.VehicleSaleWhereInput = {
      dealerId: ctx.dealerId,
      saleDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.salespersonId ? { salespersonId: query.salespersonId } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    };
    const rows = await this.prisma.vehicleSale.findMany({
      where,
      orderBy: [{ saleDate: 'desc' }, { number: 'desc' }],
      include: {
        vehicle: {
          select: { id: true, vin: true, year: true, make: true, model: true, stockNumber: true },
        },
        customer: { select: { id: true, name: true } },
        salesperson: { select: { id: true, firstName: true, lastName: true } },
      },
      take: 500,
    });
    return {
      range,
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        saleDate: fromDbDate(row.saleDate),
        status: row.status,
        vehicle: row.vehicle,
        customer: row.customer,
        salesperson: row.salesperson
          ? `${row.salesperson.firstName} ${row.salesperson.lastName}`
          : null,
        salePriceCents: toCents(row.salePrice),
        totalCents: toCents(row.totalAmount),
        taxCents: toCents(row.taxTotal),
        balanceDueCents: toCents(row.balanceDue),
        costOfSaleCents: toCents(row.costOfSale),
        journalEntryId: row.journalEntryId,
      })),
    };
  }

  async detail(ctx: AccountingContext, saleId: string) {
    const sale = await this.prisma.vehicleSale.findFirst({
      where: { id: saleId, dealerId: ctx.dealerId },
      include: {
        vehicle: {
          select: {
            id: true,
            vin: true,
            year: true,
            make: true,
            model: true,
            stockNumber: true,
            condition: true,
          },
        },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        salesperson: { select: { id: true, firstName: true, lastName: true } },
        tradeIn: true,
        financeLender: { select: { id: true, name: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    const taxLines = await this.prisma.taxLine.findMany({
      where: { dealerId: ctx.dealerId, sourceType: 'VehicleSale', sourceId: sale.id },
      orderBy: { createdAt: 'asc' },
    });
    const invoices = await this.prisma.customerInvoice.findMany({
      where: { dealerId: ctx.dealerId, saleId: sale.id },
      select: {
        id: true,
        number: true,
        total: true,
        amountPaid: true,
        status: true,
        customerId: true,
      },
    });
    return {
      id: sale.id,
      number: sale.number,
      status: sale.status,
      saleDate: fromDbDate(sale.saleDate),
      vehicle: sale.vehicle,
      customer: sale.customer,
      salesperson: sale.salesperson,
      financeLender: sale.financeLender,
      taxProvince: sale.taxProvince,
      salePriceCents: toCents(sale.salePrice),
      discountCents: toCents(sale.discount),
      documentationFeeCents: toCents(sale.documentationFee),
      dealerFeesCents: toCents(sale.dealerFees),
      accessoriesCents: toCents(sale.accessories),
      warrantyCents: toCents(sale.warranty),
      otherChargesCents: toCents(sale.otherCharges),
      financeRevenueCents: toCents(sale.financeRevenue),
      depositAppliedCents: toCents(sale.depositApplied),
      downPaymentCents: toCents(sale.downPayment),
      financedAmountCents: toCents(sale.financedAmount),
      taxableAmountCents: toCents(sale.taxableAmount),
      taxTotalCents: toCents(sale.taxTotal),
      totalCents: toCents(sale.totalAmount),
      balanceDueCents: toCents(sale.balanceDue),
      costOfSaleCents: toCents(sale.costOfSale),
      tradeIn: sale.tradeIn
        ? {
            id: sale.tradeIn.id,
            vehicleId: sale.tradeIn.vehicleId,
            description: `${sale.tradeIn.year} ${sale.tradeIn.make} ${sale.tradeIn.model}`,
            appraisedValueCents: toCents(sale.tradeIn.appraisedValue),
            tradeAllowanceCents: toCents(sale.tradeIn.tradeAllowance),
            lienPayoffCents: toCents(sale.tradeIn.lienPayoff),
            netTradeValueCents: toCents(sale.tradeIn.netTradeValue),
          }
        : null,
      taxLines: taxLines.map((line) => ({
        taxType: line.taxType,
        province: line.province,
        rate: line.rate.toString(),
        taxableCents: toCents(line.taxableAmount),
        amountCents: toCents(line.amount),
        isReversal: line.isReversal,
      })),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        totalCents: toCents(invoice.total),
        paidCents: toCents(invoice.amountPaid),
        status: invoice.status,
      })),
      draft: sale.status === 'DRAFT' ? sale.draft : null,
      journalEntryId: sale.journalEntryId,
      reversalEntryId: sale.reversalEntryId,
      notes: sale.notes,
    };
  }

  /** The deal recap without saving anything. */
  async quote(ctx: AccountingContext, input: SaleInput) {
    return this.prisma.$transaction(async (tx) => this.compute(tx, ctx, input), {
      isolationLevel: 'ReadCommitted',
    });
  }

  /** A draft deal — anyone on the deal desk may save one. */
  async saveDraft(ctx: AccountingContext, input: SaleInput, saleId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const computation = await this.compute(tx, ctx, input, { forDraft: true });
      const data = {
        vehicleId: input.vehicleId,
        customerId: input.customerId,
        salespersonId: input.salespersonId,
        saleDate: toDbDate(input.saleDate),
        salePrice: fromCents(input.salePrice),
        discount: fromCents(input.discount),
        documentationFee: fromCents(input.documentationFee),
        dealerFees: fromCents(input.dealerFees),
        accessories: fromCents(input.accessories),
        warranty: fromCents(input.warranty),
        otherCharges: fromCents(input.otherCharges),
        financeRevenue: fromCents(input.financeRevenue),
        financeLenderVendorId: input.financeLenderVendorId,
        depositApplied: fromCents(computation.depositsCents),
        downPayment: fromCents(input.downPayment),
        downPaymentMethod: input.downPaymentMethod ?? null,
        bankAccountId: input.bankAccountId,
        financedAmount: fromCents(input.financedAmount),
        taxProvince: computation.province,
        taxableAmount: fromCents(computation.subtotalCents),
        taxTotal: fromCents(computation.taxTotalCents),
        totalAmount: fromCents(computation.totalCents),
        balanceDue: fromCents(computation.balanceDueCents),
        draft: saleInputToForm(input) as Prisma.InputJsonValue,
        notes: input.notes,
      };
      let id = saleId;
      if (saleId) {
        const existing = await tx.vehicleSale.findFirst({
          where: { id: saleId, dealerId: ctx.dealerId },
        });
        if (!existing) throw new NotFoundException('Sale not found');
        if (existing.status !== 'DRAFT')
          throw new ConflictException('A posted sale cannot be edited; reverse it');
        await tx.vehicleSale.update({ where: { id: saleId }, data });
      } else {
        const created = await tx.vehicleSale.create({
          data: {
            ...data,
            dealerId: ctx.dealerId,
            number: await nextNumber(tx, ctx.dealerId, 'nextSaleNumber'),
            createdById: ctx.userId,
          },
        });
        id = created.id;
      }
      await recordAudit(tx, ctx, {
        action: saleId ? 'sale.draft_updated' : 'sale.draft_created',
        entityType: 'VehicleSale',
        entityId: id!,
        after: { vehicleId: input.vehicleId, totalCents: computation.totalCents },
      });
      return { id: id!, computation };
    });
  }

  async deleteDraft(ctx: AccountingContext, saleId: string) {
    await this.prisma.$transaction(async (tx) => {
      const sale = await tx.vehicleSale.findFirst({
        where: { id: saleId, dealerId: ctx.dealerId },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status !== 'DRAFT')
        throw new ConflictException('A posted sale is reversed, not deleted');
      await tx.vehicleSale.delete({ where: { id: sale.id } });
      await recordAudit(tx, ctx, {
        action: 'sale.draft_deleted',
        entityType: 'VehicleSale',
        entityId: sale.id,
      });
    });
  }

  /** Posts a saved draft. */
  async postDraft(ctx: AccountingContext, saleId: string) {
    const sale = await this.prisma.vehicleSale.findFirst({
      where: { id: saleId, dealerId: ctx.dealerId },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status !== 'DRAFT' || !sale.draft)
      throw new ConflictException('Only a draft sale can be posted');
    const input = saleSchema.parse(sale.draft);
    return this.post(ctx, input, sale.id);
  }

  /** Posts a sale (creating it, or completing the given draft). */
  async post(ctx: AccountingContext, input: SaleInput, draftId?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const vehicle = await lockDealerVehicle(tx, ctx, input.vehicleId);
        const computation = await this.compute(tx, ctx, input);
        const customer = await requireCustomer(tx, ctx, input.customerId);
        const accounts = await this.posting.accounts(tx, ctx.dealerId, [
          'AR',
          'CUSTOMER_DEPOSITS',
          'VEHICLE_INVENTORY',
          'VEHICLE_COGS',
          'NEW_VEHICLE_SALES',
          'USED_VEHICLE_SALES',
          'FEE_REVENUE',
          'ACCESSORIES_SALES',
          'EXTENDED_WARRANTY_REVENUE',
          'OTHER_REVENUE',
          'FINANCE_REVENUE',
          'AP',
        ]);
        const revenueAccount =
          vehicle.condition === 'NEW' ? accounts.NEW_VEHICLE_SALES : accounts.USED_VEHICLE_SALES;
        const label = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

        // The sale record first, so the journal can point at it.
        const number = draftId
          ? (await tx.vehicleSale.findUniqueOrThrow({ where: { id: draftId } })).number
          : await nextNumber(tx, ctx.dealerId, 'nextSaleNumber');
        const tradeIn = input.tradeInId
          ? await tx.tradeIn.findFirstOrThrow({
              where: { id: input.tradeInId, dealerId: ctx.dealerId },
            })
          : null;
        const saleData = {
          vehicleId: vehicle.id,
          customerId: customer.id,
          salespersonId: input.salespersonId,
          saleDate: toDbDate(input.saleDate),
          status: 'POSTED' as const,
          salePrice: fromCents(input.salePrice),
          discount: fromCents(input.discount),
          documentationFee: fromCents(input.documentationFee),
          dealerFees: fromCents(input.dealerFees),
          accessories: fromCents(input.accessories),
          warranty: fromCents(input.warranty),
          otherCharges: fromCents(input.otherCharges),
          financeRevenue: fromCents(input.financeRevenue),
          financeLenderVendorId: input.financeLenderVendorId,
          tradeInId: tradeIn?.id ?? null,
          depositApplied: fromCents(computation.depositsCents),
          downPayment: fromCents(input.downPayment),
          downPaymentMethod: input.downPaymentMethod ?? null,
          bankAccountId: input.bankAccountId,
          financedAmount: fromCents(input.financedAmount),
          taxProvince: computation.province,
          taxableAmount: fromCents(computation.subtotalCents),
          taxTotal: fromCents(computation.taxTotalCents),
          totalAmount: fromCents(computation.totalCents),
          balanceDue: fromCents(computation.balanceDueCents),
          costOfSale: fromCents(computation.costOfSaleCents),
          previousVehicleStatus: vehicle.status,
          draft: undefined,
          notes: input.notes,
          postedAt: new Date(),
        };
        const sale = draftId
          ? await tx.vehicleSale.update({
              where: { id: draftId },
              data: { ...saleData, draft: Prisma.DbNull },
            })
          : await tx.vehicleSale.create({
              data: { ...saleData, dealerId: ctx.dealerId, number, createdById: ctx.userId },
            });

        const lines: LedgerLine[] = [];
        const dims = { vehicleId: vehicle.id, customerId: customer.id };

        // What the customer and lender settle the deal with.
        for (const application of input.deposits) {
          lines.push({
            accountId: accounts.CUSTOMER_DEPOSITS,
            debit: application.amount,
            credit: 0,
            description: 'Deposit applied',
            customerId: customer.id,
            vehicleId: vehicle.id,
          });
        }
        if (input.downPayment > 0) {
          const bank = await bankGlAccount(tx, ctx, input.bankAccountId!);
          lines.push({
            accountId: bank.glAccountId,
            debit: input.downPayment,
            credit: 0,
            description: 'Down payment',
            ...dims,
          });
        }
        if (computation.balanceDueCents > 0) {
          lines.push({
            accountId: accounts.AR,
            debit: computation.balanceDueCents,
            credit: 0,
            description: 'Balance due',
            ...dims,
          });
        }
        let lenderCustomerId: string | null = null;
        const lenderReceivable = input.financedAmount + input.financeRevenue;
        if (lenderReceivable > 0) {
          lenderCustomerId = await this.lenderAsCustomer(tx, ctx, input.financeLenderVendorId!);
          lines.push({
            accountId: accounts.AR,
            debit: lenderReceivable,
            credit: 0,
            description: 'Due from finance lender',
            customerId: lenderCustomerId,
            vehicleId: vehicle.id,
          });
        }

        // The trade-in comes into inventory at its actual cash value. An
        // allowance above that value is a reduction of this sale's revenue,
        // not part of the trade-in's cost.
        if (tradeIn) {
          lines.push({
            accountId: accounts.VEHICLE_INVENTORY,
            debit: computation.tradeAcquisitionCostCents,
            credit: 0,
            description: `Trade-in ${tradeIn.year} ${tradeIn.make} ${tradeIn.model}`,
            vehicleId: tradeIn.vehicleId,
            customerId: customer.id,
            costCategory: 'PURCHASE',
          });
          if (computation.overAllowanceCents > 0) {
            lines.push({
              accountId: revenueAccount,
              debit: computation.overAllowanceCents,
              credit: 0,
              description: 'Trade-in over-allowance',
              ...dims,
            });
          }
          if (computation.lienPayoffCents > 0) {
            lines.push({
              accountId: accounts.AP,
              debit: 0,
              credit: computation.lienPayoffCents,
              description: 'Trade-in lien payoff',
              vendorId: tradeIn.lienHolderVendorId,
              vehicleId: tradeIn.vehicleId,
            });
          }
        }

        // Revenue, by kind.
        lines.push({
          accountId: revenueAccount,
          debit: 0,
          credit: computation.vehicleNetCents,
          description: label,
          ...dims,
        });
        lines.push({
          accountId: accounts.FEE_REVENUE,
          debit: 0,
          credit: computation.feesCents,
          description: 'Dealer and documentation fees',
          ...dims,
        });
        lines.push({
          accountId: accounts.ACCESSORIES_SALES,
          debit: 0,
          credit: input.accessories,
          description: 'Accessories',
          ...dims,
        });
        lines.push({
          accountId: accounts.EXTENDED_WARRANTY_REVENUE,
          debit: 0,
          credit: input.warranty,
          description: 'Extended warranty',
          ...dims,
        });
        lines.push({
          accountId: accounts.OTHER_REVENUE,
          debit: 0,
          credit: input.otherCharges,
          description: 'Other charges',
          ...dims,
        });
        lines.push({
          accountId: accounts.FINANCE_REVENUE,
          debit: 0,
          credit: input.financeRevenue,
          description: 'Finance reserve',
          vehicleId: vehicle.id,
        });

        // Each tax separately, to its own payable account.
        for (const component of computation.tax.components) {
          const key = payableAccountKey(component.taxType);
          const { [key]: account } = await this.posting.accounts(tx, ctx.dealerId, [key]);
          lines.push({
            accountId: account,
            debit: 0,
            credit: component.taxCents,
            description: `${component.taxType} collected (${component.rate}%)`,
            taxType: component.taxType,
            ...dims,
          });
        }

        // Inventory out at book value, to cost of sales.
        lines.push({
          accountId: accounts.VEHICLE_COGS,
          debit: computation.costOfSaleCents,
          credit: 0,
          description: `Cost of ${label}`,
          vehicleId: vehicle.id,
        });
        lines.push({
          accountId: accounts.VEHICLE_INVENTORY,
          debit: 0,
          credit: computation.costOfSaleCents,
          description: `${label} sold`,
          vehicleId: vehicle.id,
        });

        const entry = await this.posting.post(tx, ctx, {
          date: input.saleDate,
          description: `Sale #${sale.number} — ${label} to ${customer.name}`,
          memo: input.notes,
          source: 'VEHICLE_SALE',
          sourceType: 'VehicleSale',
          sourceId: sale.id,
          lines,
        });

        // Deposits applied.
        for (const application of input.deposits) {
          const deposit = await tx.customerDeposit.findUniqueOrThrow({
            where: { id: application.depositId },
          });
          const applied = toCents(deposit.applied) + application.amount;
          await tx.customerDeposit.update({
            where: { id: deposit.id },
            data: {
              applied: fromCents(applied),
              status: depositStatus(toCents(deposit.amount), applied, toCents(deposit.refunded)),
            },
          });
          await tx.customerDepositEvent.create({
            data: {
              depositId: deposit.id,
              kind: 'APPLIED',
              amount: fromCents(application.amount),
              date: toDbDate(input.saleDate),
              saleId: sale.id,
              journalEntryId: entry.id,
            },
          });
        }

        // Receivables: the customer's balance and the lender's.
        let invoiceId: string | null = null;
        const dueDate = input.dueDate ?? addDays(input.saleDate, 30);
        if (computation.balanceDueCents > 0) {
          const invoice = await tx.customerInvoice.create({
            data: {
              dealerId: ctx.dealerId,
              number: await nextInvoiceNumber(tx, ctx.dealerId),
              customerId: customer.id,
              saleId: sale.id,
              date: toDbDate(input.saleDate),
              dueDate: toDbDate(dueDate),
              description: `Balance due on sale #${sale.number} — ${label}`,
              lines: [
                {
                  description: `Sale #${sale.number} balance`,
                  amountCents: computation.balanceDueCents,
                },
              ],
              subtotal: fromCents(computation.balanceDueCents),
              total: fromCents(computation.balanceDueCents),
              journalEntryId: entry.id,
              createdById: ctx.userId,
            },
          });
          invoiceId = invoice.id;
        }
        if (lenderReceivable > 0 && lenderCustomerId) {
          await tx.customerInvoice.create({
            data: {
              dealerId: ctx.dealerId,
              number: await nextInvoiceNumber(tx, ctx.dealerId),
              customerId: lenderCustomerId,
              saleId: sale.id,
              date: toDbDate(input.saleDate),
              dueDate: toDbDate(dueDate),
              description: `Financing for ${customer.name} — sale #${sale.number}`,
              lines: [
                { description: 'Amount financed', amountCents: input.financedAmount },
                { description: 'Finance reserve', amountCents: input.financeRevenue },
              ],
              subtotal: fromCents(lenderReceivable),
              total: fromCents(lenderReceivable),
              journalEntryId: entry.id,
              createdById: ctx.userId,
            },
          });
        }

        // The trade-in is now a purchase, with its lien payoff owed.
        if (tradeIn) {
          const acquisition = await tx.vehicleAcquisition.create({
            data: {
              dealerId: ctx.dealerId,
              vehicleId: tradeIn.vehicleId,
              method: 'TRADE_IN',
              customerId: customer.id,
              date: toDbDate(input.saleDate),
              purchasePrice: fromCents(computation.tradeAcquisitionCostCents),
              total: fromCents(computation.tradeAcquisitionCostCents),
              settlement: 'NONE',
              journalEntryId: entry.id,
              notes: `Trade-in on sale #${sale.number}`,
              createdById: ctx.userId,
            },
          });
          await tx.vehicleCost.create({
            data: {
              vehicleId: tradeIn.vehicleId,
              category: 'PURCHASE',
              description: `Trade-in on sale #${sale.number} (actual cash value)`,
              amountCents: computation.tradeAcquisitionCostCents,
              incurredOn: toDbDate(input.saleDate),
              recordedById: ctx.userId,
              journalEntryId: entry.id,
            },
          });
          if (computation.lienPayoffCents > 0 && tradeIn.lienHolderVendorId) {
            const lienHolder = await requireVendor(tx, ctx, tradeIn.lienHolderVendorId);
            await tx.vendorBill.create({
              data: {
                dealerId: ctx.dealerId,
                number: await nextNumber(tx, ctx.dealerId, 'nextBillNumber'),
                vendorId: lienHolder.id,
                vendorReference: `Payoff ${tradeIn.vin ?? `${tradeIn.year} ${tradeIn.make} ${tradeIn.model}`}`,
                date: toDbDate(input.saleDate),
                dueDate: toDbDate(addDays(input.saleDate, 10)),
                lines: [
                  {
                    description: 'Trade-in lien payoff',
                    amountCents: computation.lienPayoffCents,
                    vehicleId: tradeIn.vehicleId,
                  },
                ],
                subtotal: fromCents(computation.lienPayoffCents),
                total: fromCents(computation.lienPayoffCents),
                journalEntryId: entry.id,
                createdById: ctx.userId,
              },
            });
          }
          await tx.tradeIn.update({
            where: { id: tradeIn.id },
            data: { status: 'POSTED', saleId: sale.id, acquisitionId: acquisition.id },
          });
        }

        await this.tax.recordTaxLines(tx, ctx, {
          calculation: computation.tax,
          province: computation.province,
          date: input.saleDate,
          direction: 'COLLECTED',
          sourceType: 'VehicleSale',
          sourceId: sale.id,
          journalEntryId: entry.id,
        });

        await tx.vehicle.update({
          where: { id: vehicle.id },
          data: { status: 'SOLD', soldAt: toDbDate(input.saleDate) },
        });
        await tx.vehicleSale.update({
          where: { id: sale.id },
          data: { journalEntryId: entry.id, invoiceId },
        });

        await recordAudit(tx, ctx, {
          action: 'sale.posted',
          entityType: 'VehicleSale',
          entityId: sale.id,
          after: {
            number: sale.number,
            vehicleId: vehicle.id,
            customerId: customer.id,
            totalCents: computation.totalCents,
            taxCents: computation.taxTotalCents,
            costOfSaleCents: computation.costOfSaleCents,
            grossProfitCents: computation.grossProfitCents,
            journal: entry.reference,
          },
        });

        return {
          id: sale.id,
          number: sale.number,
          journalEntryId: entry.id,
          reference: entry.reference,
          computation,
        };
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Reverses a posted sale: the journal entry and its tax lines are mirrored,
   * deposits are restored, the receivables voided, the trade-in taken back out
   * of inventory and the vehicle returned to its earlier status. Refused once
   * money has been collected against it — reverse those payments first.
   */
  async reverse(ctx: AccountingContext, saleId: string, reason: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const sale = await tx.vehicleSale.findFirst({
          where: { id: saleId, dealerId: ctx.dealerId },
        });
        if (!sale) throw new NotFoundException('Sale not found');
        if (sale.status !== 'POSTED')
          throw new ConflictException('Only a posted sale can be reversed');
        await lockDealerVehicle(tx, ctx, sale.vehicleId);

        const invoices = await tx.customerInvoice.findMany({
          where: { dealerId: ctx.dealerId, saleId: sale.id },
        });
        if (invoices.some((invoice) => toCents(invoice.amountPaid) > 0)) {
          throw new ConflictException(
            'Payments have been received on this sale; reverse them first',
          );
        }
        const tradeIn = sale.tradeInId
          ? await tx.tradeIn.findUniqueOrThrow({ where: { id: sale.tradeInId } })
          : null;
        if (tradeIn) {
          const resold = await tx.vehicleSale.findFirst({
            where: { dealerId: ctx.dealerId, vehicleId: tradeIn.vehicleId, status: 'POSTED' },
          });
          if (resold)
            throw new ConflictException(
              'The trade-in has since been sold; reverse that sale first',
            );
          const lienBills = await tx.vendorBill.findMany({
            where: {
              dealerId: ctx.dealerId,
              journalEntryId: sale.journalEntryId!,
              vendorId: tradeIn.lienHolderVendorId ?? undefined,
            },
          });
          if (lienBills.some((bill) => toCents(bill.amountPaid) > 0)) {
            throw new ConflictException(
              'The trade-in lien has been paid; reverse that payment first',
            );
          }
          for (const bill of lienBills)
            await tx.vendorBill.update({ where: { id: bill.id }, data: { status: 'VOID' } });
          if (tradeIn.acquisitionId) {
            await tx.vehicleAcquisition.update({
              where: { id: tradeIn.acquisitionId },
              data: { status: 'VOID' },
            });
          }
          await tx.tradeIn.update({
            where: { id: tradeIn.id },
            data: { status: 'DRAFT', saleId: null, acquisitionId: null },
          });
        }

        const reversal = await this.posting.reverse(tx, ctx, sale.journalEntryId!, { reason });
        await this.tax.reverseTaxLines(tx, ctx, {
          sourceType: 'VehicleSale',
          sourceId: sale.id,
          date: todayIso(),
          journalEntryId: reversal.id,
        });
        await tx.vehicleCost.deleteMany({ where: { journalEntryId: sale.journalEntryId! } });

        for (const invoice of invoices) {
          await tx.customerInvoice.update({
            where: { id: invoice.id },
            data: { status: 'VOID', voidEntryId: reversal.id },
          });
        }
        const applications = await tx.customerDepositEvent.findMany({
          where: { saleId: sale.id, kind: 'APPLIED' },
        });
        for (const application of applications) {
          const deposit = await tx.customerDeposit.findUniqueOrThrow({
            where: { id: application.depositId },
          });
          const applied = toCents(deposit.applied) - toCents(application.amount);
          await tx.customerDeposit.update({
            where: { id: deposit.id },
            data: {
              applied: fromCents(applied),
              status: depositStatus(toCents(deposit.amount), applied, toCents(deposit.refunded)),
            },
          });
          await tx.customerDepositEvent.create({
            data: {
              depositId: deposit.id,
              kind: 'UNAPPLIED',
              amount: application.amount,
              date: toDbDate(todayIso()),
              saleId: sale.id,
              journalEntryId: reversal.id,
              reason,
            },
          });
        }

        await tx.vehicle.update({
          where: { id: sale.vehicleId },
          data: { status: sale.previousVehicleStatus ?? 'DRAFT', soldAt: null },
        });
        await tx.vehicleSale.update({
          where: { id: sale.id },
          data: { status: 'VOID', reversalEntryId: reversal.id },
        });
        await recordAudit(tx, ctx, {
          action: 'sale.reversed',
          entityType: 'VehicleSale',
          entityId: sale.id,
          before: { status: 'POSTED' },
          after: { status: 'VOID', reversal: reversal.reference },
          reason,
        });
        return { id: sale.id, reversalEntryId: reversal.id };
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Validates a deal and works out every figure. Shared by the quote, the
   * draft and the posting, so what the salesperson was shown is what posts.
   */
  async compute(
    tx: Tx,
    ctx: AccountingContext,
    input: SaleInput,
    options: { forDraft?: boolean } = {},
  ): Promise<SaleComputation> {
    const warnings: string[] = [];
    const vehicle = await tx.vehicle.findFirst({
      where: { id: input.vehicleId, sellerId: ctx.ownerUserId },
      select: { id: true, status: true, condition: true },
    });
    if (!vehicle) throw new BadRequestException('Vehicle not found in your inventory');
    const alreadySold = await tx.vehicleSale.findFirst({
      where: { dealerId: ctx.dealerId, vehicleId: vehicle.id, status: 'POSTED' },
      select: { number: true, saleDate: true },
    });
    if (alreadySold) {
      const reacquired = await tx.vehicleAcquisition.findFirst({
        where: {
          dealerId: ctx.dealerId,
          vehicleId: vehicle.id,
          status: 'POSTED',
          date: { gt: alreadySold.saleDate },
        },
      });
      if (!reacquired)
        throw new ConflictException(`This vehicle was sold on sale #${alreadySold.number}`);
    }
    if (vehicle.status === 'IN_AUCTION')
      throw new ConflictException('The vehicle is in a running auction');
    await requireCustomer(tx, ctx, input.customerId);

    if (input.salespersonId && input.salespersonId !== ctx.ownerUserId) {
      const member = await tx.dealerMember.findFirst({
        where: { dealerId: ctx.dealerId, userId: input.salespersonId },
      });
      if (!member)
        throw new BadRequestException('The salesperson is not on this dealership’s team');
    }
    if (input.financeLenderVendorId) await requireVendor(tx, ctx, input.financeLenderVendorId);
    if (input.bankAccountId) await bankGlAccount(tx, ctx, input.bankAccountId);

    // Trade-in.
    let tradeAllowance = 0;
    let tradeCost = 0;
    let lienPayoff = 0;
    if (input.tradeInId) {
      const tradeIn = await tx.tradeIn.findFirst({
        where: { id: input.tradeInId, dealerId: ctx.dealerId },
      });
      if (!tradeIn) throw new BadRequestException('Trade-in not found');
      if (tradeIn.status !== 'DRAFT')
        throw new ConflictException('This trade-in is already on a sale');
      if (tradeIn.customerId !== input.customerId)
        throw new BadRequestException('The trade-in belongs to another customer');
      if (tradeIn.vehicleId === vehicle.id)
        throw new BadRequestException('A vehicle cannot be traded in on itself');
      tradeAllowance = toCents(tradeIn.tradeAllowance);
      const appraised = toCents(tradeIn.appraisedValue);
      tradeCost = appraised > 0 ? Math.min(appraised, tradeAllowance) : tradeAllowance;
      lienPayoff = toCents(tradeIn.lienPayoff);
    }

    // Deposits.
    let deposits = 0;
    const seen = new Set<string>();
    for (const application of input.deposits) {
      if (seen.has(application.depositId))
        throw new BadRequestException('A deposit is listed twice');
      seen.add(application.depositId);
      const deposit = await tx.customerDeposit.findFirst({
        where: { id: application.depositId, dealerId: ctx.dealerId },
      });
      if (!deposit) throw new BadRequestException('Deposit not found');
      if (deposit.customerId !== input.customerId)
        throw new BadRequestException('A deposit belongs to another customer');
      const remaining =
        toCents(deposit.amount) - toCents(deposit.applied) - toCents(deposit.refunded);
      if (application.amount > remaining) {
        throw new BadRequestException(
          `Deposit #${deposit.number} has only ${centsToDecimalString(remaining)} left`,
        );
      }
      deposits += application.amount;
    }

    // Tax, from the configured rules for where the vehicle is delivered.
    const settings = await dealerProvince(tx, ctx.dealerId);
    const province = (input.taxProvince ?? settings.province) as Province;
    const vehicleNet = input.salePrice - input.discount;
    const fees = input.documentationFee + input.dealerFees;
    const tax = await this.tax.calculate(tx, ctx.dealerId, {
      province,
      date: input.saleDate,
      lines: [
        { category: 'VEHICLE', amountCents: vehicleNet },
        { category: 'FEES', amountCents: fees },
        { category: 'ACCESSORIES', amountCents: input.accessories },
        { category: 'WARRANTY', amountCents: input.warranty },
        { category: 'GENERAL', amountCents: input.otherCharges },
      ],
      tradeInCents: tradeAllowance,
      vehiclePriceCents: vehicleNet,
    });
    if (tax.components.length === 0)
      warnings.push(`No sales tax is configured for ${province} on ${input.saleDate}`);
    if (
      tax.components.some(
        (component) =>
          component.taxCents > 0 && component.recoverable === false && component.taxType !== 'PST',
      )
    ) {
      warnings.push('A non-recoverable federal tax rule is configured; check the tax settings');
    }
    const subtotal = vehicleNet + fees + input.accessories + input.warranty + input.otherCharges;
    const taxTotal = tax.totalTaxCents;
    const total = subtotal + taxTotal;

    const balanceDue =
      total - tradeAllowance + lienPayoff - deposits - input.downPayment - input.financedAmount;
    if (balanceDue < 0) {
      throw new BadRequestException(
        `Payments and credits exceed the deal total by ${centsToDecimalString(-balanceDue)}; reduce the down payment or deposits`,
      );
    }

    // Cost of sale: the vehicle's book value, read from the ledger.
    const { VEHICLE_INVENTORY: inventory } = await this.posting.accounts(tx, ctx.dealerId, [
      'VEHICLE_INVENTORY',
    ]);
    const totals = await accountTotals(tx, ctx.dealerId, {
      accountIds: [inventory],
      vehicleId: vehicle.id,
    });
    const bookValue = debitBalance(totals.get(inventory));
    if (bookValue <= 0) {
      const message =
        'This vehicle has no cost on the books. Record its purchase first, so cost of sales and gross profit are right.';
      if (!settings.allowNegativeInventory && !options.forDraft)
        throw new ConflictException(message);
      warnings.push(message);
    }
    const floorPlan = await tx.floorPlanNote.findFirst({
      where: { dealerId: ctx.dealerId, vehicleId: vehicle.id, status: 'ACTIVE' },
      select: { principal: true, principalPaid: true },
    });
    if (floorPlan) {
      const owed = toCents(floorPlan.principal) - toCents(floorPlan.principalPaid);
      warnings.push(
        `This vehicle is floor-planned; ${centsToDecimalString(owed)} must be paid off when it sells`,
      );
    }

    const costOfSale = Math.max(0, bookValue);
    const overAllowance = tradeAllowance - tradeCost;
    const netRevenue = subtotal - overAllowance + input.financeRevenue;
    const grossProfit = netRevenue - costOfSale;
    return {
      province,
      vehicleNetCents: vehicleNet,
      feesCents: fees,
      subtotalCents: subtotal,
      tax,
      taxTotalCents: taxTotal,
      totalCents: total,
      tradeAllowanceCents: tradeAllowance,
      tradeAcquisitionCostCents: tradeCost,
      overAllowanceCents: overAllowance,
      lienPayoffCents: lienPayoff,
      depositsCents: deposits,
      downPaymentCents: input.downPayment,
      financedCents: input.financedAmount,
      balanceDueCents: balanceDue,
      costOfSaleCents: costOfSale,
      grossProfitCents: grossProfit,
      grossMarginBasisPoints:
        netRevenue > 0 ? Math.round((grossProfit * 10_000) / netRevenue) : null,
      warnings,
    };
  }

  /** The lender a deal is financed through, as the customer who owes the dealer. */
  private async lenderAsCustomer(
    tx: Tx,
    ctx: AccountingContext,
    vendorId: string,
  ): Promise<string> {
    const vendor = await requireVendor(tx, ctx, vendorId);
    const name = `${vendor.name} (finance lender)`;
    const existing = await tx.customer.findFirst({
      where: { dealerId: ctx.dealerId, name },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.customer.create({
      data: { dealerId: ctx.dealerId, name, notes: `Finance lender — vendor ${vendor.id}` },
      select: { id: true },
    });
    return created.id;
  }
}
