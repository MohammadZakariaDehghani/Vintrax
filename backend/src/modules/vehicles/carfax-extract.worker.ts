import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { QueueService, QUEUE_NAMES } from '../../common/queue/queue.service';
import { fetchCarfaxReport, type CarfaxExtraction } from './carfax-report';

export interface CarfaxExtractJob {
  vehicleId: string;
  url: string;
}

/**
 * Runs the CARFAX extraction a vehicle save enqueued.
 *
 * Always runs after the save's own HTTP response has already gone out —
 * `VehiclesService` enqueues this rather than awaiting it, so a slow or
 * failing fetch never holds up saving the vehicle. A failure here is
 * recorded as `carfaxFetchError` for the dealer to read on their next visit
 * to the edit page, which is the only place it is ever surfaced.
 */
@Injectable()
export class CarfaxExtractWorker implements OnModuleInit {
  private readonly logger = new Logger(CarfaxExtractWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker(QUEUE_NAMES.carfax, async (job: Job<CarfaxExtractJob>) => {
      await this.run(job.data);
    });
  }

  private async run({ vehicleId, url }: CarfaxExtractJob): Promise<void> {
    const report = await fetchCarfaxReport(url);
    const fetchedAt = new Date();

    const data =
      report.status === 'ok'
        ? {
            carfaxOneOwner: report.extraction.oneOwner,
            carfaxLowKilometres: report.extraction.lowKilometres,
            carfaxFetchedAt: fetchedAt,
            carfaxFetchError: null,
          }
        : {
            carfaxFetchedAt: fetchedAt,
            carfaxFetchError: report.reason,
          };

    // `carfaxUrl: url` in the filter, not just `id`: applied only if the
    // vehicle's link is still the one this job fetched. A dealer who edited
    // or cleared the link while this ran should see that edit stand, not
    // have a stale result land on top of it a few seconds later.
    const { count } = await this.prisma.vehicle.updateMany({
      where: { id: vehicleId, carfaxUrl: url },
      data,
    });
    if (count === 0) {
      this.logger.debug(`Discarded a stale CARFAX extraction for vehicle ${vehicleId}`);
      return;
    }

    if (report.status === 'ok') {
      await this.replaceCarfaxHistory(vehicleId, report.extraction);
    } else {
      this.logger.warn(`CARFAX extraction failed for vehicle ${vehicleId}: ${report.reason}`);
    }

    // The badge and timeline both ride on the cached search document.
    await this.redis.delByPattern('vehicles:search:*');
  }

  /**
   * Replaces the vehicle's CARFAX-sourced timeline rows with this read.
   *
   * Scoped to `source: 'CARFAX'` on both the delete and the insert — the
   * seller's own `SELLER` rows, written through the separate history editor,
   * are never touched here. Mirrors how `replaceHistory` scopes its own
   * delete to `SELLER` for the same reason in the other direction.
   */
  private async replaceCarfaxHistory(
    vehicleId: string,
    extraction: CarfaxExtraction,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleHistoryEvent.deleteMany({ where: { vehicleId, source: 'CARFAX' } });

      if (extraction.records.length > 0) {
        // Sorted here rather than trusted from the report's own document
        // order — a report is not guaranteed to print its own accident
        // section chronologically, and the timeline should read the same way
        // regardless. A record with no usable date sorts after every dated
        // one rather than losing its place at position 0.
        const sorted = [...extraction.records].sort((a, b) => {
          if (a.occurredOn === b.occurredOn) return 0;
          if (a.occurredOn === null) return 1;
          if (b.occurredOn === null) return -1;
          return a.occurredOn < b.occurredOn ? -1 : 1;
        });

        await tx.vehicleHistoryEvent.createMany({
          data: sorted.map((record, position) => ({
            vehicleId,
            kind: 'ACCIDENT_DAMAGE' as const,
            source: 'CARFAX' as const,
            occurredOn: record.occurredOn ? new Date(`${record.occurredOn}T00:00:00Z`) : null,
            label: record.label,
            detail: record.detail,
            position,
          })),
        });
      } else if (extraction.statedAccidentFree) {
        await tx.vehicleHistoryEvent.create({
          data: {
            vehicleId,
            kind: 'NO_ACCIDENTS',
            source: 'CARFAX',
            label: 'No accidents or damage reported',
            detail: null,
            position: 0,
          },
        });
      }
    });
  }
}
