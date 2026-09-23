import type {
  AuctionDetail,
  AuctionSummary,
  BidSummary,
  ConversationDetail,
  ConversationSummary,
  DealerAnalytics,
  MessageDto,
  NotificationDto,
  Paginated,
  PublicUser,
  UploadedVehicleImage,
  VehicleDetail,
  VehicleSearchResponse,
  VehicleSummary,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';

/**
 * Every call this application makes to the API, in one place and grouped by
 * resource.
 *
 * No component calls `fetch` or even `api` directly. That keeps paths, query
 * strings and response types in one file, so an endpoint change is one edit
 * rather than a search across screens. The types come from `@vintrax/shared`, so
 * a contract change is a compile error here rather than a runtime surprise on
 * someone's phone.
 */

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

/**
 * Builds a query string, dropping anything unset. Passing `page=undefined`
 * through would reach the API as the literal string "undefined" and fail
 * validation, so the filtering is the point rather than tidiness.
 *
 * Exported for its own tests.
 */
export function buildQuery(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
}

export const vintrax = {
  auth: {
    me: () => api.get<PublicUser>('/auth/me'),
    resendVerification: () => api.post<void>('/auth/email/resend'),
  },

  vehicles: {
    search: (searchQuery: string) => api.get<VehicleSearchResponse>(`/vehicles${searchQuery}`),
    byIdOrSlug: (idOrSlug: string) => api.get<VehicleDetail>(`/vehicles/${idOrSlug}`),
    mine: (params: PageQuery = {}) =>
      api.get<Paginated<VehicleSummary>>(`/vehicles/mine${buildQuery({ ...params })}`),
    create: (input: unknown) => api.post<VehicleDetail>('/vehicles', input),
    update: (id: string, input: unknown) => api.patch<VehicleDetail>(`/vehicles/${id}`, input),
  },

  auctions: {
    list: (params: { status?: string; sort?: string } & PageQuery = {}) =>
      api.get<Paginated<AuctionSummary>>(`/auctions${buildQuery({ ...params })}`),
    byId: (id: string) => api.get<AuctionDetail>(`/auctions/${id}`),
    bids: (id: string, params: PageQuery = {}) =>
      api.get<Paginated<BidSummary>>(`/auctions/${id}/bids${buildQuery({ ...params })}`),
    myBids: (params: PageQuery = {}) =>
      api.get<Paginated<BidSummary>>(`/auctions/my-bids${buildQuery({ ...params })}`),
    placeBid: (id: string, amountCad: number) =>
      api.post<AuctionDetail>(`/auctions/${id}/bids`, { amountCad }),
  },

  favourites: {
    list: (params: PageQuery = {}) =>
      api.get<Paginated<VehicleSummary>>(`/me/favourites${buildQuery({ ...params })}`),
    add: (vehicleId: string) => api.put<void>(`/vehicles/${vehicleId}/favourite`),
    remove: (vehicleId: string) => api.delete<void>(`/vehicles/${vehicleId}/favourite`),
  },

  conversations: {
    list: (params: PageQuery = {}) =>
      api.get<Paginated<ConversationSummary>>(`/conversations${buildQuery({ ...params })}`),
    byId: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
    start: (vehicleId: string, body: string) =>
      api.post<ConversationDetail>('/conversations', { vehicleId, body }),
    reply: (id: string, body: string) =>
      api.post<MessageDto>(`/conversations/${id}/messages`, { body }),
    unreadCount: () => api.get<{ count: number }>('/conversations/unread-count'),
  },

  notifications: {
    list: (params: PageQuery = {}) =>
      api.get<Paginated<NotificationDto>>(`/notifications${buildQuery({ ...params })}`),
    unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
    markRead: (id: string) => api.patch<NotificationDto>(`/notifications/${id}/read`, {}),
    markAllRead: () => api.patch<void>('/notifications/read-all', {}),
  },

  dealers: {
    myAnalytics: () => api.get<DealerAnalytics>('/dealers/analytics/me'),
  },

  uploads: {
    /**
     * Returns the processed photo: `url` is an optimized rendition to attach
     * to the listing, `optimized` every rendition. The API owns validation
     * and processing (documentation/images.md), so this response is identical
     * whether storage is local disk or S3.
     */
    image: (file: File) => api.upload<UploadedVehicleImage>('/uploads/images', file),
  },
};
