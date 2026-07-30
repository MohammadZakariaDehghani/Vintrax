import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LISTING_SORTS, type ListingSearchResponse, type ListingSort } from '@atlas/shared';
import { api } from '../lib/api-client';
import { FilterPanel } from '../components/FilterPanel';
import { ListingCard, ListingCardSkeleton } from '../components/ListingCard';
import { EmptyState, ErrorAlert, Pagination } from '../components/ui';
import { formatEnum } from '../lib/format';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filtersToApiQuery,
  filtersToParams,
  parseFilters,
  type ListingFilters,
} from '../lib/search-params';
import { useIsNarrowViewport } from '../lib/use-media-query';

const PAGE_SIZE = 24;

const SORT_LABELS: Record<ListingSort, string> = {
  RELEVANCE: 'Most relevant',
  NEWEST: 'Newest first',
  PRICE_ASC: 'Price: low to high',
  PRICE_DESC: 'Price: high to low',
  MILEAGE_ASC: 'Lowest mileage',
  YEAR_DESC: 'Newest model year',
};

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);

  // The text box is local state so typing does not rewrite the URL on each
  // keystroke; it commits to the URL on submit.
  const [term, setTerm] = useState(filters.q ?? '');
  useEffect(() => setTerm(filters.q ?? ''), [filters.q]);

  // On phones the sidebar would push every result below ~24 checkboxes, so the
  // panel collapses behind a toggle and results lead the page instead.
  const isNarrow = useIsNarrowViewport();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = countActiveFilters(filters);

  const applyFilters = (next: ListingFilters) => {
    setSearchParams(filtersToParams(next), { replace: false });
  };

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['listings', 'search', filtersToApiQuery(filters, PAGE_SIZE)],
    queryFn: () =>
      api.get<ListingSearchResponse>(`/listings?${filtersToApiQuery(filters, PAGE_SIZE)}`),
    // Keeps the previous page visible while the next one loads, so the layout
    // does not collapse to skeletons on every filter change.
    placeholderData: keepPreviousData,
  });

  const goToPage = (page: number) => {
    applyFilters({ ...filters, page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="search-layout">
      {isNarrow ? (
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            aria-expanded={filtersOpen}
            aria-controls="filter-panel"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filtersOpen ? 'Hide filters' : 'Show filters'}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          {filtersOpen ? (
            <div id="filter-panel" style={{ marginTop: '1rem' }}>
              <FilterPanel filters={filters} facets={data?.facets} onChange={applyFilters} />
            </div>
          ) : null}
        </div>
      ) : (
        <FilterPanel filters={filters} facets={data?.facets} onChange={applyFilters} />
      )}

      <div>
        <form
          role="search"
          className="panel"
          style={{ marginBottom: '1.25rem', padding: '1rem' }}
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({ ...filters, q: term.trim() || undefined, page: 1 });
          }}
        >
          <div className="inline-row">
            <label htmlFor="search-input" className="visually-hidden">
              Search vehicles
            </label>
            <input
              id="search-input"
              type="search"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Search by make, model, colour or keyword"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            <button type="submit" className="btn">
              Search
            </button>
          </div>
        </form>

        <div className="search-toolbar">
          <p className="result-count" aria-live="polite">
            {isPending ? (
              'Searching…'
            ) : (
              <>
                <strong>{data?.total ?? 0}</strong>{' '}
                {data?.total === 1 ? 'vehicle' : 'vehicles'} found
                {filters.q ? (
                  <>
                    {' '}
                    for “<strong>{filters.q}</strong>”
                  </>
                ) : null}
              </>
            )}
          </p>

          <div className="inline-row">
            <label htmlFor="sort-select" style={{ fontSize: '0.9rem' }}>
              Sort by
            </label>
            <select
              id="sort-select"
              value={filters.sort}
              onChange={(event) =>
                applyFilters({ ...filters, sort: event.target.value as ListingSort, page: 1 })
              }
              style={{ width: 'auto' }}
            >
              {LISTING_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ErrorAlert error={error} />

        {isPending ? (
          <div className="listing-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <ListingCardSkeleton key={index} />
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="listing-grid" style={{ opacity: isFetching ? 0.6 : 1 }}>
              {data.items.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={goToPage} />
          </>
        ) : (
          <div className="panel">
            <EmptyState
              title="No vehicles match those filters"
              action={
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => applyFilters(EMPTY_FILTERS)}
                >
                  Clear all filters
                </button>
              }
            >
              Try widening your price or year range, or removing a filter.
              {filters.bodyType.length > 0 ? (
                <> You currently have {filters.bodyType.map(formatEnum).join(', ')} selected.</>
              ) : null}
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
