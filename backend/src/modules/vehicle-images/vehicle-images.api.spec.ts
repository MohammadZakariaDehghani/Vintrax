import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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
import { MulterModule } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@vintrax/shared';
import sharp from 'sharp';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IMAGE_STORAGE, LocalImageStorage } from '../../common/storage/image-storage';
import { StorageService } from '../../common/storage/storage.service';
import { VideoProcessor } from '../../common/media/video-processor';
import { validateEnv, type Env } from '../../config/env';
import { UploadsController } from '../uploads/uploads.controller';
import { VehiclesController } from '../vehicles/vehicles.controller';
import { VehiclesService } from '../vehicles/vehicles.service';
import { ImageBackfill } from './image-backfill';
import { VehicleImagesService } from './vehicle-images.service';

/**
 * The upload API end to end (issue #74): the real controllers, the real
 * permissions guard, real image processing and real files on disk. Only the
 * database is an in-memory stand-in, holding just the rows these routes touch.
 */

// --- An in-memory stand-in for the Prisma calls these routes make ----------

interface AssetRow {
  id: string;
  status: string;
  url: string;
  baseUrl: string;
  widths: number[];
  formats: string[];
  width: number | null;
  height: number | null;
  originalKey: string | null;
  legacyUrl: string | null;
  uploadedById: string | null;
  [key: string]: unknown;
}
interface ImageRow {
  id: string;
  vehicleId: string;
  url: string;
  alt: string | null;
  position: number;
  assetId: string | null;
  sourceUrl: string | null;
  sourceUpdatedAt: Date | null;
}

class FakeDatabase {
  readonly assets = new Map<string, AssetRow>();
  images: ImageRow[] = [];
  readonly vehicles = new Map<string, { id: string; sellerId: string }>();

  private withAsset(image: ImageRow) {
    const asset = image.assetId ? this.assets.get(image.assetId) : undefined;
    return { ...image, asset: asset ?? null };
  }

  private referenced(assetId: string): boolean {
    return this.images.some((image) => image.assetId === assetId);
  }

  readonly vehicle = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const vehicle = this.vehicles.get(where.id);
      return vehicle ? { ...vehicle, title: 'Test car', status: 'DRAFT', publishedAt: null } : null;
    },
  };

  readonly vehicleImageAsset = {
    create: async ({ data }: { data: Partial<AssetRow> }) => {
      const row: AssetRow = {
        id: randomUUID(),
        status: 'PROCESSING',
        url: '',
        baseUrl: '',
        widths: [],
        formats: [],
        width: null,
        height: null,
        originalKey: null,
        legacyUrl: null,
        uploadedById: null,
        ...data,
      };
      this.assets.set(row.id, row);
      return { id: row.id };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<AssetRow> }) =>
      Object.assign(this.assets.get(where.id)!, data),
    findUnique: async ({ where }: { where: { legacyUrl: string } }) =>
      [...this.assets.values()].find((asset) => asset.legacyUrl === where.legacyUrl) ?? null,
    delete: async ({ where }: { where: { id: string } }) => this.assets.delete(where.id),
    deleteMany: async ({ where }: { where: { id: string } }) => {
      this.assets.delete(where.id);
      return { count: 1 };
    },
    findMany: async ({ where }: { where: Record<string, any> }) =>
      [...this.assets.values()].filter((asset) => {
        if (where.id?.in && !where.id.in.includes(asset.id)) return false;
        if (where.url?.in && !where.url.in.includes(asset.url)) return false;
        if (where.status && asset.status !== where.status) return false;
        if (where.images?.none && this.referenced(asset.id)) return false;
        if (where.OR) {
          return where.OR.some((clause: Record<string, any>) =>
            clause.uploadedById
              ? asset.uploadedById === clause.uploadedById
              : this.images.some(
                  (image) =>
                    image.assetId === asset.id && image.vehicleId === clause.images.some.vehicleId,
                ),
          );
        }
        return true;
      }),
  };

  readonly vehicleImage = {
    count: async ({ where }: { where: { vehicleId: string } }) =>
      this.images.filter((image) => image.vehicleId === where.vehicleId).length,
    create: async ({ data }: { data: Partial<ImageRow> }) => {
      const row: ImageRow = {
        id: randomUUID(),
        vehicleId: data.vehicleId!,
        url: data.url!,
        alt: null,
        position: data.position ?? 0,
        assetId: data.assetId ?? null,
        sourceUrl: null,
        sourceUpdatedAt: null,
      };
      this.images.push(row);
      return this.withAsset(row);
    },
    // A copy, as Prisma returns: the caller must not see later writes.
    findFirst: async ({ where }: { where: { id: string; vehicleId: string } }) => {
      const row = this.images.find(
        (image) => image.id === where.id && image.vehicleId === where.vehicleId,
      );
      return row ? { ...row } : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<ImageRow> }) => {
      const row = this.images.find((image) => image.id === where.id)!;
      Object.assign(row, data);
      return this.withAsset(row);
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.images = this.images.filter((image) => image.id !== where.id);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, any>;
      data: Record<string, any>;
    }) => {
      for (const image of this.images) {
        if (where.vehicleId && image.vehicleId !== where.vehicleId) continue;
        if (where.position?.gt !== undefined && !(image.position > where.position.gt)) continue;
        if (where.url && image.url !== where.url) continue;
        if (where.assetId === null && image.assetId !== null) continue;
        if (data.position?.decrement) image.position -= data.position.decrement;
        if (data.assetId) image.assetId = data.assetId;
        if (data.url) image.url = data.url;
      }
      return { count: 0 };
    },
    findMany: async ({ where }: { where: Record<string, any> }) =>
      this.images
        .filter((image) => (where.vehicleId ? image.vehicleId === where.vehicleId : true))
        .filter((image) => (where.assetId === null ? image.assetId === null : true))
        .map((image) => ({
          ...image,
          vehicle: { sellerId: this.vehicles.get(image.vehicleId)!.sellerId },
        })),
  };

  $transaction = async (operations: Array<Promise<unknown>>) => Promise.all(operations);
}

