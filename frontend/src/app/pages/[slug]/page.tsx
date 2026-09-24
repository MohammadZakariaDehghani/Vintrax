import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import type { Article } from '@vintrax/shared';
import { serverFetch } from '@/lib/api-client';
import { ArticleBody } from '@/components/article-body';

async function getPage(slug: string): Promise<Article | null> {
  return serverFetch<Article>(`/pages/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: 'Not found — Vintrax' };

  return {
    title: `${page.title} — Vintrax`,
    description: page.subtitle ?? undefined,
    openGraph: {
      title: page.title,
      description: page.subtitle ?? undefined,
      ...(page.heroImageUrl ? { images: [page.heroImageUrl] } : {}),
    },
  };
}

/**
 * A standalone page such as "About us", written by an administrator under
 * Admin → Pages. Laid out like a blog post — a photograph across the top when
 * there is one, then the text — but without the date, the byline or the way
 * back to the blog, since it is not part of it.
 */
export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPage(slug);
  // A draft answers 404 from the API, as does a blog post asked for here.
  if (!page) notFound();

  return (
    <article>
      {page.heroImageUrl ? (
        // `w-full` beside `aspect-*` and `min-h-*` for the reason the blog
        // post's header gives: without it a narrow screen solves for width.
        <div className="relative isolate w-full min-h-[16rem] overflow-hidden sm:aspect-[1920/460]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.heroImageUrl}
            alt={page.heroAlt ?? ''}
            className="absolute inset-0 -z-10 h-full w-full object-cover"
            fetchPriority="high"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[hsl(0_12%_9%)]/95 via-[hsl(0_12%_9%)]/55 to-[hsl(0_12%_9%)]/25" />
          <div className="container flex h-full flex-col justify-end py-10">
            <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight text-white md:text-4xl">
              {page.title}
            </h1>
            {page.subtitle ? (
              <p className="mt-2 max-w-2xl text-lg text-white/85">{page.subtitle}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="border-b border-border bg-card">
          <div className="container max-w-3xl py-10">
            <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">
              {page.title}
            </h1>
            {page.subtitle ? (
              <p className="mt-2 text-lg text-muted-foreground">{page.subtitle}</p>
            ) : null}
          </div>
        </div>
      )}

      <div className="container max-w-3xl py-10">
        <ArticleBody body={page.body} />

        {page.ctaLabel && page.ctaHref ? (
          <div className="mt-10">
            <Link
              href={page.ctaHref}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {page.ctaLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  );
}
