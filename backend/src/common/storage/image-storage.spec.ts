import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ImageStorage, LocalImageStorage } from './image-storage';

/**
 * The storage the image pipeline writes through. `LocalImageStorage` is what
 * runs in production today; a future Google Cloud implementation has to pass
 * the same four behaviours.
 */
describe('LocalImageStorage', () => {
  const root = mkdtempSync(join(tmpdir(), 'vintrax-images-'));
  // Through the interface, as the pipeline itself uses it.
  const storage: ImageStorage = new LocalImageStorage(root);
  const key = 'vehicles/3f0c9a4e-0000-4000-8000-000000000001/640.webp';

  it('saves, reads and reports existence', async () => {
    expect(await storage.exists(key)).toBe(false);
    await storage.save(key, Buffer.from('bytes'), { contentType: 'image/webp' });
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.read(key)).toString()).toBe('bytes');
  });

  it('deletes idempotently, and tidies the emptied per-photo folder', async () => {
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.delete(key)).resolves.toBeUndefined();
    expect(existsSync(join(root, 'vehicles/3f0c9a4e-0000-4000-8000-000000000001'))).toBe(false);
    // The top-level folder stays: the API serves it statically.
    expect(readdirSync(root)).toContain('vehicles');
  });

  it('maps keys to public URLs and back', () => {
    expect(storage.getPath(key)).toBe(`/uploads/${key}`);
    expect(storage.keyFromUrl(`/uploads/${key}`)).toBe(key);
    expect(storage.keyFromUrl('https://elsewhere.example/car.jpg')).toBeNull();
    expect(storage.keyFromUrl('//evil.example/uploads/x.jpg')).toBeNull();
  });

  it.each([
    '../etc/passwd',
    'vehicles/../../etc/passwd',
    '/etc/passwd',
    'vehicles/a b.webp',
    'vehicles',
    'vehicles/./x.webp',
  ])('refuses the unsafe key %s', async (unsafe) => {
    await expect(
      storage.save(unsafe, Buffer.from('x'), { contentType: 'image/webp' }),
    ).rejects.toThrow(/unsafe storage key|outside the upload root/);
    expect(() => storage.getPath(unsafe)).toThrow();
  });

  it('never resolves a URL with traversal to a key', () => {
    expect(storage.keyFromUrl('/uploads/../../etc/passwd')).toBeNull();
  });
});
