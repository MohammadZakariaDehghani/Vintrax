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

function EditArticle({ slug }: { slug: string }) {
  // The admin route, not the public one, so a draft can be edited.
  const article = useQuery({
    queryKey: ['admin-articles', slug],
    queryFn: () => api.get<Article>(`/admin/articles/${encodeURIComponent(slug)}`),
  });

  if (article.isLoading) return <Spinner label="Loading the post" />;
  if (article.error) return <ErrorAlert error={article.error} />;
  if (!article.data) return null;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{article.data.title}</h1>
      <ArticleEditor article={article.data} />
    </>
  );
}

export default function EditArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <Link
          href="/admin/blog"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All posts
        </Link>
        <EditArticle slug={slug} />
      </div>
    </RequireAuth>
  );
}
