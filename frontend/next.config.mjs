import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from '../packages/shared/next/security-headers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';
const dev = process.env.NODE_ENV !== 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Traced production server: the runtime image gets server.js plus only the
  // dependencies actually reached, instead of the whole workspace's
  // node_modules. Tracing has to start at the workspace root or it follows
  // pnpm's symlinks out of the app and misses the shared packages.
  output: 'standalone',
  outputFileTracingRoot: path.join(here, '..'),
  // The shared contract package is TypeScript source, not a build artefact,
  // so Next must transpile it like first-party code.
  transpilePackages: ['@vintrax/shared', '@vintrax/client'],
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Requests reaching the API through the rewrite below are buffered by
    // Next, which keeps only the first 10 MB by default and cuts off anything
    // larger. Vehicle photos go to 15 MB; promo tile videos are sent in 8 MB
    // pieces (PROMO_VIDEO.chunkBytes), so this only needs to cover a photo.
    middlewareClientMaxBodySize: '16mb',
  },
  // `X-Powered-By: Next.js` tells a scanner which exploits to try first.
  poweredByHeader: false,
  images: {
    // No remote patterns: the optimiser fetches only this app's own paths
    // (/uploads through the rewrite below, and bundled assets). It used to
    // allow every https host, which made /_next/image a proxy that would
    // fetch, decode and resize any image on the internet for anyone who
    // asked. Photos on an absolute URL (an S3 bucket or CDN) are drawn
    // unoptimised instead; the API has already made their sized variants.
    remotePatterns: [],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders({ dev }) }];
  },
  async rewrites() {
    // Proxying keeps the browser on one origin, so uploaded images resolve
    // without rewriting URLs and CORS is not exercised in development.
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/uploads/:path*', destination: `${API_ORIGIN}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
