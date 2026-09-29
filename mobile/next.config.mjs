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
  // Workspace packages are TypeScript source, not build artefacts, so Next
  // compiles them like first-party code.
  transpilePackages: ['@vintrax/shared', '@vintrax/client'],
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
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
    return [
      // The dealer's in-page viewfinder for vehicle photos opens the camera.
      { source: '/:path*', headers: securityHeaders({ dev, camera: true }) },
      {
        // The service worker must not be cached, or an install keeps serving
        // the previous one and the app never updates.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  async rewrites() {
    // Same-origin proxying keeps uploaded images resolving without rewriting
    // URLs, and means the app makes no cross-origin requests for REST calls.
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/uploads/:path*', destination: `${API_ORIGIN}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
