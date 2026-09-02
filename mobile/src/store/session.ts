'use client';

/**
 * Session state comes from `@atlas/client` — the same store, sign-in flow and
 * token rotation the web application uses. Importing the local API client
 * module first configures it with this application's endpoints.
 */
import '@/lib/api-client';

export {
  useAuthStore,
  useAuthLoading,
  useHasPermission,
  useIsAdmin,
  useIsSeller,
  useUser,
} from '@atlas/client';
