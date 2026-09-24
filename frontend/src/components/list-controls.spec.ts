import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_OPTIONS, runBulk } from './list-controls';
import { PreviousPrice } from './previous-price';

describe('bulk actions on selected rows', () => {
  it('reports how many worked and why the first failure failed', async () => {
    const outcome = await runBulk(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new Error('Already verified');
      return id;
    });
    expect(outcome).toEqual({ succeeded: 2, failed: 1, firstError: 'Already verified' });
  });

  it('offers 10, 20, 50 and 100 per page', () => {
    expect([...PAGE_SIZE_OPTIONS]).toEqual([10, 20, 50, 100]);
  });
});

describe('the previous price', () => {
  const render = (previous: number | null, current: number) =>
    renderToStaticMarkup(createElement(PreviousPrice, { previous, current }));

  it('is struck through when the price changed', () => {
    const html = render(25_000, 23_500);
    expect(html).toContain('<s>');
    expect(html).toContain('25,000');
  });

  it('is not shown when the price never changed', () => {
    expect(render(null, 23_500)).toBe('');
    expect(render(23_500, 23_500)).toBe('');
  });
});
