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
