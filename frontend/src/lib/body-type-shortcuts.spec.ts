import { describe, expect, it } from 'vitest';
import { BODY_TYPES, type BodyTypeImage, type VehicleSummary } from '@atlas/shared';
import { buildBodyTypeShortcuts } from './body-type-shortcuts';

const vehicle = (bodyType: VehicleSummary['bodyType'], primaryImageUrl: string | null) =>
  ({ bodyType, primaryImageUrl }) as VehicleSummary;

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
      vehicles: [vehicle('SUV', '/uploads/vehicles/suv.png')],
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

  it('prefers the curated photo over an inventory one', () => {
    const shortcuts = buildBodyTypeShortcuts({
      curated: [curated('SUV', '/uploads/body-types/suv.png')],
      vehicles: [vehicle('SUV', '/uploads/vehicles/listing.png')],
    });

    expect(shortcuts.find((entry) => entry.bodyType === 'SUV')?.imageUrl).toBe(
      '/uploads/body-types/suv.png',
    );
  });

  it('falls back to an inventory photo, then to nothing', () => {
    const shortcuts = buildBodyTypeShortcuts({
      vehicles: [vehicle('TRUCK', null), vehicle('TRUCK', '/uploads/vehicles/truck.png')],
    });

    expect(shortcuts.find((entry) => entry.bodyType === 'TRUCK')?.imageUrl).toBe(
      '/uploads/vehicles/truck.png',
    );
    expect(shortcuts.find((entry) => entry.bodyType === 'WAGON')?.imageUrl).toBeNull();
  });
});
