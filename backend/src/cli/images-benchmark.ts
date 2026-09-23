import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { validateEnv } from '../config/env';
import { imageProcessorOptions } from '../modules/vehicle-images/image-config';
import { ImageProcessor } from '../modules/vehicle-images/image-processor';

/** A command-line tool's output is its purpose, so it goes to stdout directly. */
function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Runs the real pipeline over photos on disk and prints what it produced:
 *
 *   node dist/cli/images-benchmark.js photo1.jpg photo2.jpg
 *
 * Uses the same IMAGE_* configuration the API does, so running it inside
 * the production container measures that container, not a laptop.
 */
async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (files.length === 0) {
    console.error('Usage: images-benchmark <photo> [photo...]');
    process.exit(2);
  }

  const env = validateEnv({
    DATABASE_URL: 'postgresql://unused',
    JWT_ACCESS_SECRET: 'benchmark-only-access-secret',
    JWT_REFRESH_SECRET: 'benchmark-only-refresh-secret',
    ...process.env,
  });
  const processor = new ImageProcessor(imageProcessorOptions(env));

  for (const file of files) {
    const buffer = readFileSync(file);
    const started = process.hrtime.bigint();
    const result = await processor.process(buffer);
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

    const original = statSync(file).size;
    out(
      `\n${basename(file)} — ${result.source.width}×${result.source.height} ${result.source.format}, ` +
        `${kb(original)} KB, processed in ${Math.round(elapsed)} ms`,
    );
    out('  variant        size      vs original');
    for (const variant of result.variants) {
      const name = `${variant.width}.${variant.format}`.padEnd(12);
      const size = `${kb(variant.buffer.byteLength)} KB`.padStart(10);
      const saved = `${(100 - (variant.buffer.byteLength / original) * 100).toFixed(1)}% smaller`;
      out(`  ${name} ${size}   ${saved}`);
    }
  }
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
