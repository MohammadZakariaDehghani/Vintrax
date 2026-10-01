import { configureVintraxClient } from '@vintrax/client';

/**
 * The web application's view of the shared client.
 *
 * Every caller in this app imports from here rather than from `@vintrax/client`
 * directly, which is what guarantees the endpoints below are configured before
 * the first request goes out.
 */
configureVintraxClient({
  apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? '/api',
  // WebSockets cannot go through Next's rewrite proxy — it does not forward the
  // upgrade handshake — so the socket addresses the API origin directly.
  socketUrl: process.env['NEXT_PUBLIC_WS_URL'] ?? '',
});

export {
  ApiError,
  api,
  apiRequest,
  setSessionExpiredHandler,
  tokenStore,
  vintraxClientConfig,
} from '@vintrax/client';

/**
 * Server-side fetch for React Server Components, which cannot read
 * localStorage and must address the API by its absolute origin.
 *
 * This stays in the web application: it is meaningless to the mobile client,
 * which has no server-rendered data path of its own.
 */
export async function serverFetch<T>(path: string): Promise<T | null> {
  const origin = process.env['API_ORIGIN'] ?? 'http://127.0.0.1:3001';
  try {
    const response = await fetch(`${origin}/api${path}`, {
      // Marketplace inventory changes often enough that a stale page is worse
      // than an extra request.
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
