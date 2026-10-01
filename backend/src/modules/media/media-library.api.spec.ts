import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { mediaPresentationInputSchema, type UserRole } from '@vintrax/shared';
import sharp from 'sharp';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { VideoProcessor } from '../../common/media/video-processor';
import { IMAGE_STORAGE, LocalImageStorage } from '../../common/storage/image-storage';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { validateEnv, type Env } from '../../config/env';
import { PromoVideoUploadsService } from '../uploads/promo-video-uploads.service';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService, labelFromFilename } from './media-library.service';

/**
 * The media library end to end: who may use it, what it accepts, what it
 * keeps, and that content can only ever point at files it issued.
 */

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;

function user(role: UserRole): AuthUser {
  return {
    id: randomUUID(),
    email: `${role.toLowerCase()}@example.test`,
    firstName: 'A',
    lastName: 'B',
    role,
    status: 'ACTIVE',
    emailVerified: true,
    dealerId: null,
  };
}
const ADMIN = user('ADMIN');
const DEALER = user('DEALER');

@Injectable()
class TestIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const caller = [ADMIN, DEALER].find((entry) => entry.id === req.headers['x-test-user']);
    if (caller) req.user = caller;
    return true;
  }
}

/** Just enough of Prisma for the library: assets in memory, content the tests set. */
function fakePrisma() {
  const assets = new Map<string, Record<string, unknown>>();
  const content = {
    hero: [] as Array<Record<string, unknown>>,
    articles: [] as Array<Record<string, unknown>>,
    features: [] as Array<Record<string, unknown>>,
    tiles: [] as Array<Record<string, unknown>>,
  };
  const prisma = {
    content,
    mediaAsset: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          alt: null,
          posterUrl: null,
          smallUrl: null,
          baseUrl: null,
          widths: [],
          formats: [],
          width: null,
          height: null,
          durationSeconds: null,
          createdById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        assets.set(row.id as string, row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => assets.get(where.id) ?? null,
      ),
      findMany: jest.fn(async () => [...assets.values()]),
      count: jest.fn(async () => assets.size),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        const row = { ...assets.get(where.id)!, ...data };
        assets.set(where.id, row);
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => assets.delete(where.id)),
    },
    homeHero: { findMany: jest.fn(async () => content.hero) },
    article: { findMany: jest.fn(async () => content.articles) },
    homeFeature: { findMany: jest.fn(async () => content.features) },
    promoTile: { findMany: jest.fn(async () => content.tiles) },
  };
  return prisma;
}

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#b01e28' } })
    .png()
    .toBuffer();
}

