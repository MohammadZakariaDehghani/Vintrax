'use client';

import { CheckSquare, GitCompare, Square } from 'lucide-react';
import { MAX_COMPARE_VEHICLES, useCompareStore, useIsInCompare } from '@/store/compare-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';

/**
 * Adds or removes one vehicle from the comparison list.
 *
 * Two shapes, one piece of state: `compact` is the small, unobtrusive
 * checkbox a card or row carries (issue #54's own "☐ Compare"); the full
 * button is what the vehicle detail page shows, sized and worded like every
 * other primary action there ("Add to Compare" / "Remove from Compare").
 * Both read and write the same `useCompareStore`, so ticking a card and then
 * opening that vehicle's own page shows it already selected, with no prop
 * threading between them.
 *
 * Always a real `<button>`, never a `role="checkbox"` on a `<div>` — the
 * native element is what gives this keyboard operability and a screen
 * reader's toggle-button announcement for free. `aria-pressed` reflects the
 * selection because this toggles a persistent choice rather than performing
 * a one-off action, the same distinction `VehicleCard`'s favourite button
 * already makes.
 */
export function CompareButton({
  vehicleId,
  compact = false,
  className,
}: {
  vehicleId: string;
  compact?: boolean;
  className?: string;
}) {
  const selected = useIsInCompare(vehicleId);
  const toggle = useCompareStore((state) => state.toggle);

  // Cards and rows put this inside a link (a full-card link, or the "stretched
  // link" pattern `VehicleRow` uses) — without stopping the event, ticking the
  // box would also navigate to the listing.
  function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    toggle(vehicleId);
  }

  const label = selected ? 'Remove from Compare' : 'Add to Compare';
  const hint =
    !selected && !compact
      ? undefined
      : !selected
        ? `Compare up to ${MAX_COMPARE_VEHICLES} vehicles at a time.`
        : undefined;

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={selected}
        title={hint}
        className={cn(
          'flex items-center gap-1.5 rounded-md bg-background/85 px-2 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          className,
        )}
      >
        {selected ? (
          <CheckSquare className="h-3.5 w-3.5 text-primary" aria-hidden />
        ) : (
          <Square className="h-3.5 w-3.5" aria-hidden />
        )}
        Compare
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={selected ? 'secondary' : 'outline'}
      size="sm"
      onClick={handleClick}
      aria-pressed={selected}
      className={className}
    >
      <GitCompare className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
