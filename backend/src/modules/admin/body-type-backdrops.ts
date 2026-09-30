import { readFile } from 'node:fs/promises';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { StorageService } from '../../common/storage/storage.service';
import { removeFlatBackground } from '../uploads/remove-background';
import { BODY_TYPE_IMAGE_CACHE_KEY } from './admin.service';

/** A body-type photo is small; anything this large is not one and is left alone. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Cuts the flat backdrop out of body-type photos stored before uploads were
 * cut out automatically, so a car on a white studio backdrop stops showing a
 * white box on the dark theme.
 *
 * Runs once per start, in the background. It is idempotent without any
 * bookkeeping: `removeFlatBackground` returns null for a photo that is already
 * transparent, and for one with no flat backdrop to remove (a scene), so a
 * processed or unsuitable photo is left exactly as it is. Only files this
 * service's own storage issued are read — never an arbitrary URL.
 */
@Injectable()
export class BodyTypeBackdrops implements OnApplicationBootstrap {
  private readonly logger = new Logger(BodyTypeBackdrops.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['NODE_ENV'] === 'test') return;
    void this.run().catch((error: unknown) =>
      this.logger.warn(`Body-type backdrop pass failed: ${String(error)}`),
    );
  }

  /** Returns how many photos were cut out. */
  async run(): Promise<number> {
    const rows = await this.prisma.bodyTypeImage.findMany({
      select: { bodyType: true, imageUrl: true },
    });
    let changed = 0;
    for (const row of rows) {
      try {
        const original = await this.read(row.imageUrl);
        if (!original) continue;
        const cutOut = await removeFlatBackground(original);
        if (!cutOut) continue;

        const stored = await this.storage.uploadImage({
          folder: 'body-types',
          buffer: cutOut,
          contentType: 'image/png',
          originalName: 'cut-out.png',
        });
        // Only replace the row if nobody changed it meanwhile.
        const updated = await this.prisma.bodyTypeImage.updateMany({
          where: { bodyType: row.bodyType, imageUrl: row.imageUrl },
          data: { imageUrl: stored.url },
        });
        if (updated.count === 1) {
          changed += 1;
          this.logger.log(`Cut the backdrop out of the ${row.bodyType} photo`);
        } else {
          await this.storage.delete(stored.key);
        }
      } catch (error) {
        this.logger.warn(`Could not process the ${row.bodyType} photo: ${String(error)}`);
      }
    }
    // The home page reads these through a cache; drop it so the new photos show.
    if (changed > 0) await this.redis.del(BODY_TYPE_IMAGE_CACHE_KEY);
    return changed;
  }

  private async read(url: string): Promise<Buffer | null> {
    if (!this.storage.isOwnUrl(url)) return null;
    const location = this.storage.resolveStored(url);
    if (location.kind === 'local') {
      const data = await readFile(location.path).catch(() => null);
      return data && data.byteLength <= MAX_BYTES ? data : null;
    }
    const response = await fetch(location.url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());
    return data.byteLength <= MAX_BYTES ? data : null;
  }
}
