import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { VehicleImagesService } from './vehicle-images.service';

export interface BackfillOptions {
  dryRun: boolean;
  /** Distinct photos to consider this run. */
  limit?: number;
  vehicleId?: string;
}

export type BackfillOutcome =
  | 'processed'
  | 'linked'
  | 'would-process'
  | 'skipped-external'
  | 'skipped-missing'
  | 'skipped-unsupported'
  | 'failed';

export interface BackfillReport {
  considered: number;
  counts: Record<BackfillOutcome, number>;
}

/**
 * `images:migrate`: gives every pre-pipeline vehicle photo the same
 * renditions a new upload gets.
 *
 * Safe to run any number of times. A photo row that already has an asset is
 * not looked at; a legacy URL that was processed but never linked (a run
 * stopped between the two steps) is found again by `legacyUrl` and linked
 * rather than processed twice. The legacy file itself is never modified or
 * deleted — its URL keeps working for anything that cached it.
 */
export class ImageBackfill {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly images: VehicleImagesService,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  async run(options: BackfillOptions): Promise<BackfillReport> {
    const rows = await this.prisma.vehicleImage.findMany({
      where: { assetId: null, ...(options.vehicleId ? { vehicleId: options.vehicleId } : {}) },
      select: { url: true, vehicleId: true, vehicle: { select: { sellerId: true } } },
      orderBy: [{ vehicleId: 'asc' }, { position: 'asc' }],
    });

    // One file can back more than one row; it is processed once.
    const byUrl = new Map<string, { vehicleId: string; sellerId: string }>();
    for (const row of rows) {
      if (!byUrl.has(row.url)) {
        byUrl.set(row.url, { vehicleId: row.vehicleId, sellerId: row.vehicle.sellerId });
      }
    }

    const counts: Record<BackfillOutcome, number> = {
      processed: 0,
      linked: 0,
      'would-process': 0,
      'skipped-external': 0,
      'skipped-missing': 0,
      'skipped-unsupported': 0,
      failed: 0,
    };

    const work = [...byUrl.entries()].slice(0, options.limit ?? Number.POSITIVE_INFINITY);
    for (const [url, owner] of work) {
      const outcome = await this.migrateOne(url, owner, options.dryRun);
      counts[outcome] += 1;
      this.log(`${outcome.padEnd(20)} vehicle=${owner.vehicleId} ${url}`);
    }

    return { considered: work.length, counts };
  }

  private async migrateOne(
    url: string,
    owner: { vehicleId: string; sellerId: string },
    dryRun: boolean,
  ): Promise<BackfillOutcome> {
    const previous = await this.prisma.vehicleImageAsset.findUnique({
      where: { legacyUrl: url },
      select: { id: true, url: true, status: true },
    });
    if (previous?.status === 'READY') {
      if (!dryRun) await this.link(url, previous.id, previous.url);
      return 'linked';
    }

    const key = this.images.legacyKey(url);
    if (!key) return 'skipped-external';
    if (!(await this.images.storedExists(key))) return 'skipped-missing';

    let buffer: Buffer;
    try {
      buffer = await this.images.readStored(key);
      // Header-only, so a dry run reports what a real run would actually do.
      // The seed placeholders are SVG, and SVG is not a photo: they stay as
      // they are.
      await this.images.validate(buffer);
    } catch (error) {
      if (error instanceof BadRequestException) return 'skipped-unsupported';
      this.log(`failed: ${url}: ${error instanceof Error ? error.message : String(error)}`);
      return 'failed';
    }
    if (dryRun) return 'would-process';

    // A run that died mid-photo leaves a PROCESSING or FAILED row holding
    // this legacyUrl; clear it so the photo can be tried again.
    if (previous) await this.prisma.vehicleImageAsset.delete({ where: { id: previous.id } });

    try {
      const uploaded = await this.images.ingest(buffer, {
        uploadedById: owner.sellerId,
        vehicleId: owner.vehicleId,
        legacyUrl: url,
      });
      await this.link(url, uploaded.id, uploaded.url);
      return 'processed';
    } catch (error) {
      // Passed the header check but would not decode (a truncated file).
      if (error instanceof BadRequestException) return 'skipped-unsupported';
      this.log(`failed: ${url}: ${error instanceof Error ? error.message : String(error)}`);
      return 'failed';
    }
  }

  /**
   * Points the rows at the processed photo. `url` moves to the optimized
   * rendition too, so anything that reads only `url` stops downloading the
   * original.
   */
  private async link(legacyUrl: string, assetId: string, assetUrl: string): Promise<void> {
    await this.prisma.vehicleImage.updateMany({
      where: { url: legacyUrl, assetId: null },
      data: { assetId, url: assetUrl },
    });
  }
}
