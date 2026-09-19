'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { VehicleSearchResponse } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { clearLastSearch, getLastSearch } from '@/lib/last-search';
import { parseFilters } from '@/lib/search-params';
import { summarizeFilters } from '@/lib/summarize-filters';
import { useT } from '@/i18n/provider';
import { VehicleRow, VehicleRowSkeleton } from '@/components/vehicle-row';

/** "Show 5 related search results" — how many of the matching vehicles to preview here. */
const RELATED_RESULTS = 5;

/**
 * "Pick up where you left off" — a saved search read from this browser's own
 * storage, never from the server: nothing about a visitor's search history
 * reaches Vintrax, only their own device remembers it, and only once they
 * have said that is all right (`CookieConsentBanner`).
 *
 * Reading `localStorage` happens in an effect, not during render, for the
 * same reason the banner defers its own check: the server has no storage to
 * read, so this always starts with nothing to show and reveals the saved
 * search only after mount, rather than risking a markup mismatch.
 */
export function ContinueSearchCard() {
  const [query, setQuery] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    setQuery(getLastSearch());
  }, []);

  // The saved search is only ever a set of filters, not a result set — the
  // listings themselves may have sold or changed since, so this always asks
  // the API for what currently matches rather than replaying stale results.
  const results = useQuery({
    queryKey: ['vehicles', 'continue-search', query],
    queryFn: () =>
      api.get<VehicleSearchResponse>(`/vehicles?${query}&page=1&pageSize=${RELATED_RESULTS}`),
    enabled: query !== null,
    staleTime: 30_000,
  });

  if (!query) return null;

  const summary = summarizeFilters(parseFilters(new URLSearchParams(query)));
  const matches = results.data?.items ?? [];

  return (
    <div className="container pt-6">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t.continueSearch.title}</p>
            <p className="truncate text-sm text-muted-foreground">{summary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/vehicles?${query}`}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              {t.continueSearch.cta}
            </Link>
            <button
              type="button"
              aria-label={t.continueSearch.dismiss}
              onClick={() => {
                clearLastSearch();
                setQuery(null);
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {results.isLoading ? (
          <div className="border-t border-border">
            {Array.from({ length: RELATED_RESULTS }, (_, index) => (
              <VehicleRowSkeleton key={index} />
            ))}
          </div>
        ) : matches.length > 0 ? (
          <div className="border-t border-border">
            {matches.map((vehicle) => (
              <VehicleRow key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
