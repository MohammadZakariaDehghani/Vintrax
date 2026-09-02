import { describe, expect, it } from 'vitest';
import { withPage } from './paging';

/**
 * Regression cover for a real failure: the browse screen builds a query that
 * already contains `page`, and appending a second one made the API read the
 * value as an array. Validation rejected it with "expected number, received
 * nan", which reached the user as an empty result list with no explanation.
 */
describe('withPage', () => {
  it('replaces an existing page rather than appending a second one', () => {
    const result = withPage('?q=Tesla&sort=RELEVANCE&page=1&pageSize=12', 3);
    expect(result).not.toMatch(/page=1/);
    expect(new URLSearchParams(result.slice(1)).getAll('page')).toEqual(['3']);
  });

  it('adds the page when the query has none', () => {
    expect(withPage('?sort=NEWEST&pageSize=6', 2)).toBe('?sort=NEWEST&pageSize=6&page=2');
  });

  it('accepts a query with or without a leading question mark', () => {
    expect(withPage('q=Ford', 2)).toBe('?q=Ford&page=2');
    expect(withPage('?q=Ford', 2)).toBe('?q=Ford&page=2');
  });

  it('handles an empty query', () => {
    expect(withPage('', 1)).toBe('?page=1');
    expect(withPage('?', 1)).toBe('?page=1');
  });

  it('preserves the other parameters and their encoding', () => {
    const result = withPage('?q=Ford+F-150+%26+more&province=BC', 4);
    const params = new URLSearchParams(result.slice(1));
    expect(params.get('q')).toBe('Ford F-150 & more');
    expect(params.get('province')).toBe('BC');
    expect(params.get('page')).toBe('4');
  });
});
