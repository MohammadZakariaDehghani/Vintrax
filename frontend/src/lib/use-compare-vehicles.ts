'use client';

import { useQueries } from '@tanstack/react-query';
import type { VehicleDetail } from '@vintrax/shared';
import { api } from '@/lib/api-client';

/**
 * Fetches the full detail of every vehicle currently in the comparison list.
 *
 * One `GET /vehicles/:id` per id — there is no batch-by-ids endpoint, and
 * with the list capped at four this is at most four small requests, not a
 * scaling concern. `queryKey: ['vehicle', id]` is shared between every
 * consumer of this hook (`CompareBar` and `/compare` both use it) and with
 * anything else that ever fetches the same vehicle this way, so opening a
 * vehicle from the tray right after adding it, or having both mounted at
 * once, reuses one cached response instead of fetching it twice.
 *
 * A vehicle that fails to load (removed, unpublished, a bad id) is reported
 * per-slot rather than failing the whole comparison — one bad id must not
 * hide the three good ones.
 */
export function useCompareVehicles(ids: string[]) {
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['vehicle', id],
      queryFn: () => api.get<VehicleDetail>(`/vehicles/${id}`),
      staleTime: 60_000,
    })),
  });

  return {
    vehicles: queries
      .map((query) => query.data)
      .filter((vehicle): vehicle is VehicleDetail => Boolean(vehicle)),
    /** Ids that failed to load, e.g. a listing that was removed after being added. */
    failedIds: ids.filter((_, index) => queries[index]?.isError),
    isLoading: queries.some((query) => query.isLoading),
  };
}
