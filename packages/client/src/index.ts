/**
 * The Vintrax client contract: everything the web and mobile applications need
 * to talk to the API and render its values consistently.
 *
 * Nothing here renders UI or knows about a framework's router. That is what
 * lets one implementation of session handling, token refresh, error mapping
 * and money formatting serve two applications — a second client inherits the
 * behaviour rather than reimplementing it slightly differently.
 */
export { configureVintraxClient, vintraxClientConfig, type VintraxClientConfig } from './config';

export {
  ApiError,
  api,
  apiRequest,
  messageForNonJson,
  setSessionExpiredHandler,
  tokenStore,
} from './api-client';

export {
  useAuthStore,
  useAuthLoading,
  useHasPermission,
  useIsAdmin,
  useIsSeller,
  useUser,
} from './auth-store';

export { useAuctionSocket } from './use-auction-socket';
export { useMessagingSocket } from './use-messaging-socket';

export {
  cn,
  PAYMENT_ESTIMATE,
  estimateMonthlyPayment,
  formatCompact,
  formatCountdown,
  formatDate,
  formatEnum,
  formatKm,
  formatLocation,
  formatNumber,
  formatPrice,
  formatProvince,
  formatRelativeTime,
  isClosingSoon,
  joinSpecs,
} from './format';

export {
  EMPTY_FILTERS,
  countActiveFilters,
  filtersToApiQuery,
  filtersToParams,
  parseFilters,
  toggleInArray,
  type VehicleFilters,
} from './search-params';
