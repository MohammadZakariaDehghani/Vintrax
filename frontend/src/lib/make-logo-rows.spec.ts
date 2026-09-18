import { describe, expect, it } from 'vitest';
import type { MakeLogo } from '@vintrax/shared';
import { buildMakeLogoRows } from './make-logo-rows';

const logo = (make: string, imageUrl: string): MakeLogo => ({
  make,
  imageUrl,
  alt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('the admin make-logos row list', () => {
  it('lists in-stock makes in their facet order, decorated with a curated logo', () => {
    const rows = buildMakeLogoRows({
      curated: [logo('toyota', '/uploads/make-logos/toyota.png')],
      facetMakes: [
        { value: 'Toyota', count: 12 },
        { value: 'Honda', count: 8 },
      ],
    });

    expect(rows).toEqual([
      { make: 'Toyota', count: 12, imageUrl: '/uploads/make-logos/toyota.png', alt: null },
      { make: 'Honda', count: 8, imageUrl: null, alt: null },
    ]);
  });

  /**
   * The regression this exists for: a logo set for a make that later sells
   * through would otherwise vanish from the admin screen along with the
   * facet entry, leaving no way to find and remove or replace it.
   */
  it('keeps a curated logo for a make nothing is currently listed under', () => {
    const rows = buildMakeLogoRows({
      curated: [logo('Ferrari', '/uploads/make-logos/ferrari.png')],
      facetMakes: [{ value: 'Toyota', count: 12 }],
    });

    expect(rows).toEqual([
      { make: 'Toyota', count: 12, imageUrl: null, alt: null },
      { make: 'Ferrari', count: 0, imageUrl: '/uploads/make-logos/ferrari.png', alt: null },
    ]);
  });

  it('does not duplicate a make that is both in stock and curated', () => {
    const rows = buildMakeLogoRows({
      curated: [logo('Toyota', '/uploads/make-logos/toyota.png')],
      facetMakes: [{ value: 'Toyota', count: 12 }],
    });

    expect(rows).toHaveLength(1);
  });

  it('returns nothing for empty inputs', () => {
    expect(buildMakeLogoRows({})).toEqual([]);
  });
});