// --- Test harness ----------------------------------------------------------

const DEALER_A = user('DEALER');
const DEALER_B = user('DEALER');
const BUYER = user('BUYER');

function user(role: UserRole): AuthUser {
  return {
    id: randomUUID(),
    email: `${role.toLowerCase()}-${randomUUID()}@example.com`,
    role,
    status: 'ACTIVE',
    emailVerified: true,
  } as AuthUser;
}

/** Stands in for JWT authentication: the test names who is calling. */
@Injectable()
class TestIdentityGuard implements CanActivate {
  static users = new Map<string, AuthUser>();
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const caller = TestIdentityGuard.users.get(req.headers['x-test-user'] ?? '');
    if (caller) req.user = caller;
    return true;
  }
}
for (const caller of [DEALER_A, DEALER_B, BUYER]) TestIdentityGuard.users.set(caller.id, caller);

const uploadDir = mkdtempSync(join(tmpdir(), 'vintrax-image-api-'));
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const config = new ConfigService<Env, true>(
  validateEnv({
    DATABASE_URL: 'postgresql://unused',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789',
    UPLOAD_DIR: uploadDir,
    IMAGE_MAX_UPLOAD_BYTES: String(MAX_UPLOAD_BYTES),
    IMAGE_VARIANT_WIDTHS: '320,640,960',
  }),
);

async function jpeg(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 31) % 256;
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

