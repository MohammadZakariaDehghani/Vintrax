import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseCorsOrigins, type Env } from './config/env';

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
  if (storageDriver === 'local') {
    mkdirSync(uploadDir, { recursive: true });
    app.useStaticAssets(uploadDir, { prefix: '/uploads/' });
  }

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Atlas Marketplace API')
      .setDescription(
        'REST and WebSocket API for the Atlas automotive marketplace and auction platform. ' +
          'Request and response shapes are defined as Zod schemas in the @atlas/shared package, ' +
          'which the frontend validates against too.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('auth', 'Registration, sign-in, tokens, verification')
      .addTag('vehicles', 'Inventory and search')
      .addTag('auctions', 'Auctions and bidding')
      .addTag('inspections', 'Vehicle condition reports')
      .addTag('orders', 'Purchases, payments and settlement')
      .addTag('dealers', 'Dealership profiles and analytics')
      .addTag('admin', 'Platform administration')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Atlas API listening on http://localhost:${port}/api`);
  logger.log(`WebSocket namespace: ws://localhost:${port}/auctions`);
  if (nodeEnv !== 'production') {
    logger.log(`API documentation at http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
