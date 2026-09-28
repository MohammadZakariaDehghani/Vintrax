import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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
import { PROMO_VIDEO, type UserRole } from '@vintrax/shared';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { VideoProcessor } from '../../common/media/video-processor';
import { StorageService } from '../../common/storage/storage.service';
import { validateEnv, type Env } from '../../config/env';
import { PromoVideoUploadsController } from './promo-video-uploads.controller';
import { PromoVideoUploadsService, UPLOAD_IDLE_MS } from './promo-video-uploads.service';

/**
 * Promo tile videos sent in pieces and optimised in the background. No
 * request may carry more than one piece — that is what keeps a proxy's body
 * limit (the HTML 413 an administrator hit) out of the way.
 */

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
const CHUNK = PROMO_VIDEO.chunkBytes;

function user(id: string, role: UserRole): AuthUser {
  return {
    id,
    email: `${id}@example.test`,
    firstName: 'A',
    lastName: 'B',
    role,
    status: 'ACTIVE',
    emailVerified: true,
    dealerId: null,
  };
}
const ADMIN = user('admin-1', 'ADMIN');
const OTHER_ADMIN = user('admin-2', 'ADMIN');
const DEALER = user('dealer-1', 'DEALER');

@Injectable()
class TestIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const caller = [ADMIN, OTHER_ADMIN, DEALER].find((u) => u.id === req.headers['x-test-user']);
    if (caller) req.user = caller;
    return true;
  }
}

