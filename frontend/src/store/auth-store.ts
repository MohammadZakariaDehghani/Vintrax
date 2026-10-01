'use client';

/**
 * Session state lives in `@vintrax/client` so both applications share one
 * implementation of sign-in, restore, token rotation and sign-out.
 *
 * Imported from `@/lib/api-client` first, so the shared client is configured
 * with this application's endpoints before the store can issue a request.
 */
import '@/lib/api-client';

export {
  useAuthStore,
  useAuthLoading,
  useHasPermission,
  useIsAdmin,
  useIsSeller,
  useUser,
} from '@vintrax/client';

import { useAuthStore } from '@vintrax/client';

/**
 * A private seller: someone selling their own car, not a dealership. They get
 * a simple "My listings" — add a car, save a draft, publish, mark it sold —
 * without the dealer tools (costs, CSV import and export, finance, the dealer
 * dashboard and its help assistant).
 */
export function useIsPrivateSeller(): boolean {
  return useAuthStore((state) => state.user?.role === 'SELLER');
}
