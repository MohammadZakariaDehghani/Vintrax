import { describe, expect, it } from 'vitest';
import { buildQuery } from './vintrax';

/**
 * Query-string construction for the inventory, auction and order lists. The
 * failure this prevents is subtle: an unset value stringified into the URL
 * reaches the API as the literal "undefined" and is rejected by validation,
 * which surfaces as an empty list rather than as an obvious bug.
 */
describe('buildQuery', () => {
  it('returns an empty string when nothing is set, so the path stays clean', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ page: undefined, pageSize: undefined })).toBe('');
  });

  it('drops undefined, null and empty values rather than serialising them', () => {
    expect(buildQuery({ page: 2, status: undefined, sort: null, q: '' })).toBe('?page=2');
  });

  it('keeps a zero, which is a real value and not an absent one', () => {
    expect(buildQuery({ page: 0 })).toBe('?page=0');
  });

  it('keeps false, for the same reason', () => {
    expect(buildQuery({ inspectedOnly: false })).toBe('?inspectedOnly=false');
  });

  it('encodes values that would otherwise break the URL', () => {
    expect(buildQuery({ q: 'Ford F-150 4x4 & more' })).toBe('?q=Ford+F-150+4x4+%26+more');
  });

  it('builds a paged list query', () => {
    expect(buildQuery({ page: 3, pageSize: 12 })).toBe('?page=3&pageSize=12');
  });
});
