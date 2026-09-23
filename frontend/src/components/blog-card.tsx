import Link from 'next/link';
import type { ArticleSummary } from '@vintrax/shared';
import { Card, CardContent } from '@/components/ui';

/**
 * One blog post, as a card — shared by the `/blog` grid and the home page's
 * carousel (issue #67) so both draw the same markup rather than each having
 * its own idea of what a post card looks like.
 */
export function BlogCard({
  article,
  showImage = true,
}: {
  article: ArticleSummary;
  /** Off on the home page's story row (issue #76), which is text only. */
  showImage?: boolean;
}) {
  return (
    <Link href={`/blog/${article.slug}`} className="group block h-full">
      <Card className="h-full overflow-hidden transition-colors group-hover:border-primary/40">
        {showImage ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
            {/* Same-origin uploads, often already sized for this card; next/image
                optimisation adds a hop without a benefit. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.heroImageUrl}
              alt={article.heroAlt ?? ''}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </div>
        ) : null}
        <CardContent className="p-4">
          <ArticleMeta article={article} />
          <h2 className="mt-1 font-semibold leading-snug">{article.title}</h2>
          {article.subtitle ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{article.subtitle}</p>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}

export function ArticleMeta({ article }: { article: ArticleSummary }) {
  if (!article.publishedAt) return null;
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <time dateTime={article.publishedAt}>
        {new Date(article.publishedAt).toLocaleDateString('en-CA', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </time>
      {article.authorName ? ` · ${article.authorName}` : ''}
    </p>
  );
}
