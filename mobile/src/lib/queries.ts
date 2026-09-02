'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { Paginated, VehicleSummary } from '@atlas/shared';
import { atlas, type PageQuery } from '@/lib/atlas';

/**
 * Query keys are hierarchical, so invalidating `['vehicles']` clears every
 * vehicle list and detail at once — which is what a mutation usually wants.
 */
export const keys = {
  vehicles: ['vehicles'] as const,
  vehicleSearch: (query: string) => ['vehicles', 'search', query] as const,
  vehicle: (idOrSlug: string) => ['vehicles', 'detail', idOrSlug] as const,
  myVehicles: () => ['vehicles', 'mine'] as const,
  auctions: ['auctions'] as const,
  auctionList: (status: string) => ['auctions', 'list', status] as const,
  auction: (id: string) => ['auctions', 'detail', id] as const,
  auctionBids: (id: string) => ['auctions', 'bids', id] as const,
  myBids: () => ['auctions', 'my-bids'] as const,
  favourites: ['favourites'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  orders: ['orders'] as const,
  notifications: ['notifications'] as const,
  dealerAnalytics: ['dealers', 'analytics', 'me'] as const,
};

const PAGE_SIZE = 12;

/**
 * Infinite scrolling over the API's page/pageSize pagination. Loading the
 * whole catalogue into a phone would be slow and pointless — the server
 * already knows how to page.
 */
function nextPageParam<T>(last: Paginated<T>, pages: Paginated<T>[]): number | undefined {
  const loaded = pages.reduce((total, page) => total + page.items.length, 0);
  return loaded < last.total ? last.page + 1 : undefined;
}

export function useVehicleSearch(apiQuery: string) {
  return useInfiniteQuery({
    queryKey: keys.vehicleSearch(apiQuery),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const separator = apiQuery.startsWith('?') ? '&' : '?';
      return atlas.vehicles.search(`${apiQuery}${separator}page=${pageParam}`);
    },
    getNextPageParam: nextPageParam,
  });
}

export function useVehicle(idOrSlug: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.vehicle(idOrSlug),
    queryFn: () => atlas.vehicles.byIdOrSlug(idOrSlug),
    enabled: options?.enabled ?? Boolean(idOrSlug),
  });
}

export function useMyVehicles(params: PageQuery = {}) {
  return useQuery({
    queryKey: [...keys.myVehicles(), params] as const,
    queryFn: () => atlas.vehicles.mine({ pageSize: PAGE_SIZE, ...params }),
  });
}

export function useAuctions(status: string) {
  return useInfiniteQuery({
    queryKey: keys.auctionList(status),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      atlas.auctions.list({ status, page: pageParam, pageSize: PAGE_SIZE }),
    getNextPageParam: nextPageParam,
    // Auction lists carry prices and end times, so they go stale fast. The
    // detail page holds a socket; a list refresh is the cheaper equivalent.
    staleTime: 15_000,
  });
}

export function useAuction(id: string) {
  return useQuery({
    queryKey: keys.auction(id),
    queryFn: () => atlas.auctions.byId(id),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export function useAuctionBids(id: string) {
  return useQuery({
    queryKey: keys.auctionBids(id),
    queryFn: () => atlas.auctions.bids(id, { pageSize: 20 }),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export function useMyBids() {
  return useQuery({
    queryKey: keys.myBids(),
    queryFn: () => atlas.auctions.myBids({ pageSize: 50 }),
  });
}

export function useFavourites(options?: Partial<UseQueryOptions<Paginated<VehicleSummary>>>) {
  return useQuery({
    queryKey: keys.favourites,
    queryFn: () => atlas.favourites.list({ pageSize: 50 }),
    ...options,
  });
}

/**
 * Favouriting is optimistic: the heart fills immediately and rolls back if the
 * API refuses. On a phone, waiting a round trip to see a tap register feels
 * broken.
 */
export function useToggleFavourite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vehicleId, favourited }: { vehicleId: string; favourited: boolean }) =>
      favourited ? atlas.favourites.remove(vehicleId) : atlas.favourites.add(vehicleId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.favourites });
      void queryClient.invalidateQueries({ queryKey: keys.vehicles });
    },
  });
}

export function useConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: () => atlas.conversations.list({ pageSize: 30 }),
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: keys.conversation(id),
    queryFn: () => atlas.conversations.byId(id),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: keys.orders,
    queryFn: () => atlas.orders.list({ pageSize: 30 }),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => atlas.notifications.list({ pageSize: 20 }),
  });
}

export function useDealerAnalytics(enabled: boolean) {
  return useQuery({
    queryKey: keys.dealerAnalytics,
    queryFn: () => atlas.dealers.myAnalytics(),
    enabled,
  });
}
