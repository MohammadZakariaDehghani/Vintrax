'use client';

import { CarFront, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ListingSection, SectionState } from './listing-draft';

/** The mark beside a section: a tick, an exclamation mark, or its number. */
function Marker({ state, index, active }: { state: SectionState; index: number; active: boolean }) {
  if (state === 'done') {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-success/10 text-success">
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-primary bg-card text-sm font-bold leading-none text-primary">
        !
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid h-6 w-6 place-items-center rounded-full text-xs font-semibold',
        active ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground',
      )}
    >
      {index + 1}
    </span>
  );
}

const STATE_LABEL: Record<SectionState, string> = {
  done: 'complete',
  error: 'needs attention',
  todo: 'not started',
};

/**
 * The listing form's sections as a vertical timeline beside it: where the
 * dealer is, what is finished, and what still needs them. On a phone it
 * becomes a row of chips under the header.
 */
export function ListingTimeline({
  title,
  sections,
  states,
  active,
  onSelect,
}: {
  title: string;
  sections: readonly ListingSection[];
  states: Record<string, SectionState>;
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {/* Desktop: the vertical timeline. */}
      <nav
        aria-label="Listing sections"
        className="sticky top-24 hidden self-start rounded-xl border border-border bg-card p-4 shadow-sm lg:block"
      >
        <div className="flex items-center gap-2.5 border-b border-border pb-4">
          <CarFront className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <p className="truncate font-semibold">{title}</p>
        </div>
        <ol className="relative mt-3">
          {sections.map((section, index) => {
            const state = states[section.id] ?? 'todo';
            const isActive = section.id === active;
            const isLast = index === sections.length - 1;
            return (
              <li key={section.id} className="relative">
                {/* The line joining this marker to the next one. */}
                {!isLast ? (
                  <span
                    aria-hidden
                    className="absolute left-[27px] top-9 h-[calc(100%-1.5rem)] w-px bg-border"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelect(section.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={cn(
                    'relative flex w-full items-center gap-3 rounded-md py-2.5 pl-4 pr-2 text-left text-sm transition-colors hover:bg-secondary/70',
                    isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {isActive ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0 w-1 rounded-full bg-primary"
                    />
                  ) : null}
                  <Marker state={state} index={index} active={isActive} />
                  <span className={cn(state === 'error' && !isActive && 'text-foreground')}>
                    {section.label}
                    {section.required ? '*' : ''}
                  </span>
                  <span className="sr-only">, {STATE_LABEL[state]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Phone and tablet: the same sections as a scrolling row of chips. */}
      <nav
        aria-label="Listing sections"
        className="sticky top-16 z-20 -mx-4 overflow-x-auto border-b border-border bg-background/95 px-4 py-2 backdrop-blur lg:hidden"
      >
        <ol className="flex w-max gap-2">
          {sections.map((section, index) => {
            const state = states[section.id] ?? 'todo';
            const isActive = section.id === active;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => onSelect(section.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                    isActive
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <span className="scale-90">
                    <Marker state={state} index={index} active={isActive} />
                  </span>
                  {section.label}
                  {section.required ? '*' : ''}
                  <span className="sr-only">, {STATE_LABEL[state]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
