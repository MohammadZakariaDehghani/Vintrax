import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildOptimizedImage,
  fallbackImageSource,
  imageSrcSet,
  type OptimizedImage as Renditions,
} from '@vintrax/shared';
import { IMAGE_SIZES, OptimizedImage } from '@/components/optimized-image';

/**
 * How every vehicle photo reaches the page (issue #74): the markup the
 * browser needs to choose a size itself, to hold the photo's space before it
 * loads, and to load the main photo first and the rest only when needed.
 */

const renditions: Renditions = buildOptimizedImage({
  baseUrl: '/uploads/vehicles/abc',
  widths: [1920, 320, 960, 640, 1440],
  formats: ['webp'],
  width: 1920,
  height: 1280,
})!;

function render(props: Parameters<typeof OptimizedImage>[0]): string {
  return renderToStaticMarkup(createElement(OptimizedImage, props));
}

describe('renditions from the API', () => {
  it('lists every width, ascending, under the asset base URL', () => {
    expect(renditions.webp.map((source) => source.url)).toEqual([
      '/uploads/vehicles/abc/320.webp',
      '/uploads/vehicles/abc/640.webp',
      '/uploads/vehicles/abc/960.webp',
      '/uploads/vehicles/abc/1440.webp',
      '/uploads/vehicles/abc/1920.webp',
    ]);
    expect(renditions.avif).toEqual([]);
  });

  it('builds a srcset the browser can choose from', () => {
    expect(imageSrcSet(renditions.webp.slice(0, 2))).toBe(
      '/uploads/vehicles/abc/320.webp 320w, /uploads/vehicles/abc/640.webp 640w',
    );
  });

  it('falls back to the rendition nearest 960 px for a lone src', () => {
    expect(fallbackImageSource(renditions.webp).width).toBe(960);
    expect(fallbackImageSource(renditions.webp.slice(0, 2)).width).toBe(640);
  });

  it('treats an unprocessed record as having no renditions', () => {
    expect(
      buildOptimizedImage({ baseUrl: '', widths: [], formats: [], width: null, height: null }),
    ).toBeNull();
  });
});

describe('<OptimizedImage>', () => {
  it('gives a processed photo srcset, sizes, and its real width and height', () => {
    const html = render({
      image: renditions,
      src: '/legacy.jpg',
      alt: 'A car',
      sizes: IMAGE_SIZES.card,
    });
    expect(html).toContain('<picture');
    expect(html).toContain(`srcSet="${imageSrcSet(renditions.webp)}"`);
    expect(html).toContain(`sizes="${IMAGE_SIZES.card}"`);
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1280"');
    expect(html).toContain('src="/uploads/vehicles/abc/960.webp"');
    expect(html).not.toContain('/legacy.jpg');
  });

  it('lazy-loads and async-decodes by default', () => {
    const html = render({ image: renditions, src: '', alt: '', sizes: IMAGE_SIZES.card });
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain('fetchPriority');
  });

  it('loads the priority photo eagerly, at high fetch priority', () => {
    const html = render({
      image: renditions,
      src: '',
      alt: '',
      sizes: IMAGE_SIZES.hero,
      priority: true,
    });
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain('loading="lazy"');
  });

  it('offers AVIF first when the API produced it', () => {
    const withAvif = buildOptimizedImage({
      baseUrl: '/uploads/vehicles/abc',
      widths: [320, 640],
      formats: ['avif', 'webp'],
      width: 640,
      height: 480,
    })!;
    const html = render({ image: withAvif, src: '', alt: '', sizes: IMAGE_SIZES.card });
    expect(html.indexOf('type="image/avif"')).toBeGreaterThan(-1);
    expect(html.indexOf('type="image/avif"')).toBeLessThan(html.indexOf('<img'));
    expect(html).toContain('/uploads/vehicles/abc/640.avif 640w');
  });

  it('draws a photo from before the pipeline from its plain URL, still lazily', () => {
    const html = render({
      image: null,
      src: '/uploads/seed/car.svg',
      alt: 'A car',
      sizes: IMAGE_SIZES.card,
    });
    expect(html).not.toContain('<picture');
    expect(html).not.toContain('srcSet');
    expect(html).toContain('src="/uploads/seed/car.svg"');
    expect(html).toContain('loading="lazy"');
  });
});

/** Where each layout uses it: one priority photo per page, everything else lazy. */
describe('photo call sites', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('makes the vehicle page main photo the only priority image, in a fixed-ratio box', () => {
    const gallery = read('src/components/vehicle-gallery.tsx');
    expect(gallery.match(/^\s*priority\s*$/gm)).toHaveLength(1);
    expect(gallery).toMatch(/sizes=\{IMAGE_SIZES\.hero\}\s+priority\s+className="aspect-\[4\/3\]/);
  });

  it.each([
    'src/components/vehicle-card.tsx',
    'src/components/vehicle-row.tsx',
    'src/components/compare-vehicle-card.tsx',
    'src/app/dealer/inventory/inventory-items.tsx',
    'src/app/auctions/page.tsx',
    'src/app/admin/moderation/page.tsx',
  ])('%s draws vehicle photos through OptimizedImage, never as priority', (path) => {
    const source = read(path);
    expect(source).toContain('<OptimizedImage');
    expect(source).not.toMatch(/<img[\s\S]{0,80}primaryImageUrl/);
    expect(source).not.toMatch(/\bpriority\b/);
  });

  it('keeps OptimizedImage a server component, usable from server-rendered cards', () => {
    const source = read('src/components/optimized-image.tsx');
    expect(source).not.toMatch(/^['"]use client['"]/m);
    expect(source).not.toMatch(/\bon[A-Z]\w+=\{/);
  });
});
