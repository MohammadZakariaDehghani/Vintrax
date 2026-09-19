'use client';

import { useEffect, useState } from 'react';
import { MAX_COMPARE_VEHICLES, useCompareStore } from '@/store/compare-store';

const MESSAGES: Record<string, string> = {
  added: 'Added to comparison',
  removed: 'Removed from comparison',
  cleared: 'Comparison list cleared',
  limit: `Compare up to ${MAX_COMPARE_VEHICLES} vehicles at a time.`,
};

const VISIBLE_MS = 2500;

/**
 * The small confirmation a compare action gets, mounted once, globally, next
 * to `CompareBar`.
 *
 * Reacts to `useCompareStore`'s `notice` rather than owning any state of its
 * own: every place that adds, removes, clears or hits the four-vehicle limit
 * already goes through the store, so this is the one component that has to
 * know how to say what happened, instead of every button re-implementing a
 * toast. `token` is what triggers the effect on a *repeat* of the same kind
 * of notice — two "added" events in a row are still two separate things to
 * announce, and object identity alone would not tell them apart.
 */
export function CompareToast() {
  const notice = useCompareStore((state) => state.notice);
  const dismiss = useCompareStore((state) => state.dismissNotice);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      dismiss();
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the token, not the notice object identity
  }, [notice?.token]);

  if (!notice || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4"
    >
      <div className="pointer-events-auto rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg">
        {MESSAGES[notice.kind]}
      </div>
    </div>
  );
}
