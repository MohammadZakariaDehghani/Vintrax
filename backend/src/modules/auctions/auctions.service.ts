import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ANTI_SNIPE_EXTENSION_SECONDS,
  ANTI_SNIPE_WINDOW_SECONDS,
  minimumBidIncrement,
  type AuctionDetail,
  type AuctionEvent,
  type AuctionSummary,
  type BidSummary,
  type CreateAuctionInput,
  type PlaceBidInput,
  type Paginated,
  type SearchAuctionsQuery,
  type UpdateAuctionInput,
} from '@vintrax/shared';
import { Prisma, type Auction, type Bid } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { AuditService } from '../../common/audit/audit.service';
import { isAdmin, type AuthUser } from '../../common/auth/auth-user';
import { toVehicleSummary, vehicleSummarySelect } from '../vehicles/vehicles.mapper';
import { AuctionsGateway } from './auctions.gateway';

/** Recent bids shown on an auction detail page. */
const BID_HISTORY_LIMIT = 25;

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly gateway: AuctionsGateway,
  ) {}

  // --- Lifecycle -------------------------------------------------------------

  async create(input: CreateAuctionInput, user: AuthUser): Promise<AuctionDetail> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: { id: true, sellerId: true, title: true, status: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    if (vehicle.sellerId !== user.id && !isAdmin(user.role)) {
      throw new ForbiddenException('You can only auction vehicles you own');
    }

    if (vehicle.status === 'SOLD') {
      throw new BadRequestException('This vehicle has already been sold');
    }

    // One live auction per vehicle: two would let the same car be won twice.
    const existing = await this.prisma.auction.findFirst({
      where: { vehicleId: vehicle.id, status: { in: ['DRAFT', 'SCHEDULED', 'LIVE'] } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('This vehicle already has an auction scheduled or running');
    }

    if (input.endsAt.getTime() <= Date.now()) {
      throw new BadRequestException('endsAt must be in the future');
    }

    const auction = await this.prisma.auction.create({
      data: {
        vehicleId: vehicle.id,
        title: input.title ?? vehicle.title,
        startingBidCad: input.startingBidCad,
        currentBidCad: input.startingBidCad,
        reservePriceCad: input.reservePriceCad ?? null,
        buyNowPriceCad: input.buyNowPriceCad ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        status: input.startsAt.getTime() <= Date.now() ? 'LIVE' : 'SCHEDULED',
      },
      select: { id: true, status: true, startsAt: true, endsAt: true },
    });

    if (auction.status === 'LIVE') {
      await this.prisma.vehicle.update({
        where: { id: vehicle.id },
        data: { status: 'IN_AUCTION', saleChannel: 'AUCTION' },
      });
    }

    await this.scheduleLifecycleJobs(auction.id, auction.startsAt, auction.endsAt);

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auction.created',
      entityType: 'Auction',
      entityId: auction.id,
      metadata: { vehicleId: vehicle.id, startingBidCad: input.startingBidCad },
    });

    return this.findById(auction.id, user);
  }

  async update(id: string, input: UpdateAuctionInput, user: AuthUser): Promise<AuctionDetail> {
    const auction = await this.requireManageable(id, user);

    // Once bidding has started the commercial terms are fixed. Allowing a seller
    // to raise the reserve mid-auction would make every existing bid worthless.
    if (auction.bidCount > 0) {
      const changesTerms =
        input.startingBidCad !== undefined ||
        input.reservePriceCad !== undefined ||
        input.buyNowPriceCad !== undefined;
      if (changesTerms) {
        throw new BadRequestException('Auction terms cannot change once bidding has started');
      }
    }

    if (input.endsAt && input.endsAt.getTime() <= Date.now()) {
      throw new BadRequestException('endsAt must be in the future');
    }

    const updated = await this.prisma.auction.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.startingBidCad !== undefined
          ? { startingBidCad: input.startingBidCad, currentBidCad: input.startingBidCad }
          : {}),
        ...(input.reservePriceCad !== undefined ? { reservePriceCad: input.reservePriceCad } : {}),
        ...(input.buyNowPriceCad !== undefined ? { buyNowPriceCad: input.buyNowPriceCad } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true, startsAt: true, endsAt: true },
    });

    if (input.startsAt || input.endsAt) {
      await this.scheduleLifecycleJobs(updated.id, updated.startsAt, updated.endsAt);
    }

    return this.findById(id, user);
  }

  async cancel(id: string, user: AuthUser): Promise<AuctionDetail> {
    const auction = await this.requireManageable(id, user);

    if (auction.status === 'ENDED' || auction.status === 'SETTLED') {
      throw new BadRequestException('This auction has already finished');
    }

    // Cancelling with live bids is an admin decision — it breaks a commitment
    // to everyone who bid, so a seller cannot do it unilaterally.
    if (auction.bidCount > 0 && !isAdmin(user.role)) {
      throw new ForbiddenException(
        'This auction has bids and can only be cancelled by an administrator',
      );
    }

    await this.prisma.$transaction([
      this.prisma.auction.update({
        where: { id },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.bid.updateMany({
        where: { auctionId: id, status: { in: ['ACTIVE', 'WINNING'] } },
        data: { status: 'LOST' },
      }),
      this.prisma.vehicle.update({
        where: { id: auction.vehicleId },
        data: { status: 'ACTIVE', saleChannel: 'FIXED_PRICE' },
      }),
    ]);

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auction.cancelled',
      entityType: 'Auction',
      entityId: id,
      metadata: { bidCount: auction.bidCount },
    });

    return this.findById(id, user);
  }

  /** Moves a scheduled auction to LIVE. Driven by the lifecycle queue. */
  async start(id: string): Promise<void> {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      select: { id: true, status: true, vehicleId: true, endsAt: true },
    });
    if (!auction || auction.status !== 'SCHEDULED') return;

    await this.prisma.$transaction([
      this.prisma.auction.update({ where: { id }, data: { status: 'LIVE' } }),
      this.prisma.vehicle.update({
        where: { id: auction.vehicleId },
        data: { status: 'IN_AUCTION', saleChannel: 'AUCTION' },
      }),
    ]);

    this.gateway.broadcast(id, {
      type: 'AUCTION_STARTED',
      auctionId: id,
      currentBidCad: 0,
      bidCount: 0,
      secondsRemaining: this.secondsRemaining(auction.endsAt),
      endsAt: auction.endsAt.toISOString(),
      reserveMet: false,
      latestBid: null,
      occurredAt: new Date().toISOString(),
    });

    this.logger.log(`Auction ${id} is now live`);
  }

  /**
   * Closes an auction and selects the winner.
   *
   * Idempotent: a second call after the auction has ended is a no-op, which
   * matters because the lifecycle job can be retried.
   */
  async close(id: string): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.auction.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          vehicleId: true,
          endsAt: true,
          currentBidCad: true,
          reservePriceCad: true,
          bidCount: true,
        },
      });

      if (!auction || auction.status !== 'LIVE') return null;
      // An extension may have moved the close time after this job was queued.
      if (auction.endsAt.getTime() > Date.now()) return null;

      const topBid = await tx.bid.findFirst({
        where: { auctionId: id, status: { in: ['ACTIVE', 'WINNING'] } },
        orderBy: [{ amountCad: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, bidderId: true, amountCad: true },
      });

      const reserveMet =
        auction.reservePriceCad === null || (topBid?.amountCad ?? 0) >= auction.reservePriceCad;
      const hasWinner = Boolean(topBid) && reserveMet;

      await tx.auction.update({
        where: { id },
        data: {
          status: 'ENDED',
          winnerId: hasWinner ? topBid!.bidderId : null,
          winningBidId: hasWinner ? topBid!.id : null,
        },
      });

      if (hasWinner) {
        await tx.bid.update({ where: { id: topBid!.id }, data: { status: 'WON' } });
        await tx.bid.updateMany({
          where: { auctionId: id, id: { not: topBid!.id } },
          data: { status: 'LOST' },
        });
      } else {
        await tx.bid.updateMany({ where: { auctionId: id }, data: { status: 'LOST' } });
        // Reserve not met: the vehicle returns to the marketplace unsold.
        await tx.vehicle.update({
          where: { id: auction.vehicleId },
          data: { status: 'ACTIVE', saleChannel: 'FIXED_PRICE' },
        });
      }

      return {
        auctionId: id,
        vehicleId: auction.vehicleId,
        winnerId: hasWinner ? topBid!.bidderId : null,
        amountCad: topBid?.amountCad ?? 0,
        endsAt: auction.endsAt,
        bidCount: auction.bidCount,
        reserveMet,
      };
    });

    if (!result) return;

    this.gateway.broadcast(id, {
      type: 'AUCTION_ENDED',
      auctionId: id,
      currentBidCad: result.amountCad,
      bidCount: result.bidCount,
      secondsRemaining: 0,
      endsAt: result.endsAt.toISOString(),
      reserveMet: result.reserveMet,
      latestBid: null,
      occurredAt: new Date().toISOString(),
    });

    await this.queue.enqueue(QUEUE_NAMES.notifications, 'auction-ended', {
      auctionId: id,
      winnerId: result.winnerId,
      amountCad: result.amountCad,
    });

    this.logger.log(
      `Auction ${id} closed. ${result.winnerId ? `Winner ${result.winnerId}` : 'No winner (reserve not met)'}`,
    );
  }

  // --- Bidding ---------------------------------------------------------------

  /**
   * Places a bid.
   *
   * Correctness here rests on a serializable transaction: two bidders hitting
   * the same auction at the same instant must not both be told they are
   * winning. Postgres aborts one of them, and the caller sees a conflict rather
   * than a silently lost bid.
   */
  async placeBid(
    auctionId: string,
    input: PlaceBidInput,
    user: AuthUser,
    ipAddress?: string,
  ): Promise<{ bid: BidSummary; auction: AuctionDetail }> {
    let placed: { bidId: string; extended: boolean; event: AuctionEvent } | null = null;

    try {
      placed = await this.prisma.$transaction(
        async (tx) => {
          const auction = await tx.auction.findUnique({
            where: { id: auctionId },
            select: {
              id: true,
              status: true,
              vehicleId: true,
              startingBidCad: true,
              currentBidCad: true,
              bidCount: true,
              reservePriceCad: true,
              buyNowPriceCad: true,
              endsAt: true,
              extendedCount: true,
              vehicle: { select: { sellerId: true, title: true } },
            },
          });

          if (!auction) throw new NotFoundException('Auction not found');
          if (auction.status !== 'LIVE') {
            throw new BadRequestException('This auction is not accepting bids');
          }
          if (auction.endsAt.getTime() <= Date.now()) {
            throw new BadRequestException('This auction has closed');
          }
          if (auction.vehicle.sellerId === user.id) {
            throw new BadRequestException('You cannot bid on your own vehicle');
          }

          const hasBids = auction.bidCount > 0;
          const minimum = hasBids
            ? auction.currentBidCad + minimumBidIncrement(auction.currentBidCad)
            : auction.startingBidCad;

          if (input.amountCad < minimum) {
            throw new BadRequestException(
              `Bid must be at least $${minimum.toLocaleString('en-CA')}`,
            );
          }
          if (input.maxProxyAmountCad && input.maxProxyAmountCad < input.amountCad) {
            throw new BadRequestException('Your maximum proxy amount cannot be below your bid');
          }

          // Previous leaders are marked outbid before the new bid lands.
          await tx.bid.updateMany({
            where: { auctionId, status: { in: ['ACTIVE', 'WINNING'] } },
            data: { status: 'OUTBID' },
          });

          const bid = await tx.bid.create({
            data: {
              auctionId,
              bidderId: user.id,
              amountCad: input.amountCad,
              maxProxyAmountCad: input.maxProxyAmountCad ?? null,
              status: 'WINNING',
              ipAddress: ipAddress ?? null,
            },
            select: { id: true, amountCad: true, status: true, createdAt: true, bidderId: true },
          });

          // A bid in the closing moments extends the auction, so a lot cannot be
          // won by sniping in the final seconds.
          const withinAntiSnipeWindow =
            auction.endsAt.getTime() - Date.now() <= ANTI_SNIPE_WINDOW_SECONDS * 1000;
          const newEndsAt = withinAntiSnipeWindow
            ? new Date(auction.endsAt.getTime() + ANTI_SNIPE_EXTENSION_SECONDS * 1000)
            : auction.endsAt;

          const buyNowMet =
            auction.buyNowPriceCad !== null && input.amountCad >= auction.buyNowPriceCad;

          const updated = await tx.auction.update({
            where: { id: auctionId },
            data: {
              currentBidCad: input.amountCad,
              bidCount: { increment: 1 },
              ...(withinAntiSnipeWindow
                ? { endsAt: newEndsAt, extendedCount: { increment: 1 } }
                : {}),
              // Meeting the buy-now price ends the auction immediately.
              ...(buyNowMet ? { endsAt: new Date() } : {}),
            },
            select: { currentBidCad: true, bidCount: true, endsAt: true, reservePriceCad: true },
          });

          return {
            bidId: bid.id,
            extended: withinAntiSnipeWindow,
            event: {
              type: withinAntiSnipeWindow ? 'AUCTION_EXTENDED' : 'BID_PLACED',
              auctionId,
              currentBidCad: updated.currentBidCad,
              bidCount: updated.bidCount,
              secondsRemaining: this.secondsRemaining(updated.endsAt),
              endsAt: updated.endsAt.toISOString(),
              reserveMet:
                updated.reservePriceCad === null ||
                updated.currentBidCad >= updated.reservePriceCad,
              latestBid: {
                id: bid.id,
                auctionId,
                bidderHandle: this.bidderHandle(bid.bidderId),
                amountCad: bid.amountCad,
                status: bid.status,
                placedAt: bid.createdAt.toISOString(),
                isOwn: false,
              },
              occurredAt: new Date().toISOString(),
            } satisfies AuctionEvent,
          };
        },
        {
          // Serializable is the whole point: it makes concurrent bids on the
          // same auction conflict rather than interleave.
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10_000,
        },
      );
    } catch (error) {
      // Postgres aborts one side of a write conflict with 40001; that is a
      // retryable race, not a server fault, so tell the caller to try again.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.message.includes('40001'))
      ) {
        throw new ConflictException(
          'Another bid landed at the same moment. Please review the current price and bid again.',
        );
      }
      throw error;
    }

    this.gateway.broadcast(auctionId, placed.event);

    await this.queue.enqueue(QUEUE_NAMES.notifications, 'bid-placed', {
      auctionId,
      bidId: placed.bidId,
      bidderId: user.id,
    });

    // The close job is re-armed when an extension moved the end time.
    if (placed.extended) {
      const auction = await this.prisma.auction.findUniqueOrThrow({
        where: { id: auctionId },
        select: { endsAt: true },
      });
      await this.queue.enqueue(
        QUEUE_NAMES.auctions,
        'close-auction',
        { auctionId },
        {
          delayMs: Math.max(0, auction.endsAt.getTime() - Date.now()),
          jobId: `close-${auctionId}-${auction.endsAt.getTime()}`,
        },
      );
    }

    const detail = await this.findById(auctionId, user);
    const bid = detail.recentBids.find((candidate) => candidate.id === placed!.bidId);

    return { bid: bid ?? detail.recentBids[0]!, auction: detail };
  }

  async listBids(
    auctionId: string,
    page: number,
    pageSize: number,
    viewer?: AuthUser,
  ): Promise<Paginated<BidSummary>> {
    const where: Prisma.BidWhereInput = { auctionId };

    const [total, rows] = await Promise.all([
      this.prisma.bid.count({ where }),
      this.prisma.bid.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          auctionId: true,
          bidderId: true,
          amountCad: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items: rows.map((row) => this.toBidSummary(row, viewer?.id)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Auctions the caller has bid on, with their standing in each. */
  async listMyBids(user: AuthUser, page: number, pageSize: number): Promise<Paginated<BidSummary>> {
    const where: Prisma.BidWhereInput = { bidderId: user.id };

    const [total, rows] = await Promise.all([
      this.prisma.bid.count({ where }),
      this.prisma.bid.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          auctionId: true,
          bidderId: true,
          amountCad: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items: rows.map((row) => this.toBidSummary(row, user.id)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // --- Reads -----------------------------------------------------------------

  async findById(id: string, viewer?: AuthUser): Promise<AuctionDetail> {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      select: {
        id: true,
        vehicleId: true,
        title: true,
        status: true,
        startingBidCad: true,
        currentBidCad: true,
        bidCount: true,
        reservePriceCad: true,
        buyNowPriceCad: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        vehicle: { select: vehicleSummarySelect },
      },
    });
    if (!auction) throw new NotFoundException('Auction not found');

    const recentBids = await this.prisma.bid.findMany({
      where: { auctionId: id },
      orderBy: { createdAt: 'desc' },
      take: BID_HISTORY_LIMIT,
      select: {
        id: true,
        auctionId: true,
        bidderId: true,
        amountCad: true,
        status: true,
        createdAt: true,
      },
    });

    const viewerBid = viewer
      ? await this.prisma.bid.findFirst({
          where: { auctionId: id, bidderId: viewer.id },
          orderBy: { amountCad: 'desc' },
          select: { amountCad: true, maxProxyAmountCad: true, status: true },
        })
      : null;

    const favouritedIds = await this.favouritedIds(viewer?.id, [auction.vehicleId]);
    const hasBids = auction.bidCount > 0;

    return {
      id: auction.id,
      vehicleId: auction.vehicleId,
      title: auction.title,
      status: auction.status,
      startingBidCad: auction.startingBidCad,
      currentBidCad: auction.currentBidCad,
      bidCount: auction.bidCount,
      buyNowPriceCad: auction.buyNowPriceCad,
      reserveMet:
        auction.reservePriceCad === null || auction.currentBidCad >= auction.reservePriceCad,
      hasReserve: auction.reservePriceCad !== null,
      startsAt: auction.startsAt.toISOString(),
      endsAt: auction.endsAt.toISOString(),
      secondsRemaining: this.secondsRemaining(auction.endsAt),
      vehicle: toVehicleSummary(auction.vehicle, favouritedIds),
      minimumNextBidCad: hasBids
        ? auction.currentBidCad + minimumBidIncrement(auction.currentBidCad)
        : auction.startingBidCad,
      viewerBid: viewerBid
        ? {
            highestAmountCad: viewerBid.amountCad,
            maxProxyAmountCad: viewerBid.maxProxyAmountCad,
            status: viewerBid.status,
            isWinning: viewerBid.status === 'WINNING' || viewerBid.status === 'WON',
          }
        : null,
      recentBids: recentBids.map((row) => this.toBidSummary(row, viewer?.id)),
      createdAt: auction.createdAt.toISOString(),
    };
  }

  async search(query: SearchAuctionsQuery, viewer?: AuthUser): Promise<Paginated<AuctionSummary>> {
    const where: Prisma.AuctionWhereInput = {
      ...(query.status
        ? { status: { in: query.status } }
        : { status: { in: ['SCHEDULED', 'LIVE'] } }),
      ...(query.make ? { vehicle: { make: { equals: query.make, mode: 'insensitive' } } } : {}),
      ...(query.province ? { vehicle: { province: query.province } } : {}),
      ...(query.participatingOnly && viewer ? { bids: { some: { bidderId: viewer.id } } } : {}),
    };

    const orderBy: Prisma.AuctionOrderByWithRelationInput[] =
      query.sort === 'NEWEST'
        ? [{ createdAt: 'desc' }, { id: 'asc' }]
        : query.sort === 'PRICE_ASC'
          ? [{ currentBidCad: 'asc' }, { id: 'asc' }]
          : query.sort === 'PRICE_DESC'
            ? [{ currentBidCad: 'desc' }, { id: 'asc' }]
            : [{ endsAt: 'asc' }, { id: 'asc' }];

    const [total, rows] = await Promise.all([
      this.prisma.auction.count({ where }),
      this.prisma.auction.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          vehicleId: true,
          title: true,
          status: true,
          startingBidCad: true,
          currentBidCad: true,
          bidCount: true,
          reservePriceCad: true,
          buyNowPriceCad: true,
          startsAt: true,
          endsAt: true,
          vehicle: { select: vehicleSummarySelect },
        },
      }),
    ]);

    const favouritedIds = await this.favouritedIds(
      viewer?.id,
      rows.map((row) => row.vehicleId),
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        vehicleId: row.vehicleId,
        title: row.title,
        status: row.status,
        startingBidCad: row.startingBidCad,
        currentBidCad: row.currentBidCad,
        bidCount: row.bidCount,
        buyNowPriceCad: row.buyNowPriceCad,
        reserveMet: row.reservePriceCad === null || row.currentBidCad >= row.reservePriceCad,
        hasReserve: row.reservePriceCad !== null,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        secondsRemaining: this.secondsRemaining(row.endsAt),
        vehicle: toVehicleSummary(row.vehicle, favouritedIds),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  // --- Helpers ---------------------------------------------------------------

  private async requireManageable(id: string, user: AuthUser): Promise<Auction> {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      include: { vehicle: { select: { sellerId: true } } },
    });
    if (!auction) throw new NotFoundException('Auction not found');
    if (auction.vehicle.sellerId !== user.id && !isAdmin(user.role)) {
      throw new ForbiddenException('You do not have permission to manage this auction');
    }
    return auction;
  }

  private async scheduleLifecycleJobs(
    auctionId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<void> {
    const startDelay = startsAt.getTime() - Date.now();
    if (startDelay > 0) {
      await this.queue.enqueue(
        QUEUE_NAMES.auctions,
        'start-auction',
        { auctionId },
        { delayMs: startDelay, jobId: `start-${auctionId}-${startsAt.getTime()}` },
      );
    }

    await this.queue.enqueue(
      QUEUE_NAMES.auctions,
      'close-auction',
      { auctionId },
      {
        delayMs: Math.max(0, endsAt.getTime() - Date.now()),
        jobId: `close-${auctionId}-${endsAt.getTime()}`,
      },
    );
  }

  private secondsRemaining(endsAt: Date): number {
    return Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 1000));
  }

  /**
   * Bidder identities are never exposed. A stable pseudonym derived from the id
   * lets watchers follow a bidding war without learning who is in it.
   */
  private bidderHandle(bidderId: string): string {
    const suffix = bidderId.replace(/-/g, '').slice(-4).toUpperCase();
    return `Bidder ${suffix}`;
  }

  private toBidSummary(
    row: Pick<Bid, 'id' | 'auctionId' | 'bidderId' | 'amountCad' | 'status' | 'createdAt'>,
    viewerId?: string,
  ): BidSummary {
    return {
      id: row.id,
      auctionId: row.auctionId,
      bidderHandle: this.bidderHandle(row.bidderId),
      amountCad: row.amountCad,
      status: row.status,
      placedAt: row.createdAt.toISOString(),
      isOwn: viewerId === row.bidderId,
    };
  }

  private async favouritedIds(
    viewerId: string | undefined,
    vehicleIds: string[],
  ): Promise<ReadonlySet<string>> {
    if (!viewerId || vehicleIds.length === 0) return new Set();
    const rows = await this.prisma.favourite.findMany({
      where: { userId: viewerId, vehicleId: { in: vehicleIds } },
      select: { vehicleId: true },
    });
    return new Set(rows.map((row) => row.vehicleId));
  }
}
