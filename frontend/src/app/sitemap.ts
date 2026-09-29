import type { MetadataRoute } from 'next';
import type { ArticleSummary, DealerSummary, Paginated, VehicleSummary } from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { siteUrl } from '@/lib/site-url';

// Inventory changes all day; the sitemap is built when a crawler asks for it.
export const dynamic = 'force-dynamic';

/** The API's largest page, and a ceiling well inside the 50,000-URL sitemap limit. */
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

async function everyPage<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const separator = path.includes('?') ? '&' : '?';
    const result = await serverFetch<Paginated<T>>(
      `${path}${separator}page=${page}&pageSize=${PAGE_SIZE}`,
    );
    if (!result) break;
    items.push(...result.items);
    if (page >= result.totalPages) break;
  }
  return items;
}

/**
 * Every public page a search engine should know about: the fixed pages,
 * each vehicle on sale, each dealer and each blog post. Only what the public
 * API lists is included, so nothing under review or withdrawn appears.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [vehicles, dealers, articles] = await Promise.all([
    everyPage<VehicleSummary>('/vehicles?sort=NEWEST'),
    everyPage<DealerSummary>('/dealers'),
    everyPage<ArticleSummary>('/articles'),
  ]);

  const fixed: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/vehicles`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${base}/auctions`, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${base}/blog`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/tools/car-value`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/tools/budget`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  return [
    ...fixed,
    ...vehicles.map((vehicle) => ({
      url: `${base}/vehicles/${vehicle.slug}`,
      lastModified: vehicle.publishedAt ?? vehicle.createdAt,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...dealers.map((dealer) => ({
      url: `${base}/dealers/${dealer.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
    ...articles.map((article) => ({
      url: `${base}/blog/${article.slug}`,
      lastModified: article.updatedAt ?? article.publishedAt ?? undefined,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];
}
