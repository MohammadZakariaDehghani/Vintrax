import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filtersToApiQuery,
  filtersToParams,
  parseFilters,
  toggleInArray,
} from './search-params';

describe('parseFilters', () => {
  it('applies defaults when the URL carries no filters', () => {
    const filters = parseFilters(new URLSearchParams());
    expect(filters.sort).toBe('RELEVANCE');
    expect(filters.page).toBe(1);
    expect(filters.bodyType).toEqual([]);
  });

  it('splits comma-separated multi-select values', () => {
    const filters = parseFilters(new URLSearchParams('bodyType=SUV,TRUCK&fuelType=ELECTRIC'));
    expect(filters.bodyType).toEqual(['SUV', 'TRUCK']);
    expect(filters.fuelType).toEqual(['ELECTRIC']);
  });

  it('ignores a sort value that is not part of the contract', () => {
    expect(parseFilters(new URLSearchParams('sort=CHEAPEST')).sort).toBe('RELEVANCE');
  });

  it('falls back to page 1 for a non-numeric or negative page', () => {
    expect(parseFilters(new URLSearchParams('page=abc')).page).toBe(1);
    expect(parseFilters(new URLSearchParams('page=-4')).page).toBe(1);
  });
});

describe('filtersToParams', () => {
  it('omits defaults so shared URLs stay short', () => {
    expect(filtersToParams({ ...EMPTY_FILTERS, q: 'rav4' }).toString()).toBe('q=rav4');
  });

  it('round-trips through parseFilters without losing anything', () => {
    const original = {
      ...EMPTY_FILTERS,
      q: 'electric suv',
      make: 'Tesla',
      minPrice: '20000',
      bodyType: ['SUV', 'WAGON'],
      saleChannel: ['AUCTION'],
      province: 'BC',
      inspectedOnly: 'true',
      sort: 'PRICE_DESC' as const,
      page: 2,
    };
    expect(parseFilters(filtersToParams(original))).toEqual(original);
  });
});

describe('filtersToApiQuery', () => {
  it('always sends an explicit page and page size to the API', () => {
    const query = new URLSearchParams(filtersToApiQuery(EMPTY_FILTERS, 24));
    expect(query.get('page')).toBe('1');
    expect(query.get('pageSize')).toBe('24');
  });
});

describe('toggleInArray', () => {
  it('adds a value that is absent and removes one that is present', () => {
    expect(toggleInArray(['SUV'], 'TRUCK')).toEqual(['SUV', 'TRUCK']);
    expect(toggleInArray(['SUV', 'TRUCK'], 'SUV')).toEqual(['TRUCK']);
  });
});

describe('countActiveFilters', () => {
  it('counts single and multi-select filters but not sort or page', () => {
    expect(
      countActiveFilters({
        ...EMPTY_FILTERS,
        q: 'rav4',
        province: 'ON',
        bodyType: ['SUV', 'TRUCK'],
        sort: 'PRICE_ASC',
        page: 5,
      }),
    ).toBe(4);
  });
});
