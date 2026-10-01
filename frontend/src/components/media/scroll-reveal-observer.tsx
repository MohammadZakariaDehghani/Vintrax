'use client';

import { useEffect } from 'react';

/** The selector for content waiting to animate in. */
const WAITING = '[data-reveal]:not([data-revealed])';

/**
 * Reveals `[data-reveal]` elements as they scroll into view — one observer
 * for the whole site, mounted once in the root layout, rather than a client
 * component per element.
 *
 * The CSS in globals.css hides waiting elements only when scripting is on and
 * motion is welcome, and lets them show anyway after a few seconds unless
 * this observer has taken charge of them (`data-reveal-armed`). So without
 * JavaScript, or if it fails to load, nothing stays invisible.
 *
 * Content added later — a client-side navigation, a list that loads — is
 * picked up by a MutationObserver. Each element is revealed once and then
 * forgotten; nothing animates again on the way back up.
 */
export function ScrollRevealObserver() {
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const reveal = (element: Element) => element.setAttribute('data-revealed', 'true');

    if (reduced || typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll(WAITING).forEach(reveal);
      const mutations = new MutationObserver(() =>
        document.querySelectorAll(WAITING).forEach(reveal),
      );
      mutations.observe(document.body, { childList: true, subtree: true });
      return () => mutations.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      },
      // Starts a little before the element's top edge clears the bottom of
      // the screen, so the motion is under way as it arrives, not after.
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );

    const arm = () => {
      document.querySelectorAll(`${WAITING}:not([data-reveal-armed])`).forEach((element) => {
        element.setAttribute('data-reveal-armed', 'true');
        // "Animate as the page loads" content does not wait for a scroll.
        if (element.hasAttribute('data-reveal-load')) {
          requestAnimationFrame(() => reveal(element));
        } else {
          observer.observe(element);
        }
      });
    };
    arm();
    const mutations = new MutationObserver(arm);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);

  return null;
}
