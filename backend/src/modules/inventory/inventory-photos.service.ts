import {
  BadRequestException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MAX_PHOTOS_PER_IMPORT } from '@vintrax/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { VehicleImagesService } from '../vehicle-images/vehicle-images.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import type { PhotoIntent } from './inventory-plan';
import { RemoteImageError, fetchRemoteImage } from './remote-image';

/**
 * A run that has not said it is alive for this long is taken to have died with
 * the process it ran in. A live run writes a heartbeat at least every
 * `HEARTBEAT_MS`, and no single photo takes longer than the download timeout
 * (20 seconds) plus processing, so five quiet minutes means it is gone.
 */
export const PHOTO_RUN_STALE_MS = 5 * 60_000;

/** How often a live run records that it is still working. */
const HEARTBEAT_MS = 20_000;

/** The longest one run may take before it stops itself. */
export const PHOTO_RUN_DEADLINE_MS = 60 * 60_000;

/** How often the API looks for runs that died without a word. */
const SWEEP_EVERY_MS = 60_000;

export const STALE_RUN_MESSAGE =
  'Stopped: no progress for 5 minutes, most likely because the server restarted while photos were downloading. Import the same file again to finish; photos already copied are not downloaded twice.';

export const TIMED_OUT_MESSAGE =
  'Stopped after 60 minutes, the longest one import may spend on photos. Import the same file again to continue; photos already copied are not downloaded twice.';

/** The run was already marked finished elsewhere, by the stale-run sweep. */
class RunEnded extends Error {}

/** The run passed `PHOTO_RUN_DEADLINE_MS`. */
class RunTimedOut extends Error {}

