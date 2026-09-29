import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { validateEnv, type Env } from '../../config/env';
import { matchesSignature } from './file-signature';
import { StorageService } from './storage.service';

/**
 * An upload's declared type decides the extension it is stored under and the
 * type it is later served with, so the bytes have to agree with it.
 */

const pixel = { create: { width: 2, height: 2, channels: 3 as const, background: '#c00' } };

describe('file signatures', () => {
  it('recognises the real formats', async () => {
    expect(matchesSignature(await sharp(pixel).jpeg().toBuffer(), 'image/jpeg')).toBe(true);
    expect(matchesSignature(await sharp(pixel).png().toBuffer(), 'image/png')).toBe(true);
    expect(matchesSignature(await sharp(pixel).webp().toBuffer(), 'image/webp')).toBe(true);
    expect(matchesSignature(await sharp(pixel).avif().toBuffer(), 'image/avif')).toBe(true);
    expect(matchesSignature(Buffer.from('%PDF-1.7\n1 0 obj'), 'application/pdf')).toBe(true);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom0000')]);
    expect(matchesSignature(mp4, 'video/mp4')).toBe(true);
  });

  it('refuses a page, a script or another format sent under an image type', async () => {
    expect(matchesSignature(Buffer.from('<html><script>alert(1)</script>'), 'image/png')).toBe(
      false,
    );
    expect(matchesSignature(Buffer.from('<svg onload="alert(1)"/>'), 'image/jpeg')).toBe(false);
    expect(matchesSignature(Buffer.from('MZ\x90\x00'), 'application/pdf')).toBe(false);
    expect(matchesSignature(await sharp(pixel).png().toBuffer(), 'image/jpeg')).toBe(false);
    expect(matchesSignature(Buffer.alloc(0), 'image/webp')).toBe(false);
  });

  it('knows no type it was not told about', () => {
    expect(matchesSignature(Buffer.from('<svg/>'), 'image/svg+xml')).toBe(false);
    expect(matchesSignature(Buffer.from('<html/>'), 'text/html')).toBe(false);
  });
});

describe('StorageService.upload', () => {
  const uploadDir = mkdtempSync(join(tmpdir(), 'vintrax-signature-'));
  const storage = new StorageService(
    new ConfigService<Env, true>(
      validateEnv({
        DATABASE_URL: 'postgresql://unused',
        JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
        JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789',
        UPLOAD_DIR: uploadDir,
      }),
    ),
  );

  it('stores an image whose bytes match its type', async () => {
    const stored = await storage.uploadImage({
      folder: 'logos',
      buffer: await sharp(pixel).png().toBuffer(),
      contentType: 'image/png',
    });
    expect(stored.url).toMatch(/^\/uploads\/logos\/[0-9a-f-]{36}\.png$/);
  });

  it('refuses an HTML page declared as a PNG, and writes nothing', async () => {
    await expect(
      storage.uploadImage({
        folder: 'partners',
        buffer: Buffer.from('<!doctype html><script>document.cookie</script>'),
        contentType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(readdirSync(uploadDir)).not.toContain('partners');
  });

  it('refuses a document that is not really a PDF', async () => {
    await expect(
      storage.uploadDocument({
        folder: 'documents',
        buffer: Buffer.from('<html>not a pdf</html>'),
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
