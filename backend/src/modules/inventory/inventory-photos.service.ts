import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MAX_PHOTOS_PER_IMPORT } from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { VehicleImagesService } from '../vehicle-images/vehicle-images.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import type { PhotoIntent } from './inventory-plan';
import { RemoteImageError, fetchRemoteImage } from './remote-image';

/** One vehicle's worth of work: the row's photos, and where they belong. */
export interface VehiclePhotoWork {
  vehicleId: string;
  photos: PhotoIntent[];
}

/**
 * Downloading the photos a dealer feed pointed at, and re-hosting them here.
 *
 * Why re-host at all, rather than storing the third-party URL. D-025: a listing
 * that renders `<img src="https://some-dms.example/...">` puts a request to a
 * server Vintrax does not control on every buyer's page. That leaks the buyer's
 * address and referer to a third party, makes the listing go blank the day the
 * dealer changes DMS, and hands that server the ability to swap the photo for
 * anything at all after moderation approved it. So the bytes are copied once,
 * at import, and served from storage afterwards.
 *
 * Why this is not part of the import request. A rooftop's feed is roughly two
 * dozen photos per vehicle: the 47-row file this was built against asks for
 * about 1,100 downloads from someone else's web server. That is minutes of
 * work, so the import writes the vehicles, returns, and the photos arrive
 * afterwards — the dealer's inventory is correct immediately and gains its
 * pictures as they land.
 *
 * Why it is safe to run twice. Reconciliation is by (source URL, source
 * stamp), so a second run of the same file downloads nothing. That is what
 * makes it retryable, which is what makes it acceptable for it to be
 * interrupted.
 */
@Injectable()
export class InventoryPhotosService {
  private readonly logger = new Logger(InventoryPhotosService.name);

  /**
   * Simultaneous downloads.
   *
   * Aimed at the dealer's server, not at ours. Their photo host is a small web
   * server, and twenty parallel connections from an importer is indistinguishable
   * from an attack; six is brisk without being one.
   */
  private static readonly CONCURRENCY = 6;

