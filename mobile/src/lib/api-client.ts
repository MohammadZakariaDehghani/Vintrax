import { configureVintraxClient } from '@vintrax/client';

/**
 * The mobile application's view of the shared client.
 *
 * Every caller imports from here rather than from `@vintrax/client` directly, so
 * the endpoints are configured before the first request goes out.
 *
 * Both values come from the environment — no host, port or domain is written
 * into the source. `NEXT_PUBLIC_*` is compiled into the bundle at build time,
 * so changing either one is a rebuild, not a restart.
 */
configureVintraxClient({
  // Same-origin by default: `next.config.mjs` proxies /api to the API, which
  // keeps uploaded images resolving and avoids cross-origin preflights.
  apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? '/api',
  // The proxy cannot carry a WebSocket upgrade, so live auctions connect to
  // the API's own origin.
  socketUrl: process.env['NEXT_PUBLIC_WS_URL'] ?? '',
});

export { ApiError, api, apiRequest, setSessionExpiredHandler, tokenStore } from '@vintrax/client';
