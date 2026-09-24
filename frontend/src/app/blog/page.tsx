import Link from 'next/link';
import type { Metadata } from 'next';
import type { ArticleSummary, Paginated } from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { EmptyState } from '@/components/ui';
import { ArticleMeta, BlogCard } from '@/components/blog-card';

export const metadata: Metadata = {
  title: 'Editorial — Vintrax',
  description: 'Buying guides, market notes and vehicle writing from Vintrax.',
};

/** Server-rendered so posts are indexable, which is most of the point of writing them. */
export default async function BlogIndexPage() {
  const articles = await serverFetch<Paginated<ArticleSummary>>('/articles?page=1&pageSize=24');
  const items = articles?.items ?? [];
  const [lead, ...rest] = items;

  return (
    <div className="container py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Editorial</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Buying guides, market notes and the occasional argument about cars.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing published yet"
          description="The first piece will appear here, and on the front page."
        />
      ) : (
        <>
          {/* The newest post is also the home page masthead, so it gets the
              same prominence here rather than being one card among many. */}
          {lead ? (
            <Link
              href={`/blog/${lead.slug}`}
              className="group mb-8 block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40"
            >
              <div className="relative aspect-[21/9] w-full overflow-hidden bg-muted sm:aspect-[3/1]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={lead.heroImageUrl ?? undefined}
                  alt={lead.heroAlt ?? ''}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <div className="p-5">
                <ArticleMeta article={lead} />
                <h2 className="mt-1 text-2xl font-bold tracking-tight">{lead.title}</h2>
                {lead.subtitle ? (
                  <p className="mt-1.5 text-muted-foreground">{lead.subtitle}</p>
                ) : null}
              </div>
            </Link>
          ) : null}

          {rest.length > 0 ? (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((article) => (
                <li key={article.id}>
                  <BlogCard article={article} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
