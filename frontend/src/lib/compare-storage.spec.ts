import { describe, expect, it } from 'vitest';
import { MAX_COMPARE_VEHICLES, parseStoredIds } from './compare-storage';

/**
 * `readCompareIds`/`writeCompareIds` themselves are thin `window.localStorage`
 * wrappers and untested here, the same as `last-search.ts`'s equivalents —
 * this project's test environment is Node, with no DOM globals. What can and
 * does need testing is `parseStoredIds`, the part that decides what a
 * hand-edited, stale or corrupted stored value is allowed to mean.
 */
describe('parseStoredIds', () => {
  it('returns nothing for a missing value', () => {
    expect(parseStoredIds(null)).toEqual([]);
  });

  it('round-trips a well-formed value', () => {
    expect(parseStoredIds(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('returns nothing for a value that is not a JSON array', () => {
    expect(parseStoredIds('"not an array"')).toEqual([]);
  });

  it('returns nothing for malformed JSON, rather than throwing', () => {
    expect(() => parseStoredIds('{not json')).not.toThrow();
    expect(parseStoredIds('{not json')).toEqual([]);
  });

  it('drops non-string and empty entries from a hand-edited value', () => {
    expect(parseStoredIds('["a", 1, null, "b", ""]')).toEqual(['a', 'b']);
  });

  it('de-duplicates a value with a repeated id', () => {
    expect(parseStoredIds('["a", "a", "b"]')).toEqual(['a', 'b']);
  });

  it('never returns more than the maximum, even from a stale or hand-edited value', () => {
    const many = Array.from({ length: MAX_COMPARE_VEHICLES + 5 }, (_, index) => `id-${index}`);
    expect(parseStoredIds(JSON.stringify(many))).toHaveLength(MAX_COMPARE_VEHICLES);
  });
});
