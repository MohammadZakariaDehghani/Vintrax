import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Article } from '@atlas/shared';
import { serverFetch } from '@/lib/api-client';
import { ArticleBody } from '@/components/article-body';

async function getArticle(slug: string): Promise<Article | null> {
  return serverFetch<Article>(`/articles/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) return { title: 'Not found — Atlas' };

  return {
    title: `${article.title} — Atlas`,
    description: article.subtitle ?? undefined,
    openGraph: {
      title: article.title,
      description: article.subtitle ?? undefined,
      images: [article.heroImageUrl],
      type: 'article',
      publishedTime: article.publishedAt ?? undefined,
    },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getArticle(slug);
  // A draft answers 404 from the API, so an unpublished post is not readable
  // by guessing its address.
  if (!article) notFound();

  return (
    <article>
      <div className="relative isolate min-h-[16rem] overflow-hidden sm:aspect-[1920/460]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={article.heroImageUrl}
          alt={article.heroAlt ?? ''}
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          fetchPriority="high"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[hsl(222_47%_11%)]/95 via-[hsl(222_47%_11%)]/60 to-[hsl(222_47%_11%)]/35" />

        <div className="container flex h-full flex-col justify-end py-10">
          <Link
            href="/blog"
            className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Editorial
          </Link>
          <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight text-white md:text-4xl">
            {article.title}
          </h1>
          {article.subtitle ? (
            <p className="mt-2 max-w-2xl text-lg text-white/85">{article.subtitle}</p>
          ) : null}
          <p className="mt-3 text-sm text-white/70">
            {article.publishedAt ? (
              <time dateTime={article.publishedAt}>
                {new Date(article.publishedAt).toLocaleDateString('en-CA', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </time>
            ) : null}
            {article.authorName ? ` · ${article.authorName}` : ''}
          </p>
        </div>
      </div>

      <div className="container max-w-3xl py-10">
        <ArticleBody body={article.body} />

        {article.ctaLabel && article.ctaHref ? (
          <div className="mt-10 rounded-lg border border-border bg-card p-6">
            <Link
              href={article.ctaHref}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {article.ctaLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  );
}
