import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activeVehicleBadges, type VehicleBadges } from '@vintrax/shared';

const NONE: VehicleBadges = {
  lowKilometres: false,
  oneOwner: false,
  noAccident: false,
  report: false,
  carfax: false,
};

describe('activeVehicleBadges', () => {
  it('draws nothing when the dealer has ticked nothing', () => {
    expect(activeVehicleBadges(NONE)).toEqual([]);
  });

  it('keeps a fixed order, so two identical cars draw an identical strip', () => {
    const badges: VehicleBadges = {
      ...NONE,
      carfax: true,
      oneOwner: true,
      lowKilometres: true,
    };
    expect(activeVehicleBadges(badges)).toEqual(['lowKilometres', 'oneOwner', 'carfax']);
  });

  it('is independent per badge — any subset can be on', () => {
    expect(activeVehicleBadges({ ...NONE, noAccident: true })).toEqual(['noAccident']);
    expect(activeVehicleBadges({ ...NONE, report: true })).toEqual(['report']);
  });
});

/**
 * The CARFAX badge behaves like every other dealer-controlled badge (issue
 * #67): it is drawn from `vehicle.badges.carfax`, not implied by having a
 * link on file, and the component stays a server component with no event
 * handler (issue #37's own lesson, from this file's earlier CARFAX-only
 * version).
 */
describe('the badge strip markup', () => {
  const source = readFileSync('src/components/vehicle-badge-strip.tsx', 'utf8');

  it('reads the real component', () => {
    expect(source).toContain('export function VehicleBadgeStrip');
  });

  it('draws every badge from the one shared vehicle.badges source of truth', () => {
    expect(source).toContain('activeVehicleBadges(vehicle.badges)');
  });

  it('stays a server component with no event handler', () => {
    expect(source).not.toMatch(/^['"]use client['"]/m);
    expect(source).not.toMatch(/\bon[A-Z]\w+=\{/);
  });

  it('only links the CARFAX chip when a report URL is on file', () => {
    expect(source).toContain('if (url) {');
  });
});
