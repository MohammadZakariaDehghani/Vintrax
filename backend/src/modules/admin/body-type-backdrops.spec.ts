import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { validateEnv, type Env } from '../../config/env';
import { StorageService } from '../../common/storage/storage.service';
import { BodyTypeBackdrops } from './body-type-backdrops';

/**
 * Body-type photos stored before uploads were cut out keep a white box on the
 * dark theme. The start-up pass cuts them out once and then leaves them be.
 */

async function carOnWhite(): Promise<Buffer> {
  const car = await sharp({
    create: { width: 200, height: 80, channels: 3, background: '#c0141e' },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: 400, height: 220, channels: 3, background: '#ffffff' } })
    .composite([{ input: car, left: 100, top: 90 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe('BodyTypeBackdrops', () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'vintrax-backdrops-'));
  const storage = new StorageService(
    new ConfigService<Env, true>(
      validateEnv({
        DATABASE_URL: 'postgresql://unused',
        JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
        JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789',
        UPLOAD_DIR: uploadDir,
      }),
    ),
  );

  function database(rows: Array<{ bodyType: string; imageUrl: string }>) {
    return {
      rows,
      bodyTypeImage: {
        findMany: async () => rows.map((row) => ({ ...row })),
        updateMany: async ({
          where,
          data,
        }: {
          where: { bodyType: string; imageUrl: string };
          data: { imageUrl: string };
        }) => {
          const row = rows.find(
            (r) => r.bodyType === where.bodyType && r.imageUrl === where.imageUrl,
          );
          if (row) row.imageUrl = data.imageUrl;
          return { count: row ? 1 : 0 };
        },
      },
    };
  }

  it('cuts a car out of a white backdrop once, then leaves it alone', async () => {
    mkdirSync(join(uploadDir, 'body-types'), { recursive: true });
    writeFileSync(join(uploadDir, 'body-types', 'sedan.jpg'), await carOnWhite());
    const db = database([{ bodyType: 'SEDAN', imageUrl: '/uploads/body-types/sedan.jpg' }]);
    const pass = new BodyTypeBackdrops(db as never, storage, {
      del: async () => undefined,
    } as never);

    expect(await pass.run()).toBe(1);
    const url = db.rows[0]!.imageUrl;
    expect(url).toMatch(/^\/uploads\/body-types\/[0-9a-f-]{36}\.png$/);

    const png = await sharp(join(uploadDir, url.replace('/uploads/', '')))
      .raw()
      .toBuffer({
        resolveWithObject: true,
      });
    const alphaAt = (x: number, y: number) =>
      png.data[(y * png.info.width + x) * png.info.channels + 3];
    expect(alphaAt(0, 0)).toBe(0); // the white corner is gone
    expect(alphaAt(Math.round(png.info.width / 2), Math.round(png.info.height / 2))).toBe(255);

    // Second start: already transparent, nothing to do.
    expect(await pass.run()).toBe(0);
    expect(db.rows[0]!.imageUrl).toBe(url);
  });

  it('never reads a file it did not issue', async () => {
    const db = database([{ bodyType: 'SUV', imageUrl: 'https://example.com/suv.jpg' }]);
    expect(
      await new BodyTypeBackdrops(db as never, storage, {
        del: async () => undefined,
      } as never).run(),
    ).toBe(0);
    expect(db.rows[0]!.imageUrl).toBe('https://example.com/suv.jpg');
  });
});