describe('media library', () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'vintrax-media-api-'));
  const clipDir = mkdtempSync(join(tmpdir(), 'vintrax-media-clip-'));
  const prisma = fakePrisma();
  let app: INestApplication;
  let library: MediaLibraryService;

  beforeAll(async () => {
    const config = new ConfigService<Env, true>(
      validateEnv({
        DATABASE_URL: 'postgresql://unused',
        JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
        JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789',
        UPLOAD_DIR: uploadDir,
        FFMPEG_PATH: FFMPEG,
      }),
    );
    const storage = new StorageService(config);
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaLibraryController],
      providers: [
        MediaLibraryService,
        PromoVideoUploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: IMAGE_STORAGE, useValue: new LocalImageStorage(uploadDir) },
        { provide: ConfigService, useValue: config },
        { provide: VideoProcessor, useValue: new VideoProcessor(config) },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: APP_GUARD, useClass: TestIdentityGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    library = moduleRef.get(MediaLibraryService);
  });

  afterAll(() => app.close());

  const as = (who: AuthUser | null, req: request.Test) =>
    who ? req.set('x-test-user', who.id) : req;
  const uploadImage = (who: AuthUser | null, file: Buffer, filename: string, contentType: string) =>
    as(who, request(app.getHttpServer()).post('/uploads/media/images')).attach('file', file, {
      filename,
      contentType,
    });

  it('is for content administrators only', async () => {
    const file = await png(800, 450);
    await uploadImage(null, file, 'a.png', 'image/png').expect(403);
    await uploadImage(DEALER, file, 'a.png', 'image/png').expect(403);
    await as(DEALER, request(app.getHttpServer()).get('/admin/media')).expect(403);
    await as(null, request(app.getHttpServer()).delete(`/admin/media/${randomUUID()}`)).expect(403);
    await as(DEALER, request(app.getHttpServer()).post('/uploads/media/videos/sessions'))
      .send({ sizeBytes: 10, contentType: 'video/mp4' })
      .expect(403);
  });

  it('stores a picture only as responsive WebP renditions under a generated name', async () => {
    const response = await uploadImage(
      ADMIN,
      await png(2400, 1350),
      '../../etc/passwd Hero shot.png',
      'image/png',
    ).expect(201);

    const asset = response.body;
    expect(asset.kind).toBe('IMAGE');
    // The label comes from the filename with the folders stripped.
    expect(asset.label).toBe('passwd Hero shot');
    expect(asset).not.toHaveProperty('storageKeys');
    expect(asset.url).toMatch(new RegExp(`^/uploads/media/${asset.id}/\\d+\\.webp$`));
    expect(asset.image.webp.map((source: { width: number }) => source.width)).toEqual([
      320, 640, 960, 1440, 1920,
    ]);
    const stored = readdirSync(join(uploadDir, 'media', asset.id));
    expect(stored.every((name) => /^\d+\.webp$/.test(name))).toBe(true);
    expect(existsSync(join(uploadDir, 'etc'))).toBe(false);
  });

  it('judges a file by its bytes, not by its name or declared type', async () => {
    const before = existsSync(join(uploadDir, 'media'))
      ? readdirSync(join(uploadDir, 'media'))
      : [];
    await uploadImage(
      ADMIN,
      Buffer.from('<html><script>alert(1)</script></html>'),
      'photo.png',
      'image/png',
    ).expect(400);
    await uploadImage(
      ADMIN,
      Buffer.from('MZ\x90\x00 not a picture'),
      'setup.exe',
      'application/x-msdownload',
    ).expect(400);
    const after = existsSync(join(uploadDir, 'media')) ? readdirSync(join(uploadDir, 'media')) : [];
    expect(after).toEqual(before);
  });

  it('refuses a picture too small to look sharp', async () => {
    const response = await uploadImage(ADMIN, await png(120, 90), 'tiny.png', 'image/png').expect(
      400,
    );
    expect(response.body.message).toMatch(/at least 320×180/);
  });

  it('will not delete what the site still shows, and names where', async () => {
    const { body: asset } = await uploadImage(
      ADMIN,
      await png(800, 450),
      'in-use.png',
      'image/png',
    ).expect(201);
    prisma.content.features.push({
      id: randomUUID(),
      title: 'Winter tyres',
      media: { desktop: { assetId: asset.id } },
      imageUrl: null,
    });

    const refused = await as(
      ADMIN,
      request(app.getHttpServer()).delete(`/admin/media/${asset.id}`),
    ).expect(409);
    expect(refused.body.message).toContain('Winter tyres');
    expect(existsSync(join(uploadDir, 'media', asset.id))).toBe(true);

    prisma.content.features.length = 0;
    await as(ADMIN, request(app.getHttpServer()).delete(`/admin/media/${asset.id}`)).expect(204);
    expect(existsSync(join(uploadDir, 'media', asset.id))).toBe(false);
  });

  it('counts a legacy URL column as a use too', async () => {
    const { body: asset } = await uploadImage(
      ADMIN,
      await png(800, 450),
      'poster.png',
      'image/png',
    ).expect(201);
    prisma.content.articles.push({
      id: randomUUID(),
      title: 'EV guide',
      media: null,
      heroImageUrl: asset.url,
    });
    const usage = await as(
      ADMIN,
      request(app.getHttpServer()).get(`/admin/media/${asset.id}/usage`),
    ).expect(200);
    expect(usage.body).toEqual([expect.objectContaining({ type: 'ARTICLE', title: 'EV guide' })]);
    prisma.content.articles.length = 0;
  });

  describe('turning a choice of media into what content stores', () => {
    it('fills in a library asset’s URLs, so the browser never supplies them', async () => {
      const { body: asset } = await uploadImage(
        ADMIN,
        await png(1600, 900),
        'a.png',
        'image/png',
      ).expect(201);
      const resolved = await library.resolve(
        mediaPresentationInputSchema.parse({ kind: 'IMAGE', desktop: { assetId: asset.id } }),
      );
      expect(resolved).toMatchObject({
        kind: 'IMAGE',
        desktop: { assetId: asset.id, url: asset.url },
        mobile: null,
        fit: 'COVER',
        position: 'CENTER',
        animation: { type: 'FADE', onScroll: true },
      });
    });

    it('refuses a picture where a video was asked for', async () => {
      const { body: asset } = await uploadImage(
        ADMIN,
        await png(1600, 900),
        'b.png',
        'image/png',
      ).expect(201);
      await expect(
        library.resolve(
          mediaPresentationInputSchema.parse({ kind: 'VIDEO', desktop: { assetId: asset.id } }),
        ),
      ).rejects.toThrow(/Choose a video/);
    });

    it('refuses an asset that is not in the library', async () => {
      await expect(
        library.resolve(
          mediaPresentationInputSchema.parse({ kind: 'IMAGE', desktop: { assetId: randomUUID() } }),
        ),
      ).rejects.toThrow(/no longer in the media library/);
    });

    it('accepts an older plain URL only when Vintrax issued it', async () => {
      await expect(
        library.resolve(
          mediaPresentationInputSchema.parse({
            kind: 'IMAGE',
            desktop: { url: 'https://tracker.example/pixel.png' },
          }),
        ),
      ).rejects.toThrow(/uploaded to Vintrax first/);
      await expect(
        library.resolve(
          mediaPresentationInputSchema.parse({
            kind: 'IMAGE',
            desktop: { url: '/uploads/home-features/x.jpg' },
          }),
        ),
      ).resolves.toMatchObject({ desktop: { assetId: null, url: '/uploads/home-features/x.jpg' } });
    });

    it('keeps animation timing within bounds', () => {
      expect(
        mediaPresentationInputSchema.safeParse({
          kind: 'IMAGE',
          desktop: { url: '/uploads/a.jpg' },
          animation: { type: 'FADE', durationMs: 60_000 },
        }).success,
      ).toBe(false);
    });
  });

  it('makes a safe label from any filename', () => {
    expect(labelFromFilename('C:\\Users\\me\\<script>.png', 'Picture')).toBe('script');
    expect(labelFromFilename(undefined, 'Picture')).toBe('Picture');
  });

  (hasFfmpeg ? it : it.skip)(
    'adds a video in pieces, with a poster and a phone rendition, and reports the new asset',
    async () => {
      const clip = join(clipDir, 'clip.mp4');
      execFileSync(FFMPEG, [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1920x1080:rate=30',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        clip,
      ]);
      const bytes = readFileSync(clip);
      const server = app.getHttpServer();

      const { body: session } = await as(
        ADMIN,
        request(server).post('/uploads/media/videos/sessions'),
      )
        .send({ sizeBytes: bytes.length, contentType: 'video/mp4', label: 'Showroom loop' })
        .expect(201);
      for (let index = 0; index < session.chunkCount; index += 1) {
        const piece = bytes.subarray(index * session.chunkBytes, (index + 1) * session.chunkBytes);
        await as(
          ADMIN,
          request(server).post(
            `/uploads/media/videos/sessions/${session.uploadId}/chunks/${index}`,
          ),
        )
          .attach('file', piece, { filename: 'piece', contentType: 'application/octet-stream' })
          .expect(200);
      }
      await as(
        ADMIN,
        request(server).post(`/uploads/media/videos/sessions/${session.uploadId}/complete`),
      ).expect(202);

      let status = { status: 'PROCESSING', assetId: null as string | null, error: null };
      for (let attempt = 0; attempt < 120 && status.status === 'PROCESSING'; attempt += 1) {
        await new Promise((done) => setTimeout(done, 250));
        status = (
          await as(ADMIN, request(server).get(`/uploads/media/videos/sessions/${session.uploadId}`))
        ).body;
      }
      expect(status).toMatchObject({ status: 'READY', error: null });
      expect(status).not.toHaveProperty('result');

      const { body: asset } = await as(
        ADMIN,
        request(server).get(`/admin/media/${status.assetId}`),
      ).expect(200);
      expect(asset).toMatchObject({ kind: 'VIDEO', label: 'Showroom loop', width: 1920 });
      expect(asset.url).toMatch(/^\/uploads\/media\/[0-9a-f-]{36}\.mp4$/);
      expect(asset.posterUrl).toMatch(/^\/uploads\/media\/[0-9a-f-]{36}\.webp$/);
      expect(asset.smallUrl).toMatch(/^\/uploads\/media\/[0-9a-f-]{36}\.mp4$/);
      const small = readFileSync(join(uploadDir, asset.smallUrl.replace('/uploads/', '')));
      expect(small.length).toBeLessThan(
        readFileSync(join(uploadDir, asset.url.replace('/uploads/', ''))).length,
      );
    },
    120_000,
  );
});
