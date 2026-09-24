import { formatPrice } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * The asking price before the most recent change, struck through, shown
 * above the current price wherever a listing's price is. Nothing when the
 * price has never changed.
 */
export function PreviousPrice({
  previous,
  current,
  className,
}: {
  previous: number | null | undefined;
  current: number;
  className?: string;
}) {
  if (previous === null || previous === undefined || previous === current) return null;
  return (
    <p className={cn('tabular text-sm text-muted-foreground', className)}>
      <span className="sr-only">Previously </span>
      <s>{formatPrice(previous)}</s>
    </p>
  );
}
