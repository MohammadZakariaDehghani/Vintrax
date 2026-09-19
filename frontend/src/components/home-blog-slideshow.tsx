'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ArticleSummary } from '@vintrax/shared';
import { cn } from '@/lib/utils';

/** How long one post stays on screen before the slideshow advances itself. */
const AUTO_ADVANCE_MS = 6000;

/**
 * The last five posts, as a slideshow on the home page.
 *
 * A single active card rather than five cards in a row: the masthead above
 * already carries the newest post at full width, and five thumbnails side by
 * side on a phone are five things too small to read rather than one thing
 * worth stopping for.
 *
 * Advances on its own, the way "slide show" was asked for, but stops the
 * moment a visitor's mouse or keyboard focus is anywhere in it — reading a
 * headline while it changes underneath is worse than a slideshow that never
 * moved, and a visitor tabbing through the page must not have their focus
 * carried off to a slide they didn't ask for.
 */
export function HomeBlogSlideshow({ posts }: { posts: ArticleSummary[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const index = posts.length > 0 ? active % posts.length : 0;
  const step = (by: number) => setActive((index + by + posts.length) % posts.length);

  useEffect(() => {
    if (posts.length <= 1 || paused) return;
    const timer = setInterval(() => setActive((current) => (current + 1) % posts.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [posts.length, paused]);

  if (posts.length === 0) return null;
  const current = posts[index]!;

  return (
    <section className="container py-12">
      <div
        className="relative overflow-hidden rounded-lg border border-border bg-card"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            step(-1);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            step(1);
          }
        }}
      >
        <Link href={`/blog/${current.slug}`} className="group block">
          <div className="relative aspect-[21/9] w-full overflow-hidden bg-muted sm:aspect-[3/1]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.heroImageUrl}
              alt={current.heroAlt ?? ''}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </div>
          <div className="p-5">
            {current.publishedAt ? (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <time dateTime={current.publishedAt}>
                  {new Date(current.publishedAt).toLocaleDateString('en-CA', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
              </p>
            ) : null}
            <h3 className="mt-1 text-xl font-bold tracking-tight">{current.title}</h3>
            {current.subtitle ? (
              <p className="mt-1.5 max-w-2xl text-muted-foreground">{current.subtitle}</p>
            ) : null}
          </div>
        </Link>

        {posts.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous post"
              onClick={() => step(-1)}
              className="absolute left-3 top-[35%] grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next post"
              onClick={() => step(1)}
              className="absolute right-3 top-[35%] grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      {posts.length > 1 ? (
        <div className="mt-3 flex justify-center gap-1.5" role="tablist" aria-label="Blog posts">
          {posts.map((post, position) => (
            <button
              key={post.id}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={post.title}
              onClick={() => setActive(position)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                position === index ? 'w-6 bg-primary' : 'w-1.5 bg-border hover:bg-muted-foreground/40',
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
