import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { SEARCH_PROVIDER, type SearchProvider } from '../../common/search/search.types';

/**
 * Keeps the search index in step with vehicle writes.
 *
 * A no-op for the PostgreSQL provider, which reads the live table. For
 * OpenSearch this is what stops the index drifting from the database.
 */
@Injectable()
export class SearchIndexWorker implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexWorker.name);

  constructor(
    private readonly queue: QueueService,
    @Inject(SEARCH_PROVIDER) private readonly search: SearchProvider,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker(QUEUE_NAMES.search, async (job: Job<{ vehicleId: string }>) => {
      const { vehicleId } = job.data;
      if (job.name === 'remove-vehicle') {
        await this.search.removeVehicle(vehicleId);
      } else {
        await this.search.indexVehicle(vehicleId);
      }
    });
  }
}
