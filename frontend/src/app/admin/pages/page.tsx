'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PenLine, Plus } from 'lucide-react';
import type { ArticleStatus, ArticleSummary, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Badge, Button, Card, CardContent, EmptyState, ErrorAlert, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

const STATUS_LABEL: Record<ArticleStatus, string> = {
  PUBLISHED: 'Published',
  DRAFT: 'Draft',
  ARCHIVED: 'Archived',
};

/**
 * Standalone pages such as "About us": written like a blog post, with an
 * optional photograph, but never listed on the blog or the home page. Each
 * is reached at its own address, which is what a footer link points at.
 */
function PageList() {
  const pages = useQuery({
    queryKey: ['admin-pages'],
    queryFn: () =>
      api.get<Paginated<ArticleSummary>>('/admin/articles?kind=PAGE&page=1&pageSize=50'),
  });

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pages</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Pages such as About us. They are not listed on the blog; link to one from{' '}
            <Link href="/admin/footer" className="font-medium text-foreground underline">
              the footer
            </Link>{' '}
            using the address shown under its title.
          </p>
        </div>
        <Link href="/admin/pages/new">
          <Button>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            New page
          </Button>
        </Link>
      </header>

      {pages.error ? <ErrorAlert error={pages.error} className="mb-4" /> : null}

      {pages.isLoading ? (
        <Spinner label="Loading pages" />
      ) : pages.data && pages.data.items.length > 0 ? (
        <ul className="space-y-3">
          {pages.data.items.map((page) => (
            <li key={page.id}>
              <Link href={`/admin/pages/${page.slug}`} className="group block">
                <Card className="transition-colors group-hover:border-primary/40">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1">
                        <Badge variant={page.status === 'PUBLISHED' ? 'success' : 'warning'}>
                          {STATUS_LABEL[page.status]}
                        </Badge>
                      </div>
                      <h2 className="truncate font-semibold">{page.title}</h2>
                      <p className="text-sm text-muted-foreground">
                        <code>/pages/{page.slug}</code>
                      </p>
                    </div>
                    <PenLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No pages yet"
          description="Write an About us page, then link to it from the footer."
          action={
            <Link href="/admin/pages/new">
              <Button>New page</Button>
            </Link>
          }
        />
      )}
    </>
  );
}

export default function AdminPagesPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <PageList />
      </div>
    </RequireAuth>
  );
}
