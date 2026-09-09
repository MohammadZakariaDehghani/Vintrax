'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { ArticleEditor } from '@/components/article-editor';

export default function NewArticlePage() {
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
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Write a post</h1>
        <ArticleEditor />
      </div>
    </RequireAuth>
  );
}
