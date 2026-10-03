import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TradeInInput } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AccountingContext } from '../core/context';
import { recordAudit } from '../core/audit';
import { requireCustomer, requireDealerVehicle, requireVendor } from '../core/documents';
import { fromCents, toCents } from '../core/money';

/**
 * A trade-in, worked on the deal desk before the sale. It becomes inventory
 * when the sale posts — a purchase at its actual cash value, not a discount —
 * so until then it is a draft and its vehicle a draft listing.
 */
@Injectable()
export class TradeInsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: AccountingContext, query: { customerId?: string; status?: string }) {
    const rows = await this.prisma.tradeIn.findMany({
      where: {
        dealerId: ctx.dealerId,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.status === 'DRAFT' || query.status === 'POSTED' || query.status === 'VOID' ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        lienHolder: { select: { id: true, name: true } },
        sale: { select: { id: true, number: true } },
      },
      take: 500,
    });
    return rows.map((row) => view(row));
  }

  async create(ctx: AccountingContext, input: TradeInInput) {
    return this.prisma.$transaction(async (tx) => {
      await requireCustomer(tx, ctx, input.customerId);
      if (input.lienHolderVendorId) await requireVendor(tx, ctx, input.lienHolderVendorId);

      let vehicleId = input.vehicleId;
      if (vehicleId) {
        const vehicle = await requireDealerVehicle(tx, ctx, vehicleId);
        if (vehicle.status !== 'DRAFT') {
          throw new BadRequestException('Use a draft vehicle for a trade-in, or let one be created');
        }
      } else {
        const dealer = await tx.dealer.findUniqueOrThrow({
          where: { id: ctx.dealerId },
          select: { province: true, city: true },
        });
        const settings = await tx.accountingSettings.findUniqueOrThrow({
          where: { dealerId: ctx.dealerId },
          select: { province: true },
        });
        const title = `${input.year} ${input.make} ${input.model}${input.trim ? ` ${input.trim}` : ''}`;
        const vehicle = await tx.vehicle.create({
          data: {
            slug: `${title}-trade-${randomUUID().slice(0, 8)}`
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, ''),
            sellerId: ctx.ownerUserId,
            title,
            description: `Trade-in, received ${new Date().toISOString().slice(0, 10)}. Add the details before listing it.`,
            vin: input.vin,
            make: input.make,
            model: input.model,
            trim: input.trim,
            year: input.year,
            priceCad: Math.round(input.tradeAllowance / 100),
            mileageKm: input.mileageKm,
            condition: input.condition,
            bodyType: input.bodyType,
            transmission: input.transmission,
            fuelType: input.fuelType,
            drivetrain: input.drivetrain,
            province: dealer.province ?? settings.province,
            city: dealer.city ?? 'Unknown',
            status: 'DRAFT',
          },
          select: { id: true },
        });
        vehicleId = vehicle.id;
      }

      const tradeIn = await tx.tradeIn.create({
        data: {
          dealerId: ctx.dealerId,
          customerId: input.customerId,
          vehicleId: vehicleId!,
          vin: input.vin,
          year: input.year,
          make: input.make,
          model: input.model,
          mileageKm: input.mileageKm,
          appraisedValue: fromCents(input.appraisedValue),
          tradeAllowance: fromCents(input.tradeAllowance),
          lienPayoff: fromCents(input.lienPayoff),
          lienHolderVendorId: input.lienHolderVendorId,
          netTradeValue: fromCents(input.tradeAllowance - input.lienPayoff),
          notes: input.notes,
        },
        include: {
          customer: { select: { id: true, name: true } },
          lienHolder: { select: { id: true, name: true } },
          sale: { select: { id: true, number: true } },
        },
      });
      await recordAudit(tx, ctx, {
        action: 'trade_in.created',
        entityType: 'TradeIn',
        entityId: tradeIn.id,
        after: {
          vehicleId,
          appraisedValueCents: input.appraisedValue,
          tradeAllowanceCents: input.tradeAllowance,
          lienPayoffCents: input.lienPayoff,
        },
      });
      return view(tradeIn);
    });
  }

  /** A draft trade-in may be withdrawn; its draft vehicle stays for reuse. */
  async withdraw(ctx: AccountingContext, tradeInId: string) {
    await this.prisma.$transaction(async (tx) => {
      const tradeIn = await tx.tradeIn.findFirst({ where: { id: tradeInId, dealerId: ctx.dealerId } });
      if (!tradeIn) throw new NotFoundException('Trade-in not found');
      if (tradeIn.status !== 'DRAFT') throw new ConflictException('A trade-in on a posted sale is undone by reversing the sale');
      await tx.tradeIn.update({ where: { id: tradeIn.id }, data: { status: 'VOID' } });
      await recordAudit(tx, ctx, { action: 'trade_in.withdrawn', entityType: 'TradeIn', entityId: tradeIn.id });
    });
  }
}

function view(row: {
  id: string;
  customer: { id: string; name: string };
  vehicleId: string;
  saleId: string | null;
  vin: string | null;
  year: number;
  make: string;
  model: string;
  mileageKm: number | null;
  appraisedValue: { toString(): string };
  tradeAllowance: { toString(): string };
  lienPayoff: { toString(): string };
  lienHolder: { id: string; name: string } | null;
  netTradeValue: { toString(): string };
  status: string;
  notes: string | null;
  sale: { id: string; number: number } | null;
}) {
  return {
    id: row.id,
    customer: row.customer,
    vehicleId: row.vehicleId,
    sale: row.sale,
    vin: row.vin,
    year: row.year,
    make: row.make,
    model: row.model,
    mileageKm: row.mileageKm,
    appraisedValueCents: toCents(row.appraisedValue.toString()),
    tradeAllowanceCents: toCents(row.tradeAllowance.toString()),
    lienPayoffCents: toCents(row.lienPayoff.toString()),
    lienHolder: row.lienHolder,
    netTradeValueCents: toCents(row.netTradeValue.toString()),
    status: row.status,
    notes: row.notes,
  };
}
