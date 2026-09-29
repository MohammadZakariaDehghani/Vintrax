import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

// Read per request, so the sitemap address follows SITE_URL at runtime.
export const dynamic = 'force-dynamic';

/**
 * Crawlers may index the storefront. Account, dealer and admin screens are
 * behind sign-in and would only index as login pages. `/dealer/` keeps its
 * slash: without it the rule would also cover the public `/dealers/…` pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/dealer/', '/dashboard', '/api/', '/compare', '/login', '/register'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
