import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createImageStorage } from '../common/storage/image-storage';
import { validateEnv, type Env } from '../config/env';
import { ImageBackfill } from '../modules/vehicle-images/image-backfill';
import { VehicleImagesService } from '../modules/vehicle-images/vehicle-images.service';

const USAGE = `Usage: images:migrate [--dry-run] [--limit N] [--vehicle-id UUID]

Processes vehicle photos uploaded before the image pipeline into responsive
WebP renditions and links them. Safe to run repeatedly; originals are never
deleted. See documentation/images.md.`;

/** A command-line tool's output is its purpose, so it goes to stdout directly. */
function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Deliberately not a Nest application context: booting AppModule would start
 * the queue workers, the WebSocket gateway and the Redis cache just to run a
 * batch job. The two things this needs are constructed directly, with the
 * same configuration the API validates at startup.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    // `npm run images:migrate -- --dry-run` strips the `--`; pnpm passes it
    // through. Accept both spellings.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      'dry-run': { type: 'boolean', default: false },
      limit: { type: 'string' },
      'vehicle-id': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    out(USAGE);
    return;
  }

  const limit = values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive whole number');
  }
  const vehicleId = values['vehicle-id'];
  if (vehicleId !== undefined && !/^[0-9a-f-]{36}$/i.test(vehicleId)) {
    throw new Error('--vehicle-id must be a vehicle UUID');
  }

  const env = validateEnv(process.env);
  const config = new ConfigService<Env, true>(env);
  const prisma = new PrismaClient();

  try {
    const images = new VehicleImagesService(prisma, createImageStorage(config), config);
    const backfill = new ImageBackfill(prisma, images, out);
    const dryRun = values['dry-run'] ?? false;

    out(
      `images:migrate${dryRun ? ' (dry run — nothing is written)' : ''}` +
        `${limit ? `, limit ${limit}` : ''}${vehicleId ? `, vehicle ${vehicleId}` : ''}`,
    );
    const report = await backfill.run({ dryRun, limit, vehicleId });

    out(`\n${report.considered} photo(s) considered`);
    for (const [outcome, count] of Object.entries(report.counts)) {
      if (count > 0) out(`  ${outcome.padEnd(20)} ${count}`);
    }
    if (report.counts.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
