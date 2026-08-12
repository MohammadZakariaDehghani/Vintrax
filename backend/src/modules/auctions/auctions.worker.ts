import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuctionsService } from './auctions.service';

interface AuctionJobData {
  auctionId: string;
}

/**
 * Drives auction state transitions from the queue.
 *
 * Both handlers are idempotent, because a delayed job can be retried and an
 * anti-snipe extension can leave more than one close job queued for the same
 * auction. The service treats a second call as a no-op.
 *
 * A short Redis lock keeps two API instances from settling the same auction
 * simultaneously.
 */
@Injectable()
export class AuctionsWorker implements OnModuleInit {
  private readonly logger = new Logger(AuctionsWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly redis: RedisService,
    private readonly auctions: AuctionsService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker(QUEUE_NAMES.auctions, async (job: Job<AuctionJobData>) => {
      const { auctionId } = job.data;

      switch (job.name) {
        case 'start-auction':
          await this.withLock(`lock:auction:start:${auctionId}`, () =>
            this.auctions.start(auctionId),
          );
          break;

        case 'close-auction':
          await this.withLock(`lock:auction:close:${auctionId}`, () =>
            this.auctions.close(auctionId),
          );
          break;

        default:
          this.logger.warn(`Unknown auction job "${job.name}"`);
      }
    });
  }

  private async withLock(key: string, work: () => Promise<void>): Promise<void> {
    const release = await this.redis.acquireLock(key, 30);
    if (!release) {
      this.logger.debug(`Skipping ${key}; another instance holds the lock`);
      return;
    }
    try {
      await work();
    } finally {
      await release();
    }
  }
}
