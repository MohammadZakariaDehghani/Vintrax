import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

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
    // larger. The largest upload the API accepts is a promo tile video
    // (PROMO_VIDEO.maxUploadBytes, 100 MB); vehicle photos go to 15 MB.
    middlewareClientMaxBodySize: '101mb',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
    ],
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
