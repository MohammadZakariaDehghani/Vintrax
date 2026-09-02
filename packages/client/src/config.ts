/**
 * Where this package's requests go.
 *
 * The package is consumed by two applications with different environment
 * conventions and different deployment shapes, so the endpoints are injected
 * rather than read from `process.env` here. Each application configures them
 * once, at module scope, in the module every one of its callers imports —
 * which is what guarantees configuration happens before the first request.
 *
 * The defaults match a same-origin deployment behind a proxy, which is how
 * both applications run today.
 */
export interface AtlasClientConfig {
  /** Base path or origin for REST calls, e.g. `/api` or `https://api.example.com/api`. */
  apiBaseUrl: string;
  /**
   * Origin for the WebSocket connection. Empty means the page origin, which
   * only works when nothing proxies in between: an HTTP proxy does not forward
   * the upgrade handshake, so a deployment with one must set this to the API's
   * own origin.
   */
  socketUrl: string;
}

let config: AtlasClientConfig = {
  apiBaseUrl: '/api',
  socketUrl: '',
};

export function configureAtlasClient(next: Partial<AtlasClientConfig>): void {
  config = { ...config, ...next };
}

export function atlasClientConfig(): AtlasClientConfig {
  return config;
}
