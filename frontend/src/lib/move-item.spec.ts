import { describe, expect, it } from 'vitest';
import { moveItem } from './move-item';

describe('moveItem', () => {
  it('moves an entry forward, shifting the ones it passes back', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an entry backward, shifting the ones it passes forward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('makes any photo the first one', () => {
    expect(moveItem(['main', 'side', 'rear'], 2, 0)).toEqual(['rear', 'main', 'side']);
  });

  it('leaves the list alone for a move to the same place or out of range', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, -1, 0)).toEqual(list);
    expect(moveItem(list, 0, 2)).toEqual(list);
  });

  it('does not change the list it was given', () => {
    const list = ['a', 'b', 'c'];
    moveItem(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});
