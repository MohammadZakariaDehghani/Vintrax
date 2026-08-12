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
  const uploadDir = resolve(config.get('UPLOAD_DIR', { infer: true }));

  app.setGlobalPrefix('api');

  app.use(
    helmet({
      // Listing images are served from this origin and embedded by the web app
      // on a different port, so the default same-origin policy is too strict.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });

  // Uploaded and seeded images are served outside the /api prefix.
  mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Atlas Marketplace API')
      .setDescription(
        'REST API for the Atlas vehicle marketplace. Request and response shapes are defined ' +
          'as Zod schemas in the @atlas/shared package, which the web app validates against too.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Atlas API listening on http://localhost:${port}/api`);
  if (nodeEnv !== 'production') {
    logger.log(`API documentation at http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
