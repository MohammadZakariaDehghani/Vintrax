import { execFileSync, spawnSync } from 'node:child_process';
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
import type { UserRole } from '@vintrax/shared';
import request from 'supertest';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { VideoProcessor } from '../../common/media/video-processor';
import { StorageService } from '../../common/storage/storage.service';
import { validateEnv, type Env } from '../../config/env';
import { VehicleImagesService } from '../vehicle-images/vehicle-images.service';
import { UploadsController } from './uploads.controller';

/** `POST /uploads/promo-tiles/video` end to end: guard, validation, ffmpeg and storage. */

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;

function user(role: UserRole): AuthUser {
  return {
    id: `${role}-1`,
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

describe('promo tile video upload', () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'vintrax-video-api-'));
  const clipDir = mkdtempSync(join(tmpdir(), 'vintrax-video-clip-'));
  let app: INestApplication;

  const tempUploads = () =>
    readdirSync(tmpdir()).filter((name) => /^[0-9a-f]{32}$/.test(name)).length;

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
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        { provide: StorageService, useValue: new StorageService(config) },
        { provide: VideoProcessor, useValue: new VideoProcessor(config) },
        { provide: VehicleImagesService, useValue: {} },
        { provide: APP_GUARD, useClass: TestIdentityGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  const upload = (as: AuthUser | null, file: Buffer, filename: string, contentType: string) => {
    const req = request(app.getHttpServer()).post('/uploads/promo-tiles/video');
    if (as) req.set('x-test-user', as.id);
    return req.attach('file', file, { filename, contentType });
  };

  it('is for content administrators only', async () => {
    await upload(null, Buffer.from('x'), 'a.mp4', 'video/mp4').expect(403);
    await upload(DEALER, Buffer.from('x'), 'a.mp4', 'video/mp4').expect(403);
  });

  it('refuses a file that is not a video type, and leaves no temporary file behind', async () => {
    const before = tempUploads();
    await upload(ADMIN, Buffer.from('<svg/>'), 'a.svg', 'image/svg+xml').expect(400);
    expect(tempUploads()).toBe(before);
  });

  (hasFfmpeg ? it : it.skip)(
    'stores only the optimised video and its poster, and says what it made',
    async () => {
      const clip = join(clipDir, 'clip.mov');
      execFileSync(FFMPEG, [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1280x720:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=300',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        clip,
      ]);

      const response = await upload(
        ADMIN,
        readFileSync(clip),
        'IMG_0042.MOV',
        'video/quicktime',
      ).expect(201);

      expect(response.body).toMatchObject({ width: 1280, height: 720 });
      expect(response.body.videoUrl).toMatch(/^\/uploads\/promo-tiles\/[0-9a-f-]{36}\.mp4$/);
      expect(response.body.posterUrl).toMatch(/^\/uploads\/promo-tiles\/[0-9a-f-]{36}\.webp$/);
      const stored = readdirSync(join(uploadDir, 'promo-tiles'));
      expect(stored).toHaveLength(2);
      // The client's filename and the original upload are not kept anywhere.
      expect(stored.some((name) => name.includes('IMG_0042'))).toBe(false);
      expect(existsSync(join(uploadDir, response.body.videoUrl.replace('/uploads/', '')))).toBe(
        true,
      );
    },
    60_000,
  );
});
