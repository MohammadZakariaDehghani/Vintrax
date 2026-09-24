'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ArticleSummary } from '@vintrax/shared';
import { HomeMasthead } from '@/components/home-masthead';
import { cn } from '@/lib/utils';

/** How long each post holds the banner before the next one fades in. */
const SLIDE_MS = 6000;

/** How far a finger has to travel sideways before it counts as a swipe. */
const SWIPE_PX = 50;

/**
 * The band across the top of the home page, as a slideshow of the newest
 * published posts — up to five, newest first — rather than the newest alone.
 *
 * Every slide is the ordinary `HomeMasthead`, stacked in one grid cell and
 * cross-faded, so the band keeps the masthead's proportions and the tallest
 * slide sets its height: nothing below jumps when the words change length.
 *
 * It advances on its own every few seconds, and stops while the pointer is
 * over it or focus is inside it, so a visitor reading a headline or reaching
 * for its button is not overtaken. With reduced motion requested it does not
 * advance on its own at all; the arrows, the dots and a swipe still work.
 * Hidden slides are `inert`, so their links are neither tabbable nor read.
 */
export function HomeMastheadSlider({
  articles,
  className,
}: {
  articles: ArticleSummary[];
  /** Passed to every slide — the room the search card overlaps into. */
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStart = useRef<number | null>(null);
  const count = articles.length;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Restarts on every change of slide, so a click on an arrow gives the new
  // slide its full time rather than whatever was left of the old one's.
  useEffect(() => {
    if (paused || reducedMotion || count < 2) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % count), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, reducedMotion, count]);

  if (count === 0) return null;

  const go = (next: number) => setIndex(((next % count) + count) % count);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Latest from the blog"
      className="relative grid"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        const end = event.changedTouches[0]?.clientX;
        touchStart.current = null;
        if (start === null || end === undefined || Math.abs(end - start) < SWIPE_PX) return;
        go(end < start ? index + 1 : index - 1);
      }}
    >
      {articles.map((article, slide) => (
        <div
          key={article.id}
          aria-roledescription="slide"
          aria-label={`${slide + 1} of ${count}`}
          aria-hidden={slide !== index}
          inert={slide !== index}
          className={cn(
            'transition-opacity duration-700 ease-in-out [grid-area:1/1]',
            slide === index ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <HomeMasthead
            article={article}
            className={className}
            headingId={`masthead-title-${slide}`}
            eager={slide === 0}
          />
        </div>
      ))}

      {count > 1 ? (
        <>
          {/* At the viewport's edges, level with the part of the band the
              search card does not cover. */}
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous story"
            className="absolute left-3 top-[calc((100%-7rem)/2)] z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next story"
            className="absolute right-3 top-[calc((100%-7rem)/2)] z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
          <div className="absolute inset-x-0 bottom-[6.6rem] z-10 flex justify-center gap-2">
            {articles.map((article, slide) => (
              <button
                key={article.id}
                type="button"
                onClick={() => go(slide)}
                aria-label={`Story ${slide + 1}: ${article.title}`}
                aria-current={slide === index ? 'true' : undefined}
                className={cn(
                  'h-2 rounded-full bg-white transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                  slide === index ? 'w-6' : 'w-2 opacity-50 hover:opacity-80',
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
