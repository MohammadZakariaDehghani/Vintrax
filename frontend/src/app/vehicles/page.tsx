'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutGrid, Rows3, SlidersHorizontal } from 'lucide-react';
import {
  LISTING_SORTS,
  type ListingSort,
  type VehicleSearchResponse,
} from '@atlas/shared';
import { api } from '@/lib/api-client';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filtersToApiQuery,
  filtersToParams,
  parseFilters,
  type VehicleFilters,
} from '@/lib/search-params';
import { Button, EmptyState, ErrorAlert, Input, Pagination, Select } from '@/components/ui';
import { useT } from '@/i18n/provider';
import { VehicleCard, VehicleCardSkeleton } from '@/components/vehicle-card';
import { VehicleRow, VehicleRowSkeleton } from '@/components/vehicle-row';
import { VehicleFilterPanel } from '@/components/vehicle-filter-panel';

const PAGE_SIZE = 24;
const VIEW_KEY = 'atlas.resultView';

const SORT_LABELS: Record<ListingSort, string> = {
  RELEVANCE: 'Most relevant',
  NEWEST: 'Newest first',
  PRICE_ASC: 'Price: low to high',
  PRICE_DESC: 'Price: high to low',
  MILEAGE_ASC: 'Lowest mileage',
  YEAR_DESC: 'Newest model year',
  ENDING_SOON: 'Ending soonest',
};

function BrowseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = parseFilters(new URLSearchParams(searchParams.toString()));

  // The text box is local state so typing does not rewrite the URL on every
  // keystroke; it commits on submit.
  const [term, setTerm] = useState(filters.q ?? '');
  const t = useT();
  useEffect(() => setTerm(filters.q ?? ''), [filters.q]);

  // On phones the sidebar would push every result below ~30 checkboxes, so it
  // collapses behind a toggle and results lead the page.
  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * List by default: it fits twice as many vehicles on a screen and aligns
   * every field into a column the eye can scan. Grid is kept for people
   * shopping on looks, and the choice is remembered per browser.
   */
  const [view, setView] = useState<'list' | 'grid'>('list');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_KEY);
      if (stored === 'list' || stored === 'grid') setView(stored);
    } catch {
      // Private browsing and blocked site data both throw; the default stands.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Not worth surfacing — the layout still works, it just is not remembered.
    }
  }, [view]);

  const applyFilters = (next: VehicleFilters) => {
    router.push(`/vehicles?${filtersToParams(next).toString()}`, { scroll: false });
  };

  const apiQuery = filtersToApiQuery(filters, PAGE_SIZE);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['vehicles', 'search', apiQuery],
    queryFn: () => api.get<VehicleSearchResponse>(`/vehicles?${apiQuery}`),
    // Keeps the previous page visible while the next loads, so the layout does
    // not collapse to skeletons on every filter change.
    placeholderData: keepPreviousData,
  });

  const activeCount = countActiveFilters(filters);

  return (
    <div className="container py-8">
      <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Button
            variant="outline"
            className="w-full lg:hidden"
            aria-expanded={filtersOpen}
            aria-controls="filter-panel"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            {filtersOpen ? 'Hide filters' : 'Show filters'}
            {activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>

          <div
            id="filter-panel"
            className={filtersOpen ? 'mt-4 lg:mt-0' : 'hidden lg:block'}
          >
            <VehicleFilterPanel
              filters={filters}
              facets={data?.facets}
              onChange={applyFilters}
            />
          </div>
        </div>

        <div>
          <form
            role="search"
            className="mb-5 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters({ ...filters, q: term.trim() || undefined, page: 1 });
            }}
          >
            <label htmlFor="browse-search" className="sr-only">
              {t.search.browseLabel}
            </label>
            <Input
              id="browse-search"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t.search.browsePlaceholder}
            />
            <Button type="submit">{t.search.submit}</Button>
          </form>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {isPending ? (
                t.search.searching
              ) : (
                <>
                  <strong className="tabular text-foreground">{data?.total ?? 0}</strong>{' '}
                  {data?.total === 1 ? t.search.resultsOne : t.search.resultsOther}
                  {filters.q ? (
                    <>
                      {' '}
                      {t.search.forQuery} “<strong className="text-foreground">{filters.q}</strong>”
                    </>
                  ) : null}
                  {data ? (
                    <span className="ml-2 text-xs opacity-70">
                      {data.provider} · {data.tookMs}ms
                    </span>
                  ) : null}
                </>
              )}
            </p>

            <div className="flex items-center gap-2">
              <div
                className="flex rounded-md border border-border p-0.5"
                role="group"
                aria-label="Result layout"
              >
                {([
                  ['list', 'List', Rows3],
                  ['grid', 'Grid', LayoutGrid],
                ] as const).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    aria-label={label}
                    onClick={() => setView(value)}
                    className={`grid h-8 w-8 place-items-center rounded transition-colors ${
                      view === value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </button>
                ))}
              </div>

              <label htmlFor="sort-select" className="text-sm text-muted-foreground">
                Sort
              </label>
              <Select
                id="sort-select"
                className="w-auto"
                value={filters.sort}
                onChange={(event) =>
                  applyFilters({ ...filters, sort: event.target.value as ListingSort, page: 1 })
                }
              >
                {LISTING_SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <ErrorAlert error={error} className="mb-5" />

          {isPending ? (
            view === 'list' ? (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                {Array.from({ length: 5 }, (_, index) => (
                  <VehicleRowSkeleton key={index} />
                ))}
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <VehicleCardSkeleton key={index} />
                ))}
              </div>
            )
          ) : data && data.items.length > 0 ? (
            <>
              <div style={{ opacity: isFetching ? 0.6 : 1 }}>
                {view === 'list' ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    {data.items.map((vehicle) => (
                      <VehicleRow key={vehicle.id} vehicle={vehicle} />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {data.items.map((vehicle) => (
                      <VehicleCard key={vehicle.id} vehicle={vehicle} />
                    ))}
                  </div>
                )}
              </div>
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                onChange={(page) => {
                  applyFilters({ ...filters, page });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          ) : (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState
                title={t.search.noMatchTitle}
                description={t.search.noMatchHelp}
                action={
                  <Button variant="outline" onClick={() => applyFilters(EMPTY_FILTERS)}>
                    {t.search.clearAll}
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BrowsePage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="container py-16" />}>
      <BrowseContent />
    </Suspense>
  );
}
