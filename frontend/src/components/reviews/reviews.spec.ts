import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  REVIEW_EMPTY_MESSAGE,
  normalizeReviewText,
  reviewCreateSchema,
  reviewReportSchema,
  type PublicReviewPage,
} from '@vintrax/shared';
import { withReviews } from '@/lib/vehicle-structured-data';
import { StarInput, Stars } from './stars';
import { VehicleReviews } from './vehicle-reviews';

/**
 * The public review section as it is server-rendered on a vehicle page, its
 * star controls, the client-side validation it shares with the API, and the
 * structured data it adds. Clicking through the form and the report dialog is
 * exercised in the browser (see documentation/reviews.md).
 */

const page = (overrides: Partial<PublicReviewPage> = {}): PublicReviewPage => ({
  reviews: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      rating: 5,
      content: 'Great experience with this vehicle.\n\nThe description was accurate.',
      displayName: 'Anonymous',
      verifiedPurchase: false,
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      edited: false,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      rating: 4,
      content: '<script>alert(1)</script> Very clean vehicle.',
      displayName: 'Sam',
      verifiedPurchase: true,
      createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      edited: true,
    },
  ],
  pagination: { hasMore: true, nextCursor: 'abc' },
  summary: { average: 4.5, total: 23, distribution: { 1: 0, 2: 1, 3: 2, 4: 5, 5: 15 } },
  ...overrides,
});

function render(initial: PublicReviewPage | null): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(VehicleReviews, { vehicleId: 'v1', vehicleTitle: '2021 Mazda CX-5', initial }),
    ),
  );
}

describe('the reviews section', () => {
  it('renders the heading, summary and distribution', () => {
    const html = render(page());
    expect(html).toContain('id="reviews"');
    expect(html).toContain('Reviews &amp; Comments');
    expect(html).toContain('4.5');
    expect(html).toContain('Based on 23 reviews');
    expect(html).toContain('aria-label="4.5 out of 5 stars"');
    expect(html).toMatch(/5 stars<\/dt>.*?15<\/dd>/s);
    expect(html).toContain('Write a review');
  });

  it('lists reviews as text, never as markup', () => {
    const html = render(page());
    expect(html).toContain('Great experience with this vehicle.');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Verified purchase');
    expect(html).toContain('edited');
    expect(html.match(/>Report<span class="sr-only">/g)).toHaveLength(2);
  });

  it('offers "Load more" only when there is more', () => {
    expect(render(page())).toContain('Load more reviews');
    expect(render(page({ pagination: { hasMore: false, nextCursor: null } }))).not.toContain(
      'Load more reviews',
    );
  });

  it('shows the empty state with no approved reviews', () => {
    const html = render(
      page({
        reviews: [],
        pagination: { hasMore: false, nextCursor: null },
        summary: { average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      }),
    );
    expect(html).toContain(REVIEW_EMPTY_MESSAGE);
    expect(html).not.toContain('Based on');
  });
});

describe('stars', () => {
  it('reads a rating as words', () => {
    expect(renderToStaticMarkup(createElement(Stars, { rating: 4 }))).toContain(
      'aria-label="4 out of 5 stars"',
    );
  });

  it('chooses a rating with a keyboard-reachable radio group', () => {
    const html = renderToStaticMarkup(
      createElement(StarInput, { id: 'r', value: 3, onChange: () => undefined }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(5);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="3 stars, Good"');
    // One stop in the tab order: the chosen star.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });
});

describe('client-side validation', () => {
  const issue = (input: unknown) => {
    const result = reviewCreateSchema.safeParse(input);
    return result.success ? null : result.error.issues[0]!.message;
  };

  it('requires a rating from 1 to 5', () => {
    expect(issue({ content: 'A perfectly fine review.' })).toMatch(/rating/i);
    expect(issue({ rating: 6, content: 'A perfectly fine review.' })).toBe(
      'Choose a rating from 1 to 5 stars',
    );
  });

  it('requires 10 to 2,000 characters after tidying', () => {
    expect(issue({ rating: 4, content: '   too short   ' })).toBe('Write at least 10 characters');
    expect(issue({ rating: 4, content: 'x'.repeat(2001) })).toBe('Keep it under 2000 characters');
    expect(normalizeReviewText('a   b\n\n\n\nc')).toBe('a b\n\nc');
  });

  it('keeps a nickname to plain characters', () => {
    expect(
      issue({ rating: 4, content: 'A perfectly fine review.', displayName: 'me@example.com' }),
    ).toMatch(/letters/);
    const ok = reviewCreateSchema.parse({
      rating: 4,
      content: 'A perfectly fine review.',
      displayName: "  Jean-Luc  O'Neil ",
    });
    expect(ok.displayName).toBe("Jean-Luc O'Neil");
  });

  it('requires a report reason', () => {
    expect(reviewReportSchema.safeParse({}).success).toBe(false);
    expect(reviewReportSchema.parse({ reason: 'SPAM', details: '  ' }).details).toBeNull();
  });
});

describe('structured data', () => {
  const car = { '@type': 'Car', name: 'Car' };

  it('adds the rating and the shown reviews when there are approved reviews', () => {
    const data = withReviews(car, page()) as {
      aggregateRating: unknown;
      review: Array<{ author: unknown }>;
    };
    expect(data.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 23,
      bestRating: 5,
      worstRating: 1,
    });
    expect(data.review).toHaveLength(2);
    expect(data.review[0]!.author).toEqual({ '@type': 'Person', name: 'Anonymous' });
  });

  it('adds nothing without an approved review', () => {
    expect(withReviews(car, null)).toEqual(car);
    expect(
      withReviews(
        car,
        page({
          summary: { average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
        }),
      ),
    ).toEqual(car);
  });
});