/** Shared by a run and the photo downloads inside it, so a stop reaches all of them. */
interface RunControl {
  stopped: Error | null;
  /** Records progress and the heartbeat, at most every `HEARTBEAT_MS` unless forced. */
  beat: (force?: boolean) => Promise<void>;
}

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
export class InventoryPhotosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InventoryPhotosService.name);
  private sweepTimer: NodeJS.Timeout | null = null;

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
   * Runs from before a restart are swept at start-up, then once a minute —
   * and the history endpoints sweep the caller's own imports before reading,
   * so the screen never waits on the timer to stop showing a dead run.
   */
  onApplicationBootstrap(): void {
    void this.failStaleRuns();
    this.sweepTimer = setInterval(() => void this.failStaleRuns(), SWEEP_EVERY_MS);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Marks FAILED every PENDING or RUNNING photo run whose heartbeat has been
   * quiet for `PHOTO_RUN_STALE_MS` — a run cut off by a restart or a deploy,
   * which otherwise shows "Downloading photos" forever. A run from before
   * heartbeats existed is judged by when its import started. Never throws.
   */
  async failStaleRuns(scope: Prisma.InventoryImportWhereInput = {}): Promise<number> {
    const cutoff = new Date(Date.now() - PHOTO_RUN_STALE_MS);
    try {
      const { count } = await this.prisma.inventoryImport.updateMany({
        where: {
          ...scope,
          photoStatus: { in: ['PENDING', 'RUNNING'] },
          OR: [
            { photosHeartbeatAt: { lt: cutoff } },
            { photosHeartbeatAt: null, createdAt: { lt: cutoff } },
          ],
        },
        data: {
          photoStatus: 'FAILED',
          photosFinishedAt: new Date(),
          photoErrors: { push: STALE_RUN_MESSAGE },
        },
      });
      if (count > 0) this.logger.warn(`Marked ${count} stalled photo run(s) as failed`);
      return count;
    } catch (error) {
      this.logger.error(`Stale photo run sweep failed: ${String(error)}`);
      return 0;
    }
  }

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
    const deadline = started + PHOTO_RUN_DEADLINE_MS;
    let fetched = 0;
    let reused = 0;
    let failed = 0;
    const errors = new Set<string>();
    let lastBeat = 0;

    // Every write after the first is conditional on the run still being
    // RUNNING. If the stale-run sweep has already called it — a run that went
    // quiet long enough to look dead — this one stops rather than carrying on
    // behind a status that says it stopped.
    const control: RunControl = {
      stopped: null,
      beat: async (force = false) => {
        if (control.stopped) return;
        if (Date.now() > deadline) {
          control.stopped = new RunTimedOut();
          return;
        }
        if (!force && Date.now() - lastBeat < HEARTBEAT_MS) return;
        lastBeat = Date.now();
        const { count } = await this.prisma.inventoryImport.updateMany({
          where: { id: importId, photoStatus: 'RUNNING' },
          data: {
            photosFetched: fetched,
            photosReused: reused,
            photosFailed: failed,
            photosHeartbeatAt: new Date(),
          },
        });
        if (count === 0) control.stopped = new RunEnded();
      },
    };

    try {
      await this.prisma.inventoryImport.update({
        where: { id: importId },
        data: { photoStatus: 'RUNNING', photosHeartbeatAt: new Date() },
      });
      lastBeat = Date.now();

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
        const outcome = await this.syncVehicle(
          entry.vehicleId,
          entry.photos,
          errors,
          budget,
          control,
        );
        fetched += outcome.fetched;
        reused += outcome.reused;
        failed += outcome.failed;
        if (outcome.changed) touched.push(entry.vehicleId);
        if (control.stopped) throw control.stopped;
        await control.beat(true);
        if (control.stopped) throw control.stopped;
      }

      // The listing card and the search document both carry the primary image,
      // so they are stale until this runs.
      await this.vehicles.afterBulkWrite(touched);

      if (budget.deferred > 0) {
        errors.add(
          `${budget.deferred} more ${budget.deferred === 1 ? 'photo was' : 'photos were'} not downloaded: one import downloads at most ${MAX_PHOTOS_PER_IMPORT.toLocaleString('en-CA')} new photos, with every vehicle's main photo first. Import the same file again to fetch the rest; photos already copied are not downloaded twice.`,
        );
      }

      const { count } = await this.prisma.inventoryImport.updateMany({
        where: { id: importId, photoStatus: 'RUNNING' },
        data: {
          photoStatus: failed > 0 || errors.size > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
          photosFetched: fetched,
          photosReused: reused,
          photosFailed: failed,
          photoErrors: [...errors].slice(0, 20),
          photosFinishedAt: new Date(),
          photosHeartbeatAt: new Date(),
        },
      });
      if (count === 0) throw new RunEnded();

      this.logger.log(
        `Import ${importId} photos: ${fetched} downloaded, ${reused} already held, ${failed} failed in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } catch (error) {
      if (error instanceof RunEnded) {
        this.logger.warn(`Import ${importId} photo run was already marked stopped; ending it`);
        return;
      }
      const timedOut = error instanceof RunTimedOut;
      if (!timedOut) this.logger.error(`Import ${importId} photo run failed: ${String(error)}`);
      else this.logger.warn(`Import ${importId} photo run hit its time limit`);
      await this.prisma.inventoryImport
        .updateMany({
          where: { id: importId, photoStatus: { in: ['PENDING', 'RUNNING'] } },
          data: {
            photoStatus: 'FAILED',
            photosFetched: fetched,
            photosReused: reused,
            photosFailed: failed,
            photoErrors: [
              ...errors,
              timedOut ? TIMED_OUT_MESSAGE : 'The photo run stopped early.',
            ].slice(-20),
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
    control?: RunControl,
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
      // A stopped run starts nothing new; the downloads already in flight
      // finish, bounded by their own timeouts.
      if (control?.stopped) return;
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
      await control?.beat();
    });

    // Stopped part-way: write nothing. The photos this vehicle already had are
    // kept as they were — the slots never reached would otherwise read as
    // photos the feed dropped, and be deleted — and the copies made just now
    // are released, since no listing points at them.
    if (control?.stopped) {
      await this.vehicleImages.releaseUnused(
        slots.flatMap((slot) =>
          slot?.assetId && !existing.some((image) => image.assetId === slot.assetId)
            ? [slot.assetId]
            : [],
        ),
      );
      return { fetched, reused: 0, failed, changed: false };
    }

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
