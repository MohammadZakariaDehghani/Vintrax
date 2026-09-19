import { describe, expect, it } from 'vitest';
import type { VehicleDetail } from '@vintrax/shared';
import { buildFeatureCategoryMatrix } from './compare-feature-matrix';

function vehicle(features: string[]): VehicleDetail {
  return { features } as unknown as VehicleDetail;
}

describe('buildFeatureCategoryMatrix', () => {
  it('marks a feature present for the vehicles that listed it and absent for the ones that did not', () => {
    const groups = buildFeatureCategoryMatrix([vehicle(['Heated Seats']), vehicle([])]);

    const row = groups.flatMap((group) => group.rows).find((row) => row.feature === 'Heated Seats');
    expect(row?.present).toEqual([true, false]);
  });

  it('unions the feature lists rather than only using the first vehicle\'s', () => {
    const groups = buildFeatureCategoryMatrix([vehicle(['Sunroof']), vehicle(['Bluetooth'])]);
    const features = groups.flatMap((group) => group.rows.map((row) => row.feature));

    expect(features.sort()).toEqual(['Bluetooth', 'Sunroof']);
  });

  it('never lists a feature twice when more than one vehicle has it', () => {
    const groups = buildFeatureCategoryMatrix([vehicle(['Bluetooth']), vehicle(['Bluetooth'])]);
    const features = groups.flatMap((group) => group.rows.map((row) => row.feature));

    expect(features).toEqual(['Bluetooth']);
  });

  it('groups features into their categories', () => {
    const groups = buildFeatureCategoryMatrix([vehicle(['Bluetooth', 'Heated Seats'])]);

    expect(groups.map((group) => group.category).sort()).toEqual(
      ['Comfort & Convenience', 'Technology'].sort(),
    );
  });

  it('returns nothing when no selected vehicle lists any feature', () => {
    expect(buildFeatureCategoryMatrix([vehicle([]), vehicle([])])).toEqual([]);
  });
});
