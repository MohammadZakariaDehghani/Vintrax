import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  calculatePlatformFee,
  type ConfirmPaymentInput,
  type CreateOrderInput,
  type Paginated,
  type TransactionSummary,
} from '@atlas/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { isAdmin, type AuthUser } from '../../common/auth/auth-user';
import { toVehicleSummary, vehicleSummarySelect } from '../vehicles/vehicles.mapper';

const transactionSelect = {
  id: true,
  reference: true,
  status: true,
  salePriceCad: true,
  platformFeeCad: true,
  totalCad: true,
  createdAt: true,
  completedAt: true,
  vehicle: { select: vehicleSummarySelect },
  buyer: { select: { firstName: true, lastName: true } },
  seller: { select: { firstName: true, lastName: true } },
  payment: {
    select: {
      id: true,
      amountCad: true,
      platformFeeCad: true,
      method: true,
      status: true,
      providerReference: true,
      paidAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.TransactionRecordSelect;

type TransactionRow = Prisma.TransactionRecordGetPayload<{ select: typeof transactionSelect }>;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an order for a vehicle.
   *
   * Two paths lead here: buying a fixed-price vehicle outright, and completing
   * an auction win. Both converge on the same record, so settlement, fees and
   * reporting have one shape.
   */
  async createOrder(input: CreateOrderInput, buyer: AuthUser): Promise<TransactionSummary> {
    const created = await this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUnique({
        where: { id: input.vehicleId },
        select: {
          id: true,
          sellerId: true,
          title: true,
          status: true,
          priceCad: true,
          saleChannel: true,
        },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      if (vehicle.sellerId === buyer.id) {
        throw new BadRequestException('You cannot buy your own vehicle');
      }
      if (vehicle.status === 'SOLD') {
        throw new ConflictException('This vehicle has already been sold');
      }

      // Auction vehicles are bought by winning, not by ordering directly.
      let salePriceCad = vehicle.priceCad;
      let auctionId: string | null = null;

      if (vehicle.status === 'IN_AUCTION' || vehicle.saleChannel === 'AUCTION') {
        const auction = await tx.auction.findFirst({
          where: { vehicleId: vehicle.id, status: { in: ['ENDED', 'LIVE', 'SCHEDULED'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, winnerId: true, currentBidCad: true },
        });

        if (!auction || auction.status !== 'ENDED') {
          throw new BadRequestException(
            'This vehicle is being sold at auction. Place a bid instead.',
          );
        }
        if (auction.winnerId !== buyer.id) {
          throw new ForbiddenException('Only the winning bidder can complete this purchase');
        }
        salePriceCad = auction.currentBidCad;
        auctionId = auction.id;
      }

      const existing = await tx.transactionRecord.findFirst({
        where: { vehicleId: vehicle.id, status: { notIn: ['CANCELLED'] } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('An order already exists for this vehicle');
      }

      const platformFeeCad = calculatePlatformFee(salePriceCad);

      const record = await tx.transactionRecord.create({
        data: {
          reference: this.generateReference(),
          vehicleId: vehicle.id,
          auctionId,
          buyerId: buyer.id,
          sellerId: vehicle.sellerId,
          status: 'AWAITING_PAYMENT',
          salePriceCad,
          platformFeeCad,
          totalCad: salePriceCad + platformFeeCad,
          shippingAddressId: input.shippingAddressId ?? null,
          notes: input.notes ?? null,
          payment: {
            create: {
              amountCad: salePriceCad + platformFeeCad,
              platformFeeCad,
              method: input.paymentMethod,
              status: 'PENDING',
            },
          },
        },
        select: { id: true },
      });

      // Reserving the vehicle here is what stops a second buyer ordering it
      // while this order is awaiting payment.
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { status: 'SOLD', soldAt: new Date() },
      });

      return record;
    });

    await this.audit.record({
      actorId: buyer.id,
      actorEmail: buyer.email,
      action: 'transaction.created',
      entityType: 'TransactionRecord',
      entityId: created.id,
    });

    return this.findById(created.id, buyer);
  }

  /**
   * Records a successful payment.
   *
   * Atlas records payments rather than processing them, so this endpoint is an
   * assertion that money arrived — which makes it the seller's to make, not the
   * buyer's. A buyer permitted to call it could mark their own order `PAID`
   * without paying, so the check is here and not only in the route guard.
   *
   * `providerReference` is unique in the database, so a provider retrying its
   * webhook cannot mark the same payment paid twice.
   */
  async confirmPayment(
    transactionId: string,
    input: ConfirmPaymentInput,
    actor: AuthUser,
  ): Promise<TransactionSummary> {
    const record = await this.requireParticipant(transactionId, actor);

    if (record.sellerId !== actor.id && !isAdmin(actor.role)) {
      throw new ForbiddenException(
        'Only the seller or an administrator can record payment on this order',
      );
    }
    if (record.status === 'CANCELLED') {
      throw new BadRequestException('This order was cancelled');
    }

    try {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { transactionId },
          data: {
            status: 'PAID',
            providerReference: input.providerReference,
            paidAt: new Date(),
          },
        }),
        this.prisma.transactionRecord.update({
          where: { id: transactionId },
          data: { status: 'AWAITING_DELIVERY' },
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This payment reference has already been recorded');
      }
      throw error;
    }

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'payment.confirmed',
      entityType: 'TransactionRecord',
      entityId: transactionId,
      metadata: { providerReference: input.providerReference },
    });

    return this.findById(transactionId, actor);
  }

  /** Marks an order delivered and complete. Seller or admin only. */
  async complete(transactionId: string, actor: AuthUser): Promise<TransactionSummary> {
    const record = await this.requireParticipant(transactionId, actor);

    if (record.sellerId !== actor.id && !isAdmin(actor.role)) {
      throw new ForbiddenException('Only the seller can mark an order complete');
    }
    if (record.status !== 'AWAITING_DELIVERY' && record.status !== 'PAID') {
      throw new BadRequestException('This order is not awaiting delivery');
    }

    await this.prisma.transactionRecord.update({
      where: { id: transactionId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    return this.findById(transactionId, actor);
  }

  /** Cancels an unpaid order and returns the vehicle to the marketplace. */
  async cancel(transactionId: string, actor: AuthUser): Promise<TransactionSummary> {
    const record = await this.requireParticipant(transactionId, actor);

    if (record.status === 'COMPLETED') {
      throw new BadRequestException('A completed order cannot be cancelled');
    }
    if (record.payment?.status === 'PAID' && !isAdmin(actor.role)) {
      throw new ForbiddenException(
        'This order has been paid. An administrator must process a refund.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.transactionRecord.update({
        where: { id: transactionId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      }),
      this.prisma.payment.updateMany({
        where: { transactionId, status: { in: ['PENDING', 'AUTHORIZED'] } },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.vehicle.update({
        where: { id: record.vehicleId },
        data: { status: 'ACTIVE', soldAt: null },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'transaction.cancelled',
      entityType: 'TransactionRecord',
      entityId: transactionId,
    });

    return this.findById(transactionId, actor);
  }

  async findById(id: string, viewer: AuthUser): Promise<TransactionSummary> {
    const row = await this.prisma.transactionRecord.findUnique({
      where: { id },
      select: transactionSelect,
    });
    if (!row) throw new NotFoundException('Order not found');

    const participant = await this.prisma.transactionRecord.findFirst({
      where: { id, OR: [{ buyerId: viewer.id }, { sellerId: viewer.id }] },
      select: { id: true },
    });
    if (!participant && !isAdmin(viewer.role)) {
      throw new NotFoundException('Order not found');
    }

    return this.toSummary(row);
  }

  async listMine(
    user: AuthUser,
    role: 'buyer' | 'seller',
    page: number,
    pageSize: number,
  ): Promise<Paginated<TransactionSummary>> {
    const where: Prisma.TransactionRecordWhereInput =
      role === 'buyer' ? { buyerId: user.id } : { sellerId: user.id };

    const [total, rows] = await Promise.all([
      this.prisma.transactionRecord.count({ where }),
      this.prisma.transactionRecord.findMany({
        where,
        select: transactionSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.toSummary(row)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async requireParticipant(
    id: string,
    actor: AuthUser,
  ): Promise<{
    id: string;
    vehicleId: string;
    buyerId: string;
    sellerId: string;
    status: string;
    payment: { status: string } | null;
  }> {
    const record = await this.prisma.transactionRecord.findUnique({
      where: { id },
      select: {
        id: true,
        vehicleId: true,
        buyerId: true,
        sellerId: true,
        status: true,
        payment: { select: { status: true } },
      },
    });
    if (!record) throw new NotFoundException('Order not found');

    const isParticipant = record.buyerId === actor.id || record.sellerId === actor.id;
    if (!isParticipant && !isAdmin(actor.role)) {
      throw new NotFoundException('Order not found');
    }
    return record;
  }

  /** Short, human-quotable reference, e.g. ATL-8F3K2Q. */
  private generateReference(): string {
    return `ATL-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private toSummary(row: TransactionRow): TransactionSummary {
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      salePriceCad: row.salePriceCad,
      platformFeeCad: row.platformFeeCad,
      totalCad: row.totalCad,
      vehicle: toVehicleSummary(row.vehicle, new Set()),
      buyerName: `${row.buyer.firstName} ${row.buyer.lastName}`.trim(),
      sellerName: `${row.seller.firstName} ${row.seller.lastName}`.trim(),
      payment: row.payment
        ? {
            id: row.payment.id,
            amountCad: row.payment.amountCad,
            platformFeeCad: row.payment.platformFeeCad,
            method: row.payment.method,
            status: row.payment.status,
            providerReference: row.payment.providerReference,
            paidAt: row.payment.paidAt?.toISOString() ?? null,
            createdAt: row.payment.createdAt.toISOString(),
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