  /** Per photo. Well above a camera JPEG and well below a memory problem. */
  private static readonly MAX_PHOTO_BYTES = 12 * 1024 * 1024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly vehicles: VehiclesService,
    private readonly vehicleImages: VehicleImagesService,
  ) {}

  /**
   * How many photos a run will consider: every vehicle's main photo, then the
   * others up to the per-import cap (see `run`).
   */
  static expectedCount(work: readonly VehiclePhotoWork[]): number {
    const total = work.reduce((sum, entry) => sum + entry.photos.length, 0);
    const primaries = work.filter((entry) => entry.photos.length > 0).length;
    return Math.min(total, Math.max(MAX_PHOTOS_PER_IMPORT, primaries));
  }

  /**
   * Runs the whole job for one import, recording progress as it goes.
   *
   * Never throws. It is started without being awaited — the import response has
   * already gone out — so an exception escaping here would be an unhandled
   * rejection with nothing to catch it, and the dealer would see photo progress
   * frozen at RUNNING with no reason given. Every failure ends up on the import
   * record instead.
   */
  async run(importId: string, work: readonly VehiclePhotoWork[]): Promise<void> {
    const started = Date.now();
    let fetched = 0;
    let reused = 0;
    let failed = 0;
    const errors = new Set<string>();

    try {
      await this.prisma.inventoryImport.update({
        where: { id: importId },
        data: { photoStatus: 'RUNNING' },
      });

      // Every vehicle's main photo is downloaded whatever the cap; only the
      // others share what is left of it. Spending the cap in file order gave
      // the first vehicles thirty photos each and the rest of a large feed no
      // photo at all, so they listed as "No photo". Photos already held cost
      // nothing and are never counted.
      const primaries = work.filter((entry) => entry.photos.length > 0).length;
      const budget: PhotoBudget = {
        extras: Math.max(0, MAX_PHOTOS_PER_IMPORT - primaries),
        deferred: 0,
      };
      const touched: string[] = [];

      for (const entry of work) {
        const outcome = await this.syncVehicle(entry.vehicleId, entry.photos, errors, budget);
        fetched += outcome.fetched;
        reused += outcome.reused;
        failed += outcome.failed;
        if (outcome.changed) touched.push(entry.vehicleId);

        await this.prisma.inventoryImport.update({
          where: { id: importId },
          data: { photosFetched: fetched, photosReused: reused, photosFailed: failed },
        });
      }

      // The listing card and the search document both carry the primary image,
      // so they are stale until this runs.
      await this.vehicles.afterBulkWrite(touched);

      if (budget.deferred > 0) {
        errors.add(
          `${budget.deferred} more ${budget.deferred === 1 ? 'photo was' : 'photos were'} not downloaded: one import downloads at most ${MAX_PHOTOS_PER_IMPORT.toLocaleString('en-CA')} new photos, with every vehicle's main photo first. Import the same file again to fetch the rest; photos already copied are not downloaded twice.`,
        );
      }

      await this.prisma.inventoryImport.update({
        where: { id: importId },
        data: {
          photoStatus: failed > 0 || errors.size > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
          photosFetched: fetched,
          photosReused: reused,
          photosFailed: failed,
          photoErrors: [...errors].slice(0, 20),
          photosFinishedAt: new Date(),
        },
      });

      this.logger.log(
        `Import ${importId} photos: ${fetched} downloaded, ${reused} already held, ${failed} failed in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } catch (error) {
      this.logger.error(`Import ${importId} photo run failed: ${String(error)}`);
      await this.prisma.inventoryImport
        .update({
          where: { id: importId },
          data: {
            photoStatus: 'FAILED',
            photosFetched: fetched,
            photosReused: reused,
            photosFailed: failed,
            photoErrors: [...errors, 'The photo run stopped early.'].slice(0, 20),
            photosFinishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Brings one vehicle's photos in line with what its row asked for.
   *
   * The feed owns the photos it brought and nothing else. Rows with no
   * `sourceUrl` are the dealer's own uploads through the web application; they
   * are kept, and moved to sit after the imported set rather than being
   * renumbered into the middle of it. A dealer who deletes an imported photo
   * here will see it return on the next import — that is what syncing a feed
   * means, and the way to remove it for good is to remove it from the feed.
   */
  private async syncVehicle(
    vehicleId: string,
    wanted: readonly PhotoIntent[],
    errors: Set<string>,
    budget: PhotoBudget = { extras: Number.POSITIVE_INFINITY, deferred: 0 },
  ): Promise<{ fetched: number; reused: number; failed: number; changed: boolean }> {
    const existing = await this.prisma.vehicleImage.findMany({
      where: { vehicleId },
      select: {
        id: true,
        url: true,
        position: true,
        sourceUrl: true,
        sourceUpdatedAt: true,
        assetId: true,
      },
      orderBy: { position: 'asc' },
    });
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { sellerId: true },
    });

    const held = new Map(
      existing
        .filter((image) => image.sourceUrl !== null)
        .map((image) => [
          identity(image.sourceUrl!, image.sourceUpdatedAt?.toISOString() ?? null),
          image,
        ]),
    );

    let fetched = 0;
    let failed = 0;
    const resolved: Array<{
      url: string;
      assetId: string | null;
      sourceUrl: string;
      sourceUpdatedAt: Date | null;
    }> = [];

    // Downloads run in parallel, but the result list is rebuilt in the file's
    // own order afterwards: the first photo in the row is the listing's primary
    // image, and "whichever request finished first" is not that.
    const slots = new Array<(typeof resolved)[number] | null>(wanted.length).fill(null);

    await this.inParallel(wanted, async (photo, index) => {
      const key = identity(photo.sourceUrl, photo.sourceUpdatedAt);
      const already = held.get(key);
      if (already) {
        slots[index] = {
          url: already.url,
          assetId: already.assetId,
          sourceUrl: photo.sourceUrl,
          sourceUpdatedAt: toDate(photo.sourceUpdatedAt),
        };
        return;
      }

      // The main photo always goes; the others only while the cap lasts. A
      // photo left out here is simply not on the listing yet — it was never
      // held, so nothing is removed — and the next import fetches it.
      if (index > 0) {
        if (budget.extras <= 0) {
          budget.deferred += 1;
          return;
        }
        budget.extras -= 1;
      }

      try {
        const image = await fetchRemoteImage(photo.sourceUrl, {
          maxBytes: InventoryPhotosService.MAX_PHOTO_BYTES,
        });
        // The same pipeline as a photo the dealer uploads by hand: validated
        // by content, resized to the responsive renditions, original kept.
        const stored = await this.vehicleImages.ingest(image.buffer, {
          uploadedById: vehicle?.sellerId ?? null,
          vehicleId,
        });
        slots[index] = {
          url: stored.url,
          assetId: stored.id,
          sourceUrl: photo.sourceUrl,
          sourceUpdatedAt: toDate(photo.sourceUpdatedAt),
        };
        fetched += 1;
      } catch (error) {
        failed += 1;
        // Recorded by reason and host rather than by URL. One unreachable host
        // produces the same sentence twelve hundred times, and a list of twelve
        // hundred URLs is not a thing anyone reads.
        const reason =
          error instanceof RemoteImageError || error instanceof BadRequestException
            ? error.message
            : 'could not be saved';
        errors.add(`${hostOf(photo.sourceUrl)}: ${reason}`);
      }
    });

    for (const slot of slots) if (slot) resolved.push(slot);
    const reused = resolved.length - fetched;

    // Nothing arrived and nothing was held: leave what is there. A feed whose
    // photo host is down for an hour should not blank a dealer's listings.
    if (resolved.length === 0) return { fetched, reused: 0, failed, changed: false };

    const keptUploads = existing.filter((image) => image.sourceUrl === null);
    const keptUrls = new Set(resolved.map((entry) => entry.url));
    const orphaned = existing.filter(
      (image) => image.sourceUrl !== null && !keptUrls.has(image.url),
    );

    const unchanged =
      orphaned.length === 0 &&
      resolved.length === existing.length - keptUploads.length &&
      resolved.every((entry, index) => existing[index]?.url === entry.url);

    if (unchanged) return { fetched, reused, failed, changed: false };

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleImage.deleteMany({
        where: { vehicleId, sourceUrl: { not: null } },
      });
      await tx.vehicleImage.createMany({
        data: resolved.map((entry, position) => ({
          vehicleId,
          url: entry.url,
          assetId: entry.assetId,
          position,
          sourceUrl: entry.sourceUrl,
          sourceUpdatedAt: entry.sourceUpdatedAt,
        })),
      });
      // The dealer's own uploads keep their order and follow the imported set.
      for (const [offset, upload] of keptUploads.entries()) {
        await tx.vehicleImage.update({
          where: { id: upload.id },
          data: { position: resolved.length + offset },
        });
      }
    });

    // Only the files this importer put in storage, and only once the rows
    // pointing at them are gone. A photo the dealer uploaded is never deleted
    // here, whatever the feed says.
    await this.vehicleImages.releaseUnused(
      orphaned.flatMap((image) => (image.assetId ? [image.assetId] : [])),
    );
    for (const image of orphaned) {
      if (image.assetId) continue;
      // A photo imported before the image pipeline: one file, at its URL.
      const key = image.url.replace(/^\/uploads\//, '');
      if (this.storage.isOwnUrl(image.url)) await this.storage.delete(key);
    }

    return { fetched, reused, failed, changed: true };
  }

  /** Runs `worker` over `items` with a fixed number in flight. */
  private async inParallel<T>(
    items: readonly T[],
    worker: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    let next = 0;
    const lanes = Array.from(
      { length: Math.min(InventoryPhotosService.CONCURRENCY, items.length) },
      async () => {
        for (;;) {
          const index = next;
          next += 1;
          const item = items[index];
          if (item === undefined) return;
          await worker(item, index);
        }
      },
    );
    await Promise.all(lanes);
  }
}

/** What is left of one import's download cap, shared across its vehicles. */
interface PhotoBudget {
  /** Downloads still allowed for photos other than a vehicle's main one. */
  extras: number;
  /** Photos skipped because the cap ran out. */
  deferred: number;
}

/** The pair that decides whether a stored photo is still the right photo. */
function identity(sourceUrl: string, sourceUpdatedAt: string | null): string {
  return `${sourceUrl} ${sourceUpdatedAt ?? ''}`;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The host, for grouping failures. Falls back to the raw text if unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}
