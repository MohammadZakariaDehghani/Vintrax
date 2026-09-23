import sharp from 'sharp';
import {
  ImageProcessor,
  ImageValidationError,
  type ImageProcessorOptions,
} from './image-processor';

/**
 * The pipeline's contract with a dealer's photo (issue #74): what it accepts,
 * what it refuses, and what comes out. Fixtures are generated here rather
 * than committed, so each test states exactly what it feeds in.
 */

const OPTIONS: ImageProcessorOptions = {
  maxInputBytes: 15 * 1024 * 1024,
  maxInputDimension: 12_000,
  maxInputPixels: 60_000_000,
  maxWidth: 1920,
  maxHeight: 1920,
  variantWidths: [320, 640, 960, 1440, 1920],
  webpQuality: 80,
  avifEnabled: false,
  avifQuality: 60,
};

function processor(overrides: Partial<ImageProcessorOptions> = {}): ImageProcessor {
  return new ImageProcessor({ ...OPTIONS, ...overrides });
}

/** A photo-like image: a gradient, so encoders have real work to do. */
async function photo(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = (x * 255) / width;
      pixels[offset + 1] = (y * 255) / height;
      pixels[offset + 2] = 128;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .toFormat(format)
    .toBuffer();
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImageValidationError);
    return (error as Error).message;
  }
  throw new Error('expected the photo to be refused');
}

describe('ImageProcessor — validation', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'accepts a valid %s, identified by content',
    async (format) => {
      const metadata = await processor().validate(await photo(400, 300, format));
      expect(metadata.format).toBe(format);
      expect(metadata.contentType).toBe(`image/${format}`);
      expect([metadata.width, metadata.height]).toEqual([400, 300]);
    },
  );

  it('refuses a corrupt file', async () => {
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    expect(await refusal(processor().validate(garbage))).toMatch(/not a readable image/);
  });

  it('refuses a truncated JPEG at decode, even though its header reads fine', async () => {
    const whole = await photo(800, 600);
    const truncated = whole.subarray(0, Math.floor(whole.length / 2));
    await expect(processor().validate(truncated)).resolves.toBeDefined();
    expect(await refusal(processor().process(truncated))).toMatch(/could not be read/);
  });

  it('refuses a file over the size limit before reading it', async () => {
    const buffer = await photo(400, 300);
    const message = await refusal(processor({ maxInputBytes: 1024 }).validate(buffer));
    expect(message).toMatch(/The limit is/);
  });

  it('refuses excessive dimensions', async () => {
    const wide = await photo(5000, 10, 'png');
    expect(await refusal(processor({ maxInputDimension: 4000 }).validate(wide))).toMatch(
      /5000 × 10 pixels/,
    );
  });

  it('refuses a decompression bomb: a small file declaring a huge canvas', async () => {
    // A flat colour compresses to almost nothing however large the canvas is.
    const bomb = await sharp({
      create: { width: 9000, height: 9000, channels: 3, background: '#808080' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(await refusal(processor().validate(bomb))).toMatch(/larger than Vintrax accepts/);
  });

  it('ignores the extension: a text file called car.jpg is not a photo', async () => {
    const text = Buffer.from('#!/bin/sh\necho not a photo\n');
    expect(await refusal(processor().validate(text))).toMatch(/not a readable image/);
  });

  it('refuses SVG, which is not a photo and can carry script', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>',
    );
    expect(await refusal(processor().validate(svg))).toMatch(/not a supported photo/);
  });
});

describe('ImageProcessor — variants', () => {
  it('generates WebP at every configured width for a large photo', async () => {
    const result = await processor().process(await photo(3000, 2000));
    expect(result.widths).toEqual([320, 640, 960, 1440, 1920]);
    expect(result.formats).toEqual(['webp']);
    for (const variant of result.variants) {
      expect(variant.format).toBe('webp');
      expect(variant.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(variant.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
      expect((await sharp(variant.buffer).metadata()).width).toBe(variant.width);
    }
  });

  it('generates AVIF alongside WebP when enabled', async () => {
    const result = await processor({ avifEnabled: true, variantWidths: [320, 640] }).process(
      await photo(800, 600),
    );
    expect(result.formats).toEqual(['avif', 'webp']);
    const avif = result.variants.filter((variant) => variant.format === 'avif');
    expect(avif.map((variant) => variant.width)).toEqual([320, 640, 800]);
    const metadata = await sharp(avif[0]!.buffer).metadata();
    expect(metadata.format).toBe('heif');
    expect(metadata.compression).toBe('av1');
  });

  it('never upscales: an 800 px photo gets 320, 640 and its own 800', async () => {
    const result = await processor().process(await photo(800, 600));
    expect(result.widths).toEqual([320, 640, 800]);
    expect(result.width).toBe(800);
  });

  it('caps the largest variant at the configured box', async () => {
    const result = await processor().process(await photo(6000, 4000));
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1280);
  });

  it('preserves the aspect ratio in every variant', async () => {
    const result = await processor().process(await photo(3000, 2000));
    for (const variant of result.variants) {
      expect(variant.height / variant.width).toBeCloseTo(2000 / 3000, 2);
    }
  });

  it('applies EXIF orientation: a photo stored sideways comes out upright', async () => {
    // Stored 600 wide × 400 tall, tagged "rotate 90° clockwise to display",
    // which is how a phone held upright records a portrait photo.
    const sideways = await sharp(await photo(600, 400))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const validated = await processor().validate(sideways);
    expect([validated.width, validated.height]).toEqual([400, 600]);

    const result = await processor().process(sideways);
    expect([result.width, result.height]).toEqual([400, 600]);
    const largest = await sharp(result.variants[result.variants.length - 1]!.buffer).metadata();
    expect([largest.width, largest.height]).toEqual([400, 600]);
    expect(largest.orientation).toBeUndefined();
  });

  it('strips metadata, GPS included, from every variant', async () => {
    const tagged = await sharp(await photo(600, 400))
      .withExif({
        IFD0: { Make: 'PhoneMaker', Model: 'Phone 15', Copyright: 'Dealer' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '43/1 39/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '79/1 23/1 0/1',
        },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const result = await processor().process(tagged);
    for (const variant of result.variants) {
      const metadata = await sharp(variant.buffer).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(variant.buffer.includes(Buffer.from('PhoneMaker'))).toBe(false);
    }
  });

  it('keeps transparency from a PNG', async () => {
    const transparent = await sharp({
      create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const result = await processor().process(transparent);
    expect((await sharp(result.variants[0]!.buffer).metadata()).hasAlpha).toBe(true);
  });
});
