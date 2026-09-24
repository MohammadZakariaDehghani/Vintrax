'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PenLine, Plus } from 'lucide-react';
import type { ArticleStatus, ArticleSummary, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Badge, Button, Card, CardContent, EmptyState, ErrorAlert, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

const STATUS_VARIANT: Record<ArticleStatus, 'success' | 'warning' | 'outline'> = {
  PUBLISHED: 'success',
  DRAFT: 'warning',
  ARCHIVED: 'outline',
};

/**
 * The editorial desk.
 *
 * Ordered by when each post was last edited rather than by publication date,
 * because the thing an author is looking for is what they were working on.
 */
function ArticleList() {
  const articles = useQuery({
    queryKey: ['admin-articles'],
    queryFn: () => api.get<Paginated<ArticleSummary>>('/admin/articles?page=1&pageSize=50'),
  });

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Blog</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The most recently published post becomes the masthead across the top of the home page.
            Everything else lives at <span className="font-medium text-foreground">/blog</span>.
          </p>
        </div>
        <Link href="/admin/blog/new">
          <Button>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Write a post
          </Button>
        </Link>
      </header>

      {articles.error ? <ErrorAlert error={articles.error} className="mb-4" /> : null}

      {articles.isLoading ? (
        <Spinner label="Loading posts" />
      ) : articles.data && articles.data.items.length > 0 ? (
        <ul className="space-y-3">
          {articles.data.items.map((article, index) => (
            <li key={article.id}>
              <Link href={`/admin/blog/${article.slug}`} className="group block">
                <Card className="overflow-hidden transition-colors group-hover:border-primary/40">
                  <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
                    <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded bg-muted sm:h-[86px] sm:w-[152px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={article.heroImageUrl ?? undefined}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={STATUS_VARIANT[article.status]}>
                          {article.status === 'PUBLISHED'
                            ? 'Published'
                            : article.status === 'DRAFT'
                              ? 'Draft'
                              : 'Archived'}
                        </Badge>
                        {/* The list is ordered by last edit, so "on the home
                            page" is not simply the first row — it is the newest
                            published one, which is worth saying out loud. */}
                        {article.status === 'PUBLISHED' &&
                        isNewestPublished(articles.data.items, index) ? (
                          <Badge variant="outline">On the home page</Badge>
                        ) : null}
                      </div>
                      <h2 className="truncate font-semibold">{article.title}</h2>
                      {article.subtitle ? (
                        <p className="truncate text-sm text-muted-foreground">{article.subtitle}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Edited{' '}
                        {new Date(article.updatedAt).toLocaleDateString('en-CA', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {article.authorName ? ` · ${article.authorName}` : ''}
                      </p>
                    </div>
                    <PenLine
                      className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block"
                      aria-hidden
                    />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No posts yet"
          description="Write one and the home page leads with it."
          action={
            <Link href="/admin/blog/new">
              <Button>Write a post</Button>
            </Link>
          }
        />
      )}
    </>
  );
}

/** Whether the row at `index` is the newest published post in the list. */
function isNewestPublished(items: ArticleSummary[], index: number): boolean {
  const published = items
    .filter((entry) => entry.status === 'PUBLISHED' && entry.publishedAt)
    .sort((a, b) => (a.publishedAt! < b.publishedAt! ? 1 : -1));
  return published[0]?.id === items[index]?.id;
}

export default function AdminBlogPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <ArticleList />
      </div>
    </RequireAuth>
  );
}
