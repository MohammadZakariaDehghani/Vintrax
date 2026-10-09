'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A rating shown as stars, read out as words ("4 out of 5 stars"). */
export function Stars({
  rating,
  className,
  size = 'sm',
}: {
  rating: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const rounded = Math.round(rating * 2) / 2;
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((value) => {
        const fill = rounded >= value ? 'full' : rounded >= value - 0.5 ? 'half' : 'empty';
        return (
          <span key={value} className={cn('relative inline-block', box)} aria-hidden>
            <Star
              className={cn('absolute inset-0 text-muted-foreground/40', box)}
              strokeWidth={1.5}
            />
            {fill !== 'empty' ? (
              <span
                className={cn(
                  'absolute inset-0 overflow-hidden',
                  fill === 'half' ? 'w-1/2' : 'w-full',
                )}
              >
                <Star className={cn('fill-warning text-warning', box)} strokeWidth={1.5} />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/**
 * Choosing a rating: a radio group, so it works with a keyboard (Tab to the
 * group, arrows to move, the choice follows focus) and reads correctly in a
 * screen reader. Hovering previews a rating without choosing it. The stars
 * are 40px targets, comfortable on a phone.
 */
export function StarInput({
  value,
  onChange,
  id,
  invalid,
  describedBy,
}: {
  value: number;
  onChange: (value: number) => void;
  id: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [hover, setHover] = useState(0);
  const group = useRef<HTMLDivElement>(null);
  const shown = hover || value;

  /** Arrows move the choice and the focus together, as in any radio group. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    let next = 0;
    if (event.key === 'Home') next = 1;
    else if (event.key === 'End') next = 5;
    else if (step) next = Math.min(5, Math.max(1, (value || 0) + step));
    if (!next) return;
    event.preventDefault();
    onChange(next);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next - 1]?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        id={id}
        ref={group}
        role="radiogroup"
        aria-label="Rating"
        aria-required="true"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="flex"
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const checked = value === star;
          // Only one star is in the tab order: the chosen one, or the first.
          const tabbable = checked || (!value && star === 1);
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${star} star${star > 1 ? 's' : ''}, ${WORDS[star]}`}
              tabIndex={tabbable ? 0 : -1}
              onClick={() => onChange(star)}
              onMouseEnter={() => setHover(star)}
              onFocus={() => setHover(0)}
              className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={cn(
                  'h-8 w-8 transition-colors',
                  star <= shown ? 'fill-warning text-warning' : 'text-muted-foreground/50',
                )}
                strokeWidth={1.5}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      <span className="text-sm font-medium" aria-hidden>
        {shown ? `${shown} / 5 · ${WORDS[shown]}` : 'Choose a rating'}
      </span>
    </div>
  );
}
