'use client';

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Article } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { ErrorAlert, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { ArticleEditor } from '@/components/article-editor';

function EditSitePage({ slug }: { slug: string }) {
  // The admin route reaches drafts, and pages as well as posts.
  const page = useQuery({
    queryKey: ['admin-pages', slug],
    queryFn: () => api.get<Article>(`/admin/articles/${encodeURIComponent(slug)}`),
  });

  if (page.isLoading) return <Spinner label="Loading the page" />;
  if (page.error) return <ErrorAlert error={page.error} />;
  if (!page.data) return null;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{page.data.title}</h1>
      <ArticleEditor article={page.data} />
    </>
  );
}

export default function EditSitePagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <Link
          href="/admin/pages"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All pages
        </Link>
        <EditSitePage slug={slug} />
      </div>
    </RequireAuth>
  );
}
