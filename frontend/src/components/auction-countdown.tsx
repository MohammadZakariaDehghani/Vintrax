'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn, formatCountdown, isClosingSoon } from '@/lib/utils';

/**
 * Live countdown to an auction close.
 *
 * The remaining time is recomputed from the server-supplied `endsAt` rather
 * than by decrementing a local counter: a client whose clock is wrong, or a tab
 * that was backgrounded and throttled, would otherwise drift out of step with
 * the auction it is displaying.
 *
 * `initialSeconds` comes from the server and is used for the first paint, so
 * the value is right before hydration has a chance to correct it.
 */
export function AuctionCountdown({
  endsAt,
  initialSeconds,
  compact = false,
  onExpire,
  className,
}: {
  endsAt: string;
  initialSeconds: number;
  compact?: boolean;
  onExpire?: () => void;
  className?: string;
}) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    const target = new Date(endsAt).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setSeconds(remaining);
      return remaining;
    };

    tick();
    const interval = window.setInterval(() => {
      if (tick() === 0) {
        window.clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [endsAt, onExpire]);

  const urgent = isClosingSoon(seconds);
  const ended = seconds <= 0;

  if (compact) {
    return (
      <span
        className={cn(
          'tabular inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold',
          ended
            ? 'bg-secondary text-muted-foreground'
            : urgent
              ? 'bg-warning/15 text-warning'
              : 'bg-secondary text-secondary-foreground',
          className,
        )}
      >
        <Clock className="h-3 w-3" aria-hidden />
        {formatCountdown(seconds)}
      </span>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        ended
          ? 'border-border bg-secondary'
          : urgent
            ? 'animate-pulse-ring border-warning/40 bg-warning/10'
            : 'border-border bg-card',
        className,
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {ended ? 'Auction closed' : 'Time remaining'}
      </p>
      <p
        className={cn(
          'tabular text-2xl font-bold',
          ended ? 'text-muted-foreground' : urgent ? 'text-warning' : 'text-foreground',
        )}
        // Announce only in the final minutes; a per-second live region would
        // make a screen reader unusable for the whole auction.
        aria-live={urgent ? 'polite' : 'off'}
      >
        {formatCountdown(seconds)}
      </p>
    </div>
  );
}
