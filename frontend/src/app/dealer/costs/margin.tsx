import { formatCents } from '@vintrax/shared';
import { cn } from '@/lib/utils';

/** A gross margin, coloured by sign, or a dash when nothing is costed. */
export function Margin({ cents, className }: { cents: number | null; className?: string }) {
  if (cents === null) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span
      className={cn(
        'tabular font-semibold',
        cents < 0 ? 'text-destructive' : 'text-success',
        className,
      )}
    >
      {formatCents(cents)}
    </span>
  );
}
