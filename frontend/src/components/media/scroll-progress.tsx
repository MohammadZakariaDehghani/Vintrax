'use client';

import { useEffect, useRef, useState } from 'react';

/** Pages shorter than this past the window have nothing to show progress through. */
const MIN_SCROLLABLE_PX = 240;

/**
 * A thin bar across the very top of the window that fills as the page is
 * scrolled.
 *
 * Cheap by construction: one passive scroll listener, at most one update per
 * frame, and the bar moves by `transform: scaleX()` — composited, so a long
 * page never re-lays out while scrolling. It sits above the sticky header and
 * takes no clicks, so the navigation under it works as before.
 *
 * Exposed as a labelled progress bar; assistive technology reads its value
 * when asked rather than having every scroll step announced.
 */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  const [percent, setPercent] = useState(0);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const root = document.documentElement;
      const scrollable = root.scrollHeight - window.innerHeight;
      const fraction = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${fraction})`;
      setShown(scrollable > MIN_SCROLLABLE_PX);
      setPercent(Math.round(fraction * 100));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // Content that loads after the first paint changes how long the page is.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      resize?.disconnect();
    };
  }, []);

  return (
    <div
      role="progressbar"
      aria-label="How far down the page you are"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-hidden={!shown}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] transition-opacity duration-300"
      style={{ opacity: shown ? 1 : 0 }}
    >
      <div
        ref={bar}
        className="h-full origin-left bg-gradient-to-r from-primary to-accent will-change-transform"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  );
}