describe('chunked promo video upload', () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'vintrax-chunk-api-'));
  let app: INestApplication;
  let service: PromoVideoUploadsService;

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
    service = new PromoVideoUploadsService(new VideoProcessor(config), new StorageService(config));
    const moduleRef = await Test.createTestingModule({
      controllers: [PromoVideoUploadsController],
      providers: [
        { provide: PromoVideoUploadsService, useValue: service },
        { provide: APP_GUARD, useClass: TestIdentityGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const start = (as: AuthUser, body: Record<string, unknown>) =>
    http().post('/uploads/promo-tiles/video/sessions').set('x-test-user', as.id).send(body);
  const piece = (as: AuthUser, id: string, index: number, bytes: Buffer) =>
    http()
      .post(`/uploads/promo-tiles/video/sessions/${id}/chunks/${index}`)
      .set('x-test-user', as.id)
      .attach('file', bytes, { filename: 'piece', contentType: 'application/octet-stream' });

  it('is for content administrators only', async () => {
    await http()
      .post('/uploads/promo-tiles/video/sessions')
      .send({ sizeBytes: 10, contentType: 'video/mp4' })
      .expect(403);
    await start(DEALER, { sizeBytes: 10, contentType: 'video/mp4' }).expect(403);
  });

  it('refuses a file too large or of the wrong type before anything is sent', async () => {
    await start(ADMIN, {
      sizeBytes: PROMO_VIDEO.maxUploadBytes + 1,
      contentType: 'video/mp4',
    }).expect(400);
    await start(ADMIN, { sizeBytes: 100, contentType: 'image/gif' }).expect(400);
  });

  it('splits a large file into pieces that each fit under a 16 MB proxy limit', async () => {
    const response = await start(ADMIN, {
      sizeBytes: 90 * 1024 * 1024,
      contentType: 'video/mp4',
    }).expect(201);
    expect(response.body.chunkBytes).toBeLessThan(16 * 1024 * 1024);
    expect(response.body.chunkCount).toBe(Math.ceil((90 * 1024 * 1024) / CHUNK));
  });

  it('takes pieces only in order, only at the right size, and only from the uploader', async () => {
    const size = CHUNK + 100;
    const { body } = await start(ADMIN, { sizeBytes: size, contentType: 'video/mp4' }).expect(201);

    await piece(ADMIN, body.uploadId, 1, Buffer.alloc(100)).expect(409);
    await piece(ADMIN, body.uploadId, 0, Buffer.alloc(CHUNK - 1)).expect(400);
    await piece(OTHER_ADMIN, body.uploadId, 0, Buffer.alloc(CHUNK)).expect(404);
    await piece(ADMIN, body.uploadId, 0, Buffer.alloc(CHUNK)).expect(200);

    // Not all bytes are in yet.
    await http()
      .post(`/uploads/promo-tiles/video/sessions/${body.uploadId}/complete`)
      .set('x-test-user', ADMIN.id)
      .expect(400);
    await http()
      .get(`/uploads/promo-tiles/video/sessions/${body.uploadId}`)
      .set('x-test-user', OTHER_ADMIN.id)
      .expect(404);
  });

  it('forgets an abandoned upload and deletes what was sent', async () => {
    const { body } = await start(ADMIN, { sizeBytes: 5, contentType: 'video/mp4' }).expect(201);
    expect(await service.sweep(Date.now() + UPLOAD_IDLE_MS + 1)).toBeGreaterThanOrEqual(1);
    await http()
      .get(`/uploads/promo-tiles/video/sessions/${body.uploadId}`)
      .set('x-test-user', ADMIN.id)
      .expect(404);
  });

  it('reports a file that is not a video as failed, in words, and keeps nothing', async () => {
    const bytes = Buffer.from('this is not a video file at all');
    const { body } = await start(ADMIN, {
      sizeBytes: bytes.length,
      contentType: 'video/mp4',
    }).expect(201);
    await piece(ADMIN, body.uploadId, 0, bytes).expect(200);
    await http()
      .post(`/uploads/promo-tiles/video/sessions/${body.uploadId}/complete`)
      .set('x-test-user', ADMIN.id)
      .expect(202);

    let status = { status: 'PROCESSING', error: null as string | null };
    for (let i = 0; i < 50 && status.status === 'PROCESSING'; i += 1) {
      await new Promise((done) => setTimeout(done, 100));
      status = (
        await http()
          .get(`/uploads/promo-tiles/video/sessions/${body.uploadId}`)
          .set('x-test-user', ADMIN.id)
      ).body;
    }
    expect(status.status).toBe('FAILED');
    expect(status.error).toMatch(/could not|not available/i);
  });

  (hasFfmpeg ? it : it.skip)(
    'optimises a multi-piece video in the background and returns a silent MP4 and poster',
    async () => {
      const clipDir = mkdtempSync(join(tmpdir(), 'vintrax-chunk-clip-'));
      const clip = join(clipDir, 'clip.mp4');
      // Noise does not compress, so this is bigger than one piece.
      execFileSync(FFMPEG, [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'nullsrc=size=640x360:rate=30,geq=random(1)*255:128:128',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '8',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        clip,
      ]);
      const bytes = readFileSync(clip);
      expect(bytes.length).toBeGreaterThan(CHUNK);

      const { body } = await start(ADMIN, {
        sizeBytes: bytes.length,
        contentType: 'video/mp4',
      }).expect(201);
      for (let index = 0; index < body.chunkCount; index += 1) {
        await piece(
          ADMIN,
          body.uploadId,
          index,
          bytes.subarray(index * CHUNK, (index + 1) * CHUNK),
        ).expect(200);
      }
      const started = await http()
        .post(`/uploads/promo-tiles/video/sessions/${body.uploadId}/complete`)
        .set('x-test-user', ADMIN.id)
        .expect(202);
      // The request returns before the encoder has finished.
      expect(started.body.status).toBe('PROCESSING');

      let status = started.body;
      for (let i = 0; i < 240 && status.status === 'PROCESSING'; i += 1) {
        await new Promise((done) => setTimeout(done, 250));
        status = (
          await http()
            .get(`/uploads/promo-tiles/video/sessions/${body.uploadId}`)
            .set('x-test-user', ADMIN.id)
        ).body;
      }
      expect(status.status).toBe('READY');
      expect(status.result).toMatchObject({ width: 640, height: 360 });

      const stored = join(uploadDir, status.result.videoUrl.replace('/uploads/', ''));
      const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', stored]).stderr.toString();
      expect(probe).toContain('Video: h264');
      // No sound, ever, on the site.
      expect(probe).not.toContain('Audio:');
      // Only the result is kept: no temporary upload left behind.
      expect(readdirSync(tmpdir()).some((name) => name.startsWith('vintrax-promo-video-'))).toBe(
        false,
      );
    },
    90_000,
  );
});
