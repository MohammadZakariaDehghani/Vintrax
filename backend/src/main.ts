import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseCorsOrigins, type Env } from './config/env';
import { PUBLIC_UPLOAD_FOLDERS } from './common/storage/public-upload-folders';

/**
 * Folders whose files are never overwritten: every key is a fresh UUID, and a
 * replaced photo gets a new one. That is the condition under which telling
 * browsers and proxies to cache for a year without revalidating is safe.
 */
const IMMUTABLE_UPLOAD_FOLDERS: ReadonlySet<string> = new Set(['vehicles']);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The app's own logger; request logging belongs to the reverse proxy.
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('API_PORT', { infer: true });
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const storageDriver = config.get('STORAGE_DRIVER', { infer: true });
  const uploadDir = resolve(config.get('UPLOAD_DIR', { infer: true }));
  const logger = new Logger('Bootstrap');

  // Placeholders are refused outright (config/env.ts). A short secret is only
  // warned about, so an existing deployment keeps starting while it rotates.
  if (nodeEnv === 'production') {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (config.get(key, { infer: true }).length < 32) {
        logger.warn(`${key} is shorter than 32 characters; rotate it (openssl rand -base64 48).`);
      }
    }
  }

  app.setGlobalPrefix('api');

  // Behind a load balancer, X-Forwarded-For carries the real client IP, which
  // rate limiting and the audit trail both depend on.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Vehicle images are served from this origin and embedded by the web app
      // on a different one, so the default same-origin policy is too strict.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }),
  );

  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });

  // Local storage serves uploads as static assets outside the /api prefix.
  // With S3 the objects are served by the bucket or its CDN instead.
  //
  // Folders are mounted one by one rather than serving the upload directory
  // whole, because `documents/` holds registrations, titles, CarFax reports
  // and bills of sale, which carry the owner's name and address. Mounting the
  // parent would make every one of them readable by anyone who knew, or
  // guessed, a URL. Documents are served by
  // GET /api/vehicles/:id/documents/:documentId, which checks who is asking.
  //
  // An allowlist and not a denylist: a folder added later and forgotten here
  // returns 404, which someone notices. The reverse mistake is silent.
  if (storageDriver === 'local') {
    for (const folder of PUBLIC_UPLOAD_FOLDERS) {
      const path = join(uploadDir, folder);
      mkdirSync(path, { recursive: true });
      app.useStaticAssets(path, {
        prefix: `/uploads/${folder}/`,
        ...(IMMUTABLE_UPLOAD_FOLDERS.has(folder) ? { maxAge: '365d', immutable: true } : {}),
      });
    }
    mkdirSync(join(uploadDir, 'documents'), { recursive: true });
  }

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Vintrax Marketplace API')
      .setDescription(
        'REST and WebSocket API for the Vintrax automotive marketplace and auction platform. ' +
          'Request and response shapes are defined as Zod schemas in the @vintrax/shared package, ' +
          'which the frontend validates against too.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('auth', 'Registration, sign-in, tokens, verification')
      .addTag('vehicles', 'Inventory and search')
      .addTag('auctions', 'Auctions and bidding')
      .addTag('inspections', 'Vehicle condition reports')
      .addTag('dealers', 'Dealership profiles and analytics')
      .addTag('admin', 'Platform administration')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  logger.log(`Vintrax API listening on http://localhost:${port}/api`);
  logger.log(`WebSocket namespace: ws://localhost:${port}/auctions`);
  if (nodeEnv !== 'production') {
    logger.log(`API documentation at http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
