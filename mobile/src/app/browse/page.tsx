'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, Search, X } from 'lucide-react';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filtersToApiQuery,
  filtersToParams,
  parseFilters,
  type VehicleFilters,
} from '@atlas/client';
import { useVehicleSearch } from '@/lib/queries';
import { formatNumber } from '@/lib/format';
import { Button, Spinner, StateMessage } from '@/components/ui';
import { VehicleCard, VehicleCardSkeleton } from '@/components/vehicle-card';
import { ErrorState } from '@/components/error-state';
import { FilterSheet } from '@/components/filter-sheet';

const PAGE_SIZE = 12;

export default function BrowsePage() {
  return (
    <Suspense fallback={<Spinner label="Loading inventory" />}>
      <Browse />
    </Suspense>
  );
}

function Browse() {
  const router = useRouter();
  const params = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);

  // The URL is the state. A filtered search is therefore shareable, survives a
  // reload, and works with the back button — which on a phone is a swipe
  // people use constantly.
  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  const [term, setTerm] = useState(filters.q ?? '');

  const apiQuery = useMemo(() => `?${filtersToApiQuery(filters, PAGE_SIZE)}`, [filters]);
  const search = useVehicleSearch(apiQuery);

  const apply = useCallback(
    (next: VehicleFilters) => {
      const query = filtersToParams({ ...next, page: 1 }).toString();
      router.replace(query ? `/browse?${query}` : '/browse', { scroll: false });
    },
    [router],
  );

  const activeCount = countActiveFilters(filters);
  const first = search.data?.pages[0];
  const vehicles = search.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <div
        className="sticky top-0 z-30 space-y-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ ...filters, q: term.trim() || undefined });
          }}
          className="flex items-center gap-2"
        >
          <label htmlFor="browse-search" className="sr-only">
            Search vehicles
          </label>
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-secondary px-3">
            <Search aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              id="browse-search"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search inventory"
              className="min-h-touch w-full bg-transparent py-2 text-base outline-none"
            />
            {term ? (
              <button
                type="button"
                onClick={() => {
                  setTerm('');
                  apply({ ...filters, q: undefined });
                }}
                aria-label="Clear search"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full active:bg-background"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={`Filters${activeCount ? `, ${activeCount} active` : ''}`}
            className="relative inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl bg-secondary active:bg-border"
          >
            <SlidersHorizontal aria-hidden className="h-5 w-5" />
            {activeCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold text-primary-foreground">
                {activeCount}
              </span>
            ) : null}
          </button>
        </form>

        {first ? (
          <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
            {formatNumber(first.total)} vehicle{first.total === 1 ? '' : 's'}
            {activeCount > 0 ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="font-medium text-primary underline"
                  onClick={() => {
                    setTerm('');
                    apply(EMPTY_FILTERS);
                  }}
                >
                  Clear filters
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="p-3">
        {search.isPending ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <VehicleCardSkeleton key={index} />
            ))}
          </div>
        ) : search.isError ? (
          <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        ) : vehicles.length === 0 ? (
          <StateMessage
            title="No matches"
            description="Try fewer filters, or a different search term."
            action={
              activeCount > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTerm('');
                    apply(EMPTY_FILTERS);
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {vehicles.map((vehicle) => (
                <VehicleCard key={vehicle.id} vehicle={vehicle} />
              ))}
            </div>

            {search.hasNextPage ? (
              <div className="pt-4">
                <Button
                  variant="outline"
                  fullWidth
                  size="large"
                  loading={search.isFetchingNextPage}
                  onClick={() => void search.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                That is everything matching.
              </p>
            )}
          </>
        )}
      </div>

      {sheetOpen ? (
        <FilterSheet
          filters={filters}
          facets={first?.facets}
          onClose={() => setSheetOpen(false)}
          onApply={(next) => {
            apply(next);
            setSheetOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
