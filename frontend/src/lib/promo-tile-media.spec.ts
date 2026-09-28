import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PromoTile } from '@vintrax/shared';
import { PromoTileRow, PromoTiles } from '@/components/promo-tiles';

/**
 * A promo tile is a box whose size, span and place the administrator sets.
 * Video is a second kind of media inside that same box, never a layout of its
 * own: these pin that an image tile and a video tile with the same settings
 * render the same box, and only what is inside it differs.
 */

function tile(overrides: Partial<PromoTile>): PromoTile {
  return {
    slot: 1,
    imageUrl: '/uploads/promo-tiles/photo.webp',
    imageAlt: 'Winter tires',
    linkUrl: '/vehicles',
    widthSpan: 6,
    heightPx: 220,
    enabled: true,
    mediaType: 'IMAGE',
    videoUrl: null,
    videoPosterUrl: null,
    updatedAt: null,
    ...overrides,
  };
}

const asVideo = (base: PromoTile): PromoTile => ({
  ...base,
  mediaType: 'VIDEO',
  videoUrl: '/uploads/promo-tiles/clip.mp4',
  videoPosterUrl: '/uploads/promo-tiles/clip.webp',
});

const render = (tiles: PromoTile[]) => renderToStaticMarkup(createElement(PromoTileRow, { tiles }));

/** The tile's own element: everything up to the first child. */
function boxes(html: string): string[] {
  return [...html.matchAll(/<(a|div) [^>]*class="group relative[^"]*"[^>]*>/g)].map((m) => m[0]);
}

describe('a video in a promo tile', () => {
  it.each([
    ['half width, 220 px (2 wide × 1 high)', { widthSpan: 6, heightPx: 220 }],
    ['a third, 440 px (1 wide × 2 high)', { widthSpan: 4, heightPx: 440 }],
    ['full width, 300 px', { widthSpan: 12, heightPx: 300 }],
  ] as const)('fills exactly the box the image had: %s', (_label, layout) => {
    const image = tile(layout);
    const imageBox = boxes(render([image]));
    const videoBox = boxes(render([asVideo(image)]));

    expect(videoBox).toHaveLength(1);
    expect(videoBox).toEqual(imageBox);
  });

  it('keeps each tile in its place and order when one of them becomes a video', () => {
    const tiles = [
      tile({ slot: 1, widthSpan: 8, heightPx: 300 }),
      tile({ slot: 2, widthSpan: 4, heightPx: 300 }),
      tile({ slot: 3, widthSpan: 12, heightPx: 180 }),
    ];
    const withVideo = tiles.map((entry) => (entry.slot === 2 ? asVideo(entry) : entry));
    expect(boxes(render(withVideo))).toEqual(boxes(render(tiles)));
  });

  it('follows the phone layout too: the same shape ratio and the same desktop height', () => {
    const html = render([asVideo(tile({ widthSpan: 4, heightPx: 400 }))]);
    // 4/12 of the 1360 px reference row is 453 px wide; the box keeps that shape.
    expect(html).toContain('--promo-ratio:453 / 400');
    expect(html).toContain('aspect-[var(--promo-ratio)]');
    expect(html).toContain('sm:h-[var(--promo-height)]');
  });

  it('never imposes a portrait shape of its own', () => {
    const html = render([asVideo(tile({}))]);
    expect(html).not.toMatch(/9\s*\/\s*16|aspect-\[9\/16\]|aspect-video/);
  });

  it('is a silent loop with no controls, drawn like the photo', () => {
    const html = render([asVideo(tile({}))]);
    const video = /<video[^>]*>/.exec(html)?.[0] ?? '';

    expect(video).toMatch(/\bmuted\b/);
    expect(video).toMatch(/\bloop\b/);
    expect(video).toMatch(/\bplaysinline\b/i);
    expect(video).toContain('preload="none"');
    expect(video).toContain('poster="/uploads/promo-tiles/clip.webp"');
    expect(video).not.toMatch(/\bcontrols(?!=\{?false)\b(?!List)/);
    expect(video).not.toMatch(/\bautoplay\b/i);
    expect(video).toContain('object-cover');

    const image = /<img[^>]*>/.exec(render([tile({})]))?.[0] ?? '';
    expect(/class="([^"]*)"/.exec(video)?.[1]).toBe(/class="([^"]*)"/.exec(image)?.[1]);
  });

  it('shows a video tile with no photo, and hides a video tile with no video', () => {
    expect(render([asVideo(tile({ imageUrl: null }))])).toContain('<video');
    expect(render([tile({ mediaType: 'VIDEO', videoUrl: null })])).toBe('');
    expect(
      renderToStaticMarkup(
        createElement(PromoTiles, { tiles: [tile({ mediaType: 'VIDEO', imageUrl: null })] }),
      ),
    ).toBe('');
  });

  it('leaves image tiles exactly as they were', () => {
    const html = render([tile({})]);
    expect(html).not.toContain('<video');
    expect(html).toContain('src="/uploads/promo-tiles/photo.webp"');
  });
});

describe('video playback rules', () => {
  const source = readFileSync('src/components/promo-tile-video.tsx', 'utf8');

  it('plays only while on screen, and respects reduced motion', () => {
    expect(source).toContain('IntersectionObserver');
    expect(source).toContain('video.pause()');
    expect(source).toContain('prefers-reduced-motion: reduce');
  });

  it('falls back to the poster, then the photo, when the video fails', () => {
    expect(source).toContain('onError={() => setFailed(true)}');
    expect(source).toContain('const still = poster ?? fallbackImageUrl');
  });

  it('adds no size of its own; the tile decides', () => {
    expect(source).not.toMatch(/aspect-|width=|height=|style=/);
  });
});
