import { describe, expect, it } from 'vitest';
import type { MakeLogo } from '@vintrax/shared';
import { buildPopularMakes } from './popular-makes';

const logo = (make: string, imageUrl: string): MakeLogo => ({
  make,
  imageUrl,
  alt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('the popular-makes row', () => {
  it('is driven by what is in stock, ordered as the facets already are', () => {
    const makes = buildPopularMakes({
      counts: [
        { value: 'Toyota', count: 12 },
        { value: 'Honda', count: 8 },
      ],
    });

    expect(makes).toEqual([
      { make: 'Toyota', count: 12, logoUrl: null },
      { make: 'Honda', count: 8, logoUrl: null },
    ]);
  });

  it('caps the row at the limit, defaulting to 5', () => {
    const counts = Array.from({ length: 12 }, (_, index) => ({
      value: `Make ${index}`,
      count: 12 - index,
    }));

    expect(buildPopularMakes({ counts })).toHaveLength(5);
    expect(buildPopularMakes({ counts, limit: 3 })).toHaveLength(3);
  });

  it('decorates a make already on the row with its curated logo', () => {
    const makes = buildPopularMakes({
      curated: [logo('Toyota', '/uploads/make-logos/toyota.png')],
      counts: [{ value: 'Toyota', count: 12 }],
    });

    expect(makes[0]?.logoUrl).toBe('/uploads/make-logos/toyota.png');
  });

  it('matches a curated logo to its make case-insensitively', () => {
    const makes = buildPopularMakes({
      curated: [logo('toyota', '/uploads/make-logos/toyota.png')],
      counts: [{ value: 'TOYOTA', count: 12 }],
    });

    expect(makes[0]?.logoUrl).toBe('/uploads/make-logos/toyota.png');
  });

  /**
   * The regression this guards against: a curated logo must decorate a make
   * that is already on the row, never add one that has no inventory — "in
   * stock right now" is the whole point of this row, same as body types.
   */
  it('never adds a make to the row on the strength of a curated logo alone', () => {
    const makes = buildPopularMakes({
      curated: [logo('Ferrari', '/uploads/make-logos/ferrari.png')],
      counts: [{ value: 'Toyota', count: 12 }],
    });

    expect(makes.map((entry) => entry.make)).toEqual(['Toyota']);
  });

  it('returns nothing when nothing is in stock', () => {
    expect(buildPopularMakes({})).toEqual([]);
  });
});
