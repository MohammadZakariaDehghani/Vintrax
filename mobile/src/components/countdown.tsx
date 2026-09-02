'use client';

import { useEffect, useState } from 'react';
import { cn, formatCountdown, isClosingSoon } from '@/lib/format';

/**
 * Time left in an auction.
 *
 * Recomputed from the server's `endsAt` on every tick rather than decremented
 * locally, so a backgrounded phone — which stops firing timers — resumes with
 * the right number instead of one that drifted by however long the screen was
 * off.
 */
export function Countdown({
  endsAt,
  className,
  onExpire,
}: {
  endsAt: string;
  className?: string;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(endsAt));

  useEffect(() => {
    setRemaining(secondsUntil(endsAt));
    const timer = setInterval(() => {
      const next = secondsUntil(endsAt);
      setRemaining(next);
      if (next <= 0) {
        clearInterval(timer);
        onExpire?.();
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [endsAt, onExpire]);

  const urgent = isClosingSoon(remaining);

  return (
    <span
      className={cn('tabular-nums', urgent && 'font-semibold text-destructive', className)}
      // Announced only when it matters: a screen reader reading every second
      // for two days would be unusable.
      aria-live={urgent ? 'polite' : 'off'}
    >
      {formatCountdown(remaining)}
    </span>
  );
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1_000));
}