function onDisk(url: string): boolean {
  return existsSync(join(uploadDir, url.replace(/^\/uploads\//, '')));
}

describe('vehicle photo API', () => {
  let app: INestApplication;
  let db: FakeDatabase;
  let images: VehicleImagesService;
  let vehicleId: string;

  beforeAll(async () => {
    db = new FakeDatabase();
    images = new VehicleImagesService(db as never, new LocalImageStorage(uploadDir), config);

    const vehicles = Object.create(VehiclesService.prototype) as VehiclesService;
    // Search reindexing and cache invalidation are not what these tests are about.
    Object.assign(vehicles, {
      prisma: db,
      vehicleImages: images,
      afterWrite: async () => undefined,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [MulterModule.register({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })],
      controllers: [UploadsController, VehiclesController],
      providers: [
        { provide: VehicleImagesService, useValue: images },
        { provide: VehiclesService, useValue: vehicles },
        { provide: StorageService, useValue: {} },
        // The promo video route shares the controller; nothing here uses it.
        { provide: VideoProcessor, useValue: {} },
        { provide: PrismaService, useValue: db },
        { provide: IMAGE_STORAGE, useValue: new LocalImageStorage(uploadDir) },
        { provide: APP_GUARD, useClass: TestIdentityGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    vehicleId = randomUUID();
    db.vehicles.set(vehicleId, { id: vehicleId, sellerId: DEALER_A.id });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /uploads/images', () => {
    it('processes an authorized upload into WebP renditions on disk', async () => {
      const response = await request(app.getHttpServer())
        .post('/uploads/images')
        .set('x-test-user', DEALER_A.id)
        .attach('file', await jpeg(1600, 1200), {
          filename: 'IMG_0001.JPG',
          contentType: 'image/jpeg',
        })
        .expect(201);

      const body = response.body;
      expect(body.url).toMatch(/^\/uploads\/vehicles\/[0-9a-f-]{36}\/960\.webp$/);
      expect(body.optimized.width).toBe(1600);
      expect(body.optimized.height).toBe(1200);
      expect(body.optimized.webp.map((source: { width: number }) => source.width)).toEqual([
        320, 640, 960, 1600,
      ]);
      expect(body.originalWidth).toBe(1600);
      for (const source of body.optimized.webp) expect(onDisk(source.url)).toBe(true);
      // The original is kept, but outside every publicly served folder.
      expect(existsSync(join(uploadDir, 'vehicle-originals', body.id, 'original.jpg'))).toBe(true);
      expect(db.assets.get(body.id)?.status).toBe('READY');
    });

    it('refuses an anonymous caller', async () => {
      await request(app.getHttpServer())
        .post('/uploads/images')
        .attach('file', await jpeg(100, 100), 'car.jpg')
        .expect(403);
    });

    it('refuses an account without vehicle:write', async () => {
      await request(app.getHttpServer())
        .post('/uploads/images')
        .set('x-test-user', BUYER.id)
        .attach('file', await jpeg(100, 100), 'car.jpg')
        .expect(403);
    });

    it('refuses a non-image with an image name and type, storing nothing', async () => {
      const before = db.assets.size;
      const response = await request(app.getHttpServer())
        .post('/uploads/images')
        .set('x-test-user', DEALER_A.id)
        .attach('file', Buffer.from('<?php system($_GET["c"]); ?>'), {
          filename: 'car.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);
      expect(response.body.message).toMatch(/not a readable image/);
      expect(db.assets.size).toBe(before);
    });

    it('refuses a file over the upload limit before processing it', async () => {
      await request(app.getHttpServer())
        .post('/uploads/images')
        .set('x-test-user', DEALER_A.id)
        .attach('file', Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 1), 'huge.jpg')
        .expect(413);
    });
  });

  describe('per-vehicle photos', () => {
    it('lets the owner add a photo to their listing', async () => {
      const response = await request(app.getHttpServer())
        .post(`/vehicles/${vehicleId}/images`)
        .set('x-test-user', DEALER_A.id)
        .attach('file', await jpeg(800, 600), 'car.jpg')
        .expect(201);
      expect(response.body.position).toBe(0);
      expect(response.body.optimized.webp).toHaveLength(3);
    });

    it("refuses another dealer's listing", async () => {
      const before = db.assets.size;
      await request(app.getHttpServer())
        .post(`/vehicles/${vehicleId}/images`)
        .set('x-test-user', DEALER_B.id)
        .attach('file', await jpeg(800, 600), 'car.jpg')
        .expect(403);
      // Ownership is checked before any processing happens.
      expect(db.assets.size).toBe(before);
    });

    it('deletes a photo with every rendition and the original, idempotently', async () => {
      const added = await request(app.getHttpServer())
        .post(`/vehicles/${vehicleId}/images`)
        .set('x-test-user', DEALER_A.id)
        .attach('file', await jpeg(800, 600), 'car.jpg')
        .expect(201);
      const asset = [...db.assets.values()].find((row) => row.url === added.body.url)!;
      const urls = added.body.optimized.webp.map((source: { url: string }) => source.url);
      expect(urls.every(onDisk)).toBe(true);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await request(app.getHttpServer())
          .delete(`/vehicles/${vehicleId}/images/${added.body.id}`)
          .set('x-test-user', DEALER_A.id)
          .expect(204);
      }

      expect(urls.some(onDisk)).toBe(false);
      expect(existsSync(join(uploadDir, asset.originalKey!))).toBe(false);
      expect(db.assets.has(asset.id)).toBe(false);
    });

    it("refuses to delete another dealer's photo", async () => {
      const added = await request(app.getHttpServer())
        .post(`/vehicles/${vehicleId}/images`)
        .set('x-test-user', DEALER_A.id)
        .attach('file', await jpeg(400, 300), 'car.jpg')
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/vehicles/${vehicleId}/images/${added.body.id}`)
        .set('x-test-user', DEALER_B.id)
        .expect(403);
      expect(onDisk(added.body.url)).toBe(true);
    });

    it('replaces a photo in place: new files first, then the old ones go', async () => {
      const first = await request(app.getHttpServer())
        .post(`/vehicles/${vehicleId}/images`)
        .set('x-test-user', DEALER_A.id)
        .attach('file', await jpeg(800, 600), 'first.jpg')
        .expect(201);
      const oldUrls = first.body.optimized.webp.map((source: { url: string }) => source.url);

      const replaced = await request(app.getHttpServer())
        .put(`/vehicles/${vehicleId}/images/${first.body.id}`)
        .set('x-test-user', DEALER_A.id)
        .attach('file', await jpeg(1200, 800), 'second.jpg')
        .expect(200);

      expect(replaced.body.id).toBe(first.body.id);
      expect(replaced.body.position).toBe(first.body.position);
      expect(replaced.body.url).not.toBe(first.body.url);
      expect(
        replaced.body.optimized.webp.map((source: { url: string }) => source.url).every(onDisk),
      ).toBe(true);
      expect(oldUrls.some(onDisk)).toBe(false);
    });
  });

  describe('attaching uploads to a listing', () => {
    it("only attaches an asset for its uploader, so one seller cannot adopt another's", async () => {
      const uploaded = await images.ingest(await jpeg(400, 300), { uploadedById: DEALER_A.id });
      const forOwner = await images.assetIdsFor([uploaded.url], {
        userId: DEALER_A.id,
        isAdmin: false,
      });
      const forOther = await images.assetIdsFor([uploaded.url], {
        userId: DEALER_B.id,
        isAdmin: false,
      });
      expect(forOwner.get(uploaded.url)).toBe(uploaded.id);
      expect(forOther.size).toBe(0);
    });
  });

  describe('images:migrate', () => {
    it('processes a legacy photo once, links it, and does nothing on a second run', async () => {
      const legacyUrl = `/uploads/vehicles/${randomUUID()}.jpg`;
      mkdirSync(join(uploadDir, 'vehicles'), { recursive: true });
      writeFileSync(join(uploadDir, legacyUrl.replace('/uploads/', '')), await jpeg(1000, 750));
      db.images.push(
        ...[0, 1].map((position) => ({
          id: randomUUID(),
          vehicleId,
          url: legacyUrl,
          alt: null,
          position,
          assetId: null,
          sourceUrl: null,
          sourceUpdatedAt: null,
        })),
      );
      const svgUrl = '/uploads/seed/placeholder.svg';
      mkdirSync(join(uploadDir, 'seed'), { recursive: true });
      writeFileSync(
        join(uploadDir, 'seed/placeholder.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
      );
      db.images.push({
        id: randomUUID(),
        vehicleId,
        url: svgUrl,
        alt: null,
        position: 2,
        assetId: null,
        sourceUrl: null,
        sourceUpdatedAt: null,
      });

      const backfill = new ImageBackfill(db as never, images);

      const dry = await backfill.run({ dryRun: true, vehicleId });
      expect(dry.counts['would-process']).toBe(1);
      expect(dry.counts['skipped-unsupported']).toBe(1);
      expect(
        db.images.filter((image) => image.vehicleId === vehicleId && image.assetId),
      ).toHaveLength(0);

      const first = await backfill.run({ dryRun: false, vehicleId });
      expect(first.counts.processed).toBe(1);
      const linked = db.images.filter((image) => image.vehicleId === vehicleId && image.assetId);
      expect(linked).toHaveLength(2);
      expect(new Set(linked.map((image) => image.assetId)).size).toBe(1);
      expect(linked[0]!.url).toMatch(/\/960\.webp$/);
      // The legacy file is left exactly where it was.
      expect(onDisk(legacyUrl)).toBe(true);

      const assetsAfterFirst = db.assets.size;
      const second = await backfill.run({ dryRun: false, vehicleId });
      expect(second.counts.processed).toBe(0);
      expect(db.assets.size).toBe(assetsAfterFirst);
    });
  });
});
