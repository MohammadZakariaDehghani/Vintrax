import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ArticleSummary } from '@vintrax/shared';
import { cn } from '@/lib/utils';

/**
 * The band across the top of the home page.
 *
 * Built to the proportions of the storefront masthead format — roughly 1920×330,
 * a wide, short lifestyle photograph carrying a headline and one button. The
 * shape is the point: short enough that the search card and real inventory stay
 * above the fold, wide enough that a photograph of a car reads as a scene
 * rather than a thumbnail. It is set as an aspect ratio with a floor rather
 * than a fixed height, so it keeps its proportions on a wide screen and grows
 * on a narrow one instead of squeezing the words into a stripe.
 *
 * The photograph is the operator's, uploaded with the post. The scrim is not
 * decoration: white text on an unknown photograph is unreadable about half the
 * time, and a gradient that darkens the side the words sit on is what makes the
 * contrast a property of the design rather than of the picture someone chose.
 */
export function HomeMasthead({
  article,
  className,
}: {
  article: ArticleSummary;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="masthead-title"
      className={cn(
        'relative isolate min-h-[19rem] overflow-hidden sm:aspect-[1920/330] sm:min-h-[20rem]',
        className,
      )}
    >
      {/* Operator uploads served from the API origin; next/image would add a
          hop without improving anything. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={article.heroImageUrl}
        alt={article.heroAlt ?? ''}
        className="absolute inset-0 -z-10 h-full w-full object-cover"
        // The masthead is the first thing painted, so it is never lazy.
        fetchPriority="high"
        decoding="async"
      />
      {/* Two scrims: one across the whole frame so the photograph never fights
          the header above it, one heavier from the left where the words are. */}
      <div className="absolute inset-0 -z-10 bg-[hsl(222_47%_11%)]/45" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[hsl(222_47%_11%)]/90 via-[hsl(222_47%_11%)]/60 to-transparent" />

      <div className="container flex h-full flex-col justify-center py-10">
        {/* No kicker and no date. A masthead is an invitation, not a filing
            card — the byline and the date belong on the post itself, where
            they answer a question the reader is actually asking. */}
        <div className="max-w-xl">
          <h2
            id="masthead-title"
            className="text-3xl font-bold leading-tight tracking-tight text-white drop-shadow-sm md:text-[2.6rem]"
          >
            {article.title}
          </h2>

          {article.subtitle ? (
            <p className="mt-2 text-base leading-relaxed text-white/85 md:text-lg">
              {article.subtitle}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            {article.ctaLabel && article.ctaHref ? (
              <Link
                href={article.ctaHref}
                className="inline-flex h-11 items-center rounded-md bg-accent px-5 text-sm font-bold text-accent-foreground transition-colors hover:bg-accent/90"
              >
                {article.ctaLabel}
              </Link>
            ) : null}
            <Link
              href={`/blog/${article.slug}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-white underline-offset-4 hover:underline"
            >
              Read the story
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
