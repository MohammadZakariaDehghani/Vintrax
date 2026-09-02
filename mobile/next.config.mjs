/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TypeScript source, not build artefacts, so Next
  // compiles them like first-party code.
  transpilePackages: ['@atlas/shared', '@atlas/client'],
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
    ],
  },
  async headers() {
    return [
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
