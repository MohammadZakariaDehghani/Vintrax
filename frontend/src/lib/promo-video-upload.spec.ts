import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMO_VIDEO } from '@vintrax/shared';

const calls: Array<{ method: string; path: string; size?: number }> = [];
let statuses: Array<Record<string, unknown>> = [];

vi.mock('@/lib/api-client', () => ({
  api: {
    post: vi.fn(async (path: string, body?: { sizeBytes: number }) => {
      calls.push({ method: 'POST', path });
      if (path.endsWith('/sessions')) {
        return {
          uploadId: 'up-1',
          chunkBytes: PROMO_VIDEO.chunkBytes,
          chunkCount: Math.ceil((body?.sizeBytes ?? 0) / PROMO_VIDEO.chunkBytes),
        };
      }
      return { status: 'PROCESSING' };
    }),
    upload: vi.fn(async (path: string, file: File) => {
      calls.push({ method: 'UPLOAD', path, size: file.size });
      return {};
    }),
    get: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path });
      return statuses.shift();
    }),
  },
}));

const { uploadPromoVideo, videoContentType } = await import('./promo-video-upload');

const noWait = async () => undefined;
const fakeFile = (size: number, name = 'clip.mp4', type = 'video/mp4') =>
  new File([new Uint8Array(size)], name, { type });

describe('uploading a promo tile video', () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    statuses = [];
  });

  it('sends a large video in pieces no bigger than a proxy allows, then waits for it', async () => {
    const size = PROMO_VIDEO.chunkBytes * 2 + 1234;
    const result = {
      videoUrl: '/uploads/promo-tiles/v.mp4',
      posterUrl: '/uploads/promo-tiles/p.webp',
    };
    statuses = [{ status: 'PROCESSING' }, { status: 'READY', result }];
    const progress: unknown[] = [];

    expect(await uploadPromoVideo(fakeFile(size), (p) => progress.push(p), noWait)).toEqual(result);

    const pieces = calls.filter((call) => call.method === 'UPLOAD');
    expect(pieces.map((call) => call.size)).toEqual([
      PROMO_VIDEO.chunkBytes,
      PROMO_VIDEO.chunkBytes,
      1234,
    ]);
    expect(Math.max(...pieces.map((call) => call.size ?? 0))).toBeLessThan(16 * 1024 * 1024);
    expect(pieces.map((call) => call.path)).toEqual([
      '/uploads/promo-tiles/video/sessions/up-1/chunks/0',
      '/uploads/promo-tiles/video/sessions/up-1/chunks/1',
      '/uploads/promo-tiles/video/sessions/up-1/chunks/2',
    ]);
    expect(progress).toContainEqual({ phase: 'uploading', percent: 100 });
    expect(progress.at(-1)).toEqual({ phase: 'processing' });
  });

  it("reports the server's reason when optimising fails", async () => {
    statuses = [{ status: 'FAILED', error: 'That file could not be read as a video.' }];
    await expect(uploadPromoVideo(fakeFile(10), () => undefined, noWait)).rejects.toThrow(
      'That file could not be read as a video.',
    );
  });

  it('refuses a file over the limit without sending anything', async () => {
    await expect(
      uploadPromoVideo(fakeFile(PROMO_VIDEO.maxUploadBytes + 1), () => undefined, noWait),
    ).rejects.toThrow(/up to 100 MB/);
    expect(calls).toEqual([]);
  });

  it('works out the type from the extension when the browser gives none', () => {
    expect(videoContentType({ name: 'IMG_0042.MOV', type: '' })).toBe('video/quicktime');
    expect(videoContentType({ name: 'clip.m4v', type: '' })).toBe('video/mp4');
    expect(videoContentType({ name: 'clip.mp4', type: 'video/mp4' })).toBe('video/mp4');
  });
});
