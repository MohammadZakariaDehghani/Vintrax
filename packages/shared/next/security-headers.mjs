// Response headers for the two Next.js apps (web and mobile), read by each
// app's next.config.mjs. Plain ESM rather than TypeScript because Next loads
// its config before anything is compiled.
//
// The API sets its own through helmet; these cover the HTML pages, which is
// where a browser actually enforces them.

/** Origins a build was told to reach the API or its socket on, when not same-origin. */
function configuredOrigins() {
  const origins = new Set();
  for (const value of [process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_WS_URL]) {
    if (!value || value.startsWith('/')) continue;
    try {
      const url = new URL(value);
      origins.add(url.origin);
      // socket.io upgrades to a websocket on the same host.
      const ws = url.protocol === 'https:' ? 'wss:' : 'ws:';
      origins.add(`${ws}//${url.host}`);
    } catch {
      // Not a URL; the app falls back to same-origin requests anyway.
    }
  }
  return [...origins];
}

/**
 * The Content-Security-Policy.
 *
 * `script-src` keeps 'unsafe-inline' because Next writes its hydration data
 * as inline scripts; removing it needs a per-request nonce, which forces every
 * page to render dynamically and gives up static and cached pages. What the
 * policy does buy: no script, frame, form post, plugin or base URL from an
 * origin not listed here, and no framing of Vintrax by other sites.
 *
 * Images and videos may come from any https origin: with STORAGE_DRIVER=s3
 * they are served by the bucket or its CDN, whose host is deployment
 * configuration this file cannot know.
 */
function contentSecurityPolicy({ dev }) {
  const connect = ["'self'", ...configuredOrigins()];
  if (dev) connect.push('ws:', 'http:');
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', ...(dev ? ['http:'] : [])],
    'media-src': ["'self'", 'blob:', 'https:', ...(dev ? ['http:'] : [])],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    // Google Maps on the Contact page, YouTube's no-cookie player on listings.
    'frame-src': ['https://www.google.com', 'https://www.youtube-nocookie.com'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}

/**
 * @param {{ dev: boolean, camera?: boolean }} options
 *   `camera`: the page may open the camera itself (the mobile app's
 *   in-page viewfinder for vehicle photos).
 */
export function securityHeaders({ dev, camera = false }) {
  const headers = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy({ dev }) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: [
        `camera=(${camera ? 'self' : ''})`,
        'microphone=()',
        'geolocation=()',
        'payment=()',
        'usb=()',
      ].join(', '),
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
  // Browsers ignore HSTS over plain http, but a development build sending it
  // for localhost would pin that name to https in the developer's browser.
  if (!dev) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  }
  return headers;
}
