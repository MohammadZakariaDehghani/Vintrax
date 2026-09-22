'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A horizontal, N-visible-at-once carousel: Popular Makes, Partner logos and
 * the homepage blog row all use this one component (issue #67) rather than
 * each hand-rolling their own sliding strip.
 *
 * Built on native scroll rather than a hand-computed drag/transform: the
 * scroller is a plain `overflow-x-auto` flex row with CSS scroll-snap, so
 * touch/swipe on mobile is the browser's own scrolling — nothing here has to
 * track a pointer — and the Previous/Next buttons are `scrollBy` one
 * viewport-width at a time. How many items show "at once" is entirely a
 * matter of each item's CSS width (`itemClassName`, e.g. a fraction per
 * breakpoint), so the same component serves a 4-per-view desktop layout and
 * a narrower mobile one with no JS resize logic.
 *
 * All `items` are always rendered into the DOM — nothing is discarded to
 * fake "only 4 shown"; the rest are simply off-screen until scrolled to.
 *
 * `items` takes pre-rendered `{ key, content }` pairs, not raw data plus a
 * render function: every caller here is a Server Component, and a function
 * cannot cross the server/client boundary — the same rule issue #37 already
 * cost this app a broken page for once, over the old `CarfaxBadge`. A
 * rendered `ReactNode`, unlike a function, serialises across that boundary
 * fine, so the caller renders each item itself and only hands the result in.
 */
export function ItemCarousel({
  items,
  ariaLabel,
  itemClassName = 'w-1/2 sm:w-1/3 lg:w-1/4',
  className,
}: {
  items: Array<{ key: string; content: ReactNode }>;
  ariaLabel: string;
  /** Each item's width, driving how many show per viewport at each breakpoint. */
  itemClassName?: string;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // A few pixels of slack: a scroller that is exactly at its end can still
    // report a 1px-short scrollWidth due to subpixel layout, which would
    // otherwise leave the "next" arrow stuck on.
    setCanScrollPrev(el.scrollLeft > 4);
    setCanScrollNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
    // Re-measured whenever the item count changes — a shorter list can turn
    // the "next" arrow off, which a scroll/resize listener alone would miss.
  }, [updateArrows, items.length]);

  function scrollByPage(direction: 1 | -1) {
    scrollerRef.current?.scrollBy({ left: direction * scrollerRef.current.clientWidth, behavior: 'smooth' });
  }

  if (items.length === 0) return null;

  return (
    <div className={cn('relative', className)}>
      <div
        ref={scrollerRef}
        role="group"
        aria-label={ariaLabel}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <div key={item.key} className={cn('shrink-0 snap-start', itemClassName)}>
            {item.content}
          </div>
        ))}
      </div>

      {canScrollPrev ? (
        <button
          type="button"
          aria-label="Previous"
          onClick={() => scrollByPage(-1)}
          className="absolute left-0 top-1/2 z-10 -translate-x-1/3 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full border border-border bg-card shadow-md transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

      {canScrollNext ? (
        <button
          type="button"
          aria-label="Next"
          onClick={() => scrollByPage(1)}
          className="absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-1/3 grid h-9 w-9 place-items-center rounded-full border border-border bg-card shadow-md transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
