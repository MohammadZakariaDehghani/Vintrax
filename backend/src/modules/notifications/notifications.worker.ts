import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { NotificationsService } from './notifications.service';

/**
 * Turns platform events into notifications.
 *
 * Keeping this in a worker means a slow email provider never delays a bid
 * response, and a failed send is retried rather than lost.
 */
@Injectable()
export class NotificationsWorker implements OnModuleInit {
  private readonly logger = new Logger(NotificationsWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker(QUEUE_NAMES.notifications, async (job: Job) => {
      switch (job.name) {
        case 'bid-placed':
          await this.handleBidPlaced(job.data as { auctionId: string; bidderId: string });
          break;
        case 'auction-ended':
          await this.handleAuctionEnded(
            job.data as { auctionId: string; winnerId: string | null; amountCad: number },
          );
          break;
        case 'listing-moderated':
          await this.handleListingModerated(
            job.data as {
              userId: string;
              vehicleId: string;
              vehicleTitle: string;
              approved: boolean;
              reason: string | null;
            },
          );
          break;
        case 'inspection-completed':
          await this.handleInspectionCompleted(
            job.data as { vehicleId: string; inspectionId: string },
          );
          break;
        case 'dealer-verified':
          await this.handleDealerVerified(job.data as { userId: string; approved: boolean });
          break;
        default:
          this.logger.warn(`Unknown notification job "${job.name}"`);
      }
    });
  }

  /** Tells everyone who was leading that they are no longer winning. */
  private async handleBidPlaced(data: { auctionId: string; bidderId: string }): Promise<void> {
    const auction = await this.prisma.auction.findUnique({
      where: { id: data.auctionId },
      select: { id: true, title: true, currentBidCad: true },
    });
    if (!auction) return;

    const outbid = await this.prisma.bid.findMany({
      where: { auctionId: data.auctionId, status: 'OUTBID', bidderId: { not: data.bidderId } },
      select: { bidderId: true },
      distinct: ['bidderId'],
    });

    for (const bid of outbid) {
      await this.notifications.notify({
        userId: bid.bidderId,
        type: 'OUTBID',
        title: `You have been outbid on ${auction.title}`,
        body: `The current bid is now $${auction.currentBidCad.toLocaleString('en-CA')}.`,
        link: `/auctions/${auction.id}`,
        email: true,
      });
    }
  }

  private async handleAuctionEnded(data: {
    auctionId: string;
    winnerId: string | null;
    amountCad: number;
  }): Promise<void> {
    const auction = await this.prisma.auction.findUnique({
      where: { id: data.auctionId },
      select: { id: true, title: true, vehicle: { select: { sellerId: true } } },
    });
    if (!auction) return;

    if (data.winnerId) {
      await this.notifications.notify({
        userId: data.winnerId,
        type: 'AUCTION_WON',
        title: `You won ${auction.title}`,
        body: `Your bid of $${data.amountCad.toLocaleString('en-CA')} was successful. Complete your purchase to finish the sale.`,
        link: `/auctions/${auction.id}`,
        email: true,
      });
    }

    const losers = await this.prisma.bid.findMany({
      where: { auctionId: data.auctionId, status: 'LOST' },
      select: { bidderId: true },
      distinct: ['bidderId'],
    });

    for (const bid of losers) {
      if (bid.bidderId === data.winnerId) continue;
      await this.notifications.notify({
        userId: bid.bidderId,
        type: 'AUCTION_LOST',
        title: `${auction.title} has ended`,
        body: 'This auction closed without a winning bid from you.',
        link: `/auctions/${auction.id}`,
      });
    }

    await this.notifications.notify({
      userId: auction.vehicle.sellerId,
      type: data.winnerId ? 'AUCTION_WON' : 'AUCTION_LOST',
      title: data.winnerId
        ? `${auction.title} sold at auction`
        : `${auction.title} ended without meeting reserve`,
      body: data.winnerId
        ? `The winning bid was $${data.amountCad.toLocaleString('en-CA')}.`
        : 'Your vehicle has returned to the marketplace as a fixed-price listing.',
      link: `/auctions/${auction.id}`,
      email: true,
    });
  }

  private async handleListingModerated(data: {
    userId: string;
    vehicleId: string;
    vehicleTitle: string;
    approved: boolean;
    reason: string | null;
  }): Promise<void> {
    await this.notifications.notify({
      userId: data.userId,
      type: data.approved ? 'LISTING_APPROVED' : 'LISTING_REJECTED',
      title: data.approved
        ? `${data.vehicleTitle} is now live`
        : `${data.vehicleTitle} needs changes`,
      body: data.approved
        ? 'Your listing passed review and is visible to buyers.'
        : `Your listing was not approved.${data.reason ? ` Reason: ${data.reason}` : ''}`,
      link: `/dealer/inventory`,
      email: true,
    });
  }

  private async handleInspectionCompleted(data: {
    vehicleId: string;
    inspectionId: string;
  }): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: data.vehicleId },
      select: { sellerId: true, title: true, slug: true },
    });
    if (!vehicle) return;

    await this.notifications.notify({
      userId: vehicle.sellerId,
      type: 'INSPECTION_COMPLETED',
      title: `Inspection completed for ${vehicle.title}`,
      body: 'The inspection report is now attached to your listing.',
      link: `/vehicles/${vehicle.slug}`,
      email: true,
    });
  }

  private async handleDealerVerified(data: { userId: string; approved: boolean }): Promise<void> {
    await this.notifications.notify({
      userId: data.userId,
      type: 'DEALER_VERIFIED',
      title: data.approved ? 'Your dealership is verified' : 'Dealer verification unsuccessful',
      body: data.approved
        ? 'You can now publish inventory and run auctions on Vintrax.'
        : 'We could not verify your dealership. Contact support for details.',
      link: '/dealer/dashboard',
      email: true,
    });
  }
}
