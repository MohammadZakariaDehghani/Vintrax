import { describe, expect, it } from 'vitest';
import {
  legacyMediaPresentation,
  mediaPresentationInputSchema,
  type MediaAsset,
} from '@vintrax/shared';
import { presentationFromAsset, stillUrl, toMediaInput } from './media-input';
import { checkMediaFile } from './media-upload';

const video: MediaAsset = {
  id: '9a1f4c2e-1b3d-4e5f-8a9b-0c1d2e3f4a5b',
  kind: 'VIDEO',
  label: 'Showroom',
  alt: 'A car turning on a stand',
  url: '/uploads/media/v.mp4',
  posterUrl: '/uploads/media/p.webp',
  smallUrl: '/uploads/media/s.mp4',
  width: 1920,
  height: 1080,
  durationSeconds: 12,
  sizeBytes: 4_000_000,
  contentType: 'video/mp4',
  image: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('what the editors send', () => {
  it('sends a library asset by id only — never URLs the API would have to trust', () => {
    const input = toMediaInput(presentationFromAsset(video));
    expect(input?.desktop).toEqual({ assetId: video.id });
    expect(JSON.stringify(input)).not.toContain('/uploads/');
    expect(mediaPresentationInputSchema.safeParse(input).success).toBe(true);
  });

  it('keeps media saved before the library as the URLs it had', () => {
    const input = toMediaInput(
      legacyMediaPresentation('IMAGE', '/uploads/home-features/old.jpg', { alt: 'Old' }),
    );
    expect(input?.desktop).toEqual({ url: '/uploads/home-features/old.jpg' });
    expect(mediaPresentationInputSchema.safeParse(input).success).toBe(true);
  });

  it('sends no media as null, and a blank description as none', () => {
    expect(toMediaInput(null)).toBeNull();
    expect(toMediaInput({ ...presentationFromAsset(video), alt: '  ' })?.alt).toBeNull();
  });

  it('uses the poster to stand for a video', () => {
    expect(stillUrl(presentationFromAsset(video))).toBe('/uploads/media/p.webp');
  });
});

describe('checking a file before it is uploaded', () => {
  const file = (name: string, type: string, size = 1000) =>
    new File([new Uint8Array(size)], name, { type });
  const sized = (width: number, height: number) => async () => ({ width, height });

  it('refuses what is not a picture or a video', async () => {
    expect(await checkMediaFile(file('a.exe', 'application/x-msdownload'), 'IMAGE')).toMatch(
      /JPEG, PNG, WebP or AVIF/,
    );
    expect(await checkMediaFile(file('a.svg', 'image/svg+xml'), 'IMAGE')).toMatch(/JPEG/);
    expect(await checkMediaFile(file('a.gif', 'image/gif'), 'VIDEO')).toMatch(/MP4, MOV or WebM/);
  });

  it('refuses a picture too small or too large', async () => {
    expect(await checkMediaFile(file('a.jpg', 'image/jpeg'), 'IMAGE', sized(100, 80))).toMatch(
      /at least 320×180/,
    );
    expect(await checkMediaFile(file('a.jpg', 'image/jpeg'), 'IMAGE', sized(20_000, 9000))).toMatch(
      /no larger than/,
    );
    expect(
      await checkMediaFile(file('a.jpg', 'image/jpeg'), 'IMAGE', sized(1920, 1080)),
    ).toBeNull();
  });

  it('recognises a picture by its extension when the browser gives no type', async () => {
    expect(await checkMediaFile(file('hero.webp', ''), 'IMAGE', sized(1920, 1080))).toBeNull();
  });

  it('accepts an MP4, MOV or WebM video', async () => {
    expect(await checkMediaFile(file('clip.mov', ''), 'VIDEO')).toBeNull();
    expect(await checkMediaFile(file('clip.webm', 'video/webm'), 'VIDEO')).toBeNull();
  });
});
