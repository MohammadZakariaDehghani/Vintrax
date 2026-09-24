import { describe, expect, it } from 'vitest';
import { BODY_TYPES, type BodyTypeImage } from '@vintrax/shared';
import { buildBodyTypeShortcuts } from './body-type-shortcuts';

const curated = (bodyType: BodyTypeImage['bodyType'], imageUrl: string | null): BodyTypeImage => ({
  bodyType,
  imageUrl,
  alt: null,
  updatedAt: null,
});

describe('the body-type shortcut row', () => {
  /**
   * The regression this file exists for. Search facets only carry body types
   * something is listed under, so a row built from them dropped the photograph
   * an administrator had uploaded for a shape with nothing in stock — vans and
   * convertibles, in practice — and fell back to the silhouette with no error
   * to explain it.
   */
  it('keeps a curated photo for a body type nothing is listed under', () => {
    const shortcuts = buildBodyTypeShortcuts({
      curated: [curated('VAN', '/uploads/body-types/van.png')],
      counts: [{ value: 'SUV', count: 6 }],
    });

    const van = shortcuts.find((entry) => entry.bodyType === 'VAN');
    expect(van?.imageUrl).toBe('/uploads/body-types/van.png');
    expect(van?.count).toBe(0);
  });

  it('covers every body type whatever the inputs', () => {
    const shortcuts = buildBodyTypeShortcuts({});

    expect(shortcuts.map((entry) => entry.bodyType)).toEqual([...BODY_TYPES]);
  });

  it('draws the silhouette, never a listing photo, for a shape with no uploaded icon', () => {
    const shortcuts = buildBodyTypeShortcuts({
      curated: [curated('SUV', '/uploads/body-types/suv.png')],
      counts: [{ value: 'TRUCK', count: 3 }],
    });

    expect(shortcuts.find((entry) => entry.bodyType === 'SUV')?.imageUrl).toBe(
      '/uploads/body-types/suv.png',
    );
    expect(shortcuts.find((entry) => entry.bodyType === 'TRUCK')?.imageUrl).toBeNull();
    expect(shortcuts.find((entry) => entry.bodyType === 'TRUCK')?.count).toBe(3);
  });
});
