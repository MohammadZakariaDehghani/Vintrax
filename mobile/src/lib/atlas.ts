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
  TransactionSummary,
  VehicleDetail,
  VehicleSearchResponse,
  VehicleSummary,
} from '@atlas/shared';
import { api } from '@/lib/api-client';

/**
 * Every call this application makes to the API, in one place and grouped by
 * resource.
 *
 * No component calls `fetch` or even `api` directly. That keeps paths, query
 * strings and response types in one file, so an endpoint change is one edit
 * rather than a search across screens. The types come from `@atlas/shared`, so
 * a contract change is a compile error here rather than a runtime surprise on
 * someone's phone.
 */

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
}

export const atlas = {
  auth: {
    me: () => api.get<PublicUser>('/auth/me'),
    resendVerification: () => api.post<void>('/auth/email/resend'),
  },

  vehicles: {
    search: (searchQuery: string) => api.get<VehicleSearchResponse>(`/vehicles${searchQuery}`),
    byIdOrSlug: (idOrSlug: string) => api.get<VehicleDetail>(`/vehicles/${idOrSlug}`),
    mine: (params: PageQuery = {}) =>
      api.get<Paginated<VehicleSummary>>(`/vehicles/mine${query({ ...params })}`),
    create: (input: unknown) => api.post<VehicleDetail>('/vehicles', input),
    update: (id: string, input: unknown) => api.patch<VehicleDetail>(`/vehicles/${id}`, input),
  },

  auctions: {
    list: (params: { status?: string; sort?: string } & PageQuery = {}) =>
      api.get<Paginated<AuctionSummary>>(`/auctions${query({ ...params })}`),
    byId: (id: string) => api.get<AuctionDetail>(`/auctions/${id}`),
    bids: (id: string, params: PageQuery = {}) =>
      api.get<Paginated<BidSummary>>(`/auctions/${id}/bids${query({ ...params })}`),
    myBids: (params: PageQuery = {}) =>
      api.get<Paginated<BidSummary>>(`/auctions/my-bids${query({ ...params })}`),
    placeBid: (id: string, amountCad: number) =>
      api.post<AuctionDetail>(`/auctions/${id}/bids`, { amountCad }),
  },

  favourites: {
    list: (params: PageQuery = {}) =>
      api.get<Paginated<VehicleSummary>>(`/me/favourites${query({ ...params })}`),
    add: (vehicleId: string) => api.put<void>(`/vehicles/${vehicleId}/favourite`),
    remove: (vehicleId: string) => api.delete<void>(`/vehicles/${vehicleId}/favourite`),
  },

  conversations: {
    list: (params: PageQuery = {}) =>
      api.get<Paginated<ConversationSummary>>(`/conversations${query({ ...params })}`),
    byId: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
    start: (vehicleId: string, body: string) =>
      api.post<ConversationDetail>('/conversations', { vehicleId, body }),
    reply: (id: string, body: string) =>
      api.post<MessageDto>(`/conversations/${id}/messages`, { body }),
    unreadCount: () => api.get<{ count: number }>('/conversations/unread-count'),
  },

  orders: {
    list: (params: PageQuery = {}) =>
      api.get<Paginated<TransactionSummary>>(`/orders${query({ ...params })}`),
    byId: (id: string) => api.get<TransactionSummary>(`/orders/${id}`),
  },

  notifications: {
    list: (params: PageQuery = {}) =>
      api.get<Paginated<NotificationDto>>(`/notifications${query({ ...params })}`),
    unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
    markRead: (id: string) => api.patch<NotificationDto>(`/notifications/${id}/read`, {}),
    markAllRead: () => api.patch<void>('/notifications/read-all', {}),
  },

  dealers: {
    myAnalytics: () => api.get<DealerAnalytics>('/dealers/analytics/me'),
  },

  uploads: {
    /**
     * Returns the stored object. The API owns type and size validation and
     * decides where the bytes land, so this response is identical whether
     * storage is local disk or S3.
     */
    image: (file: File) =>
      api.upload<{ url: string; key: string; sizeBytes: number; contentType: string }>(
        '/uploads/images',
        file,
      ),
  },
};
