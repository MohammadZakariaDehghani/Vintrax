/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

const nextConfig = {
  reactStrictMode: true,
  // The shared contract package is TypeScript source, not a build artefact,
  // so Next must transpile it like first-party code.
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
