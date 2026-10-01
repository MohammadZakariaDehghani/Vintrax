import Link from 'next/link';
import { PlayCircle } from 'lucide-react';
import { articleMedia, type ArticleSummary } from '@vintrax/shared';
import { Card, CardContent } from '@/components/ui';
import { MediaImage } from '@/components/media/media-image';

/**
 * One blog post, as a card — shared by the `/blog` grid and the home page's
 * carousel (issue #67) so both draw the same markup rather than each having
 * its own idea of what a post card looks like.
 */
export function BlogCard({
  article,
  showImage = true,
  showMeta = true,
}: {
  article: ArticleSummary;
  /** Off on the home page's story row (issue #76), which is text only. */
  showImage?: boolean;
  /** Off on the home page's story row too, which shows the title and standfirst alone. */
  showMeta?: boolean;
}) {
  return (
    <Link href={`/blog/${article.slug}`} className="group block h-full">
      <Card className="h-full overflow-hidden transition-colors group-hover:border-primary/40">
        {showImage ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
            <CardPicture article={article} />
          </div>
        ) : null}
        <CardContent className="p-4">
          {showMeta ? <ArticleMeta article={article} /> : null}
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

/**
 * The card's picture: the post's photo, with its responsive renditions when it
 * came from the media library. A video post shows its poster with a play mark
 * — a grid of cards never downloads a video, the post's own page plays it.
 */
function CardPicture({ article }: { article: ArticleSummary }) {
  const media = articleMedia(article);
  if (!media) return null;
  const className =
    'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]';
  if (media.kind === 'VIDEO') {
    const poster = media.desktop.posterUrl ?? article.heroImageUrl;
    return (
      <>
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- an operator upload
          <img
            src={poster}
            alt={media.alt ?? ''}
            loading="lazy"
            decoding="async"
            className={className}
          />
        ) : null}
        <PlayCircle
          className="absolute bottom-3 right-3 h-8 w-8 text-white drop-shadow"
          aria-label="Video"
        />
      </>
    );
  }
  return (
    <MediaImage
      desktop={media.desktop}
      mobile={null}
      alt={media.alt ?? ''}
      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      className={className}
    />
  );
}
