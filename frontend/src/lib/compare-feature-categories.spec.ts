import { describe, expect, it } from 'vitest';
import { OTHER_CATEGORY, categorizeFeatures } from './compare-feature-categories';

describe('categorizeFeatures', () => {
  it('matches a feature keyword case-insensitively', () => {
    const groups = categorizeFeatures(['Heated Seats']);

    expect(groups).toEqual([{ category: 'Comfort & Convenience', features: ['Heated Seats'] }]);
  });

  it('groups multiple features under the same category together', () => {
    const groups = categorizeFeatures(['Bluetooth', 'Apple CarPlay', 'Navigation']);

    expect(groups).toEqual([{ category: 'Technology', features: ['Bluetooth', 'Apple CarPlay', 'Navigation'] }]);
  });

  it('falls back to Other for a feature matching no known keyword', () => {
    const groups = categorizeFeatures(['Tinted Windows']);

    expect(groups).toEqual([{ category: OTHER_CATEGORY, features: ['Tinted Windows'] }]);
  });

  it('omits a category that nothing selected matched', () => {
    const groups = categorizeFeatures(['Sunroof']);

    expect(groups.map((group) => group.category)).toEqual(['Exterior']);
  });

  it('always orders categories the same way regardless of input order', () => {
    const first = categorizeFeatures(['Sunroof', 'Bluetooth', 'Airbags']);
    const second = categorizeFeatures(['Airbags', 'Sunroof', 'Bluetooth']);

    expect(first.map((group) => group.category)).toEqual(second.map((group) => group.category));
    expect(first.map((group) => group.category)).toEqual(['Technology', 'Safety', 'Exterior']);
  });

  it('does not invent a feature: the output only ever contains what was passed in', () => {
    const groups = categorizeFeatures(['Heated Seats', 'Sunroof']);
    const allFeatures = groups.flatMap((group) => group.features);

    expect(allFeatures.sort()).toEqual(['Heated Seats', 'Sunroof'].sort());
  });

  it('returns nothing for an empty feature list', () => {
    expect(categorizeFeatures([])).toEqual([]);
  });
});
