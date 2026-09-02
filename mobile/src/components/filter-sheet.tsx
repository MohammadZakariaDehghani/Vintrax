'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BODY_TYPES, FUEL_TYPES, PROVINCES, type SearchFacets } from '@atlas/shared';
import { EMPTY_FILTERS, toggleInArray, type VehicleFilters } from '@atlas/client';
import { cn, formatEnum, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui';

/**
 * Filters, as a bottom sheet.
 *
 * Sheets beat a filter page on a phone: the results stay behind them, so the
 * cost of a wrong choice is one tap. Choices are chips rather than a select —
 * a native picker on iOS covers half the screen for a single value.
 */
export function FilterSheet({
  filters,
  facets,
  onApply,
  onClose,
}: {
  filters: VehicleFilters;
  facets?: SearchFacets | undefined;
  onApply: (filters: VehicleFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<VehicleFilters>(filters);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus moves into the sheet so a keyboard or screen-reader user is not
    // left behind on the page underneath.
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    // The page behind must not scroll while the sheet is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const makes = facets?.makes.slice(0, 12) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Tap-to-dismiss. Deliberately not a button: it would be a second
          control with the same accessible name as the header's close button,
          and it is unreachable by keyboard anyway — Escape and that button are
          how assistive technology closes this. */}
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/50" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-sheet-title"
        className="relative flex max-h-[85vh] flex-col rounded-t-2xl bg-card animate-slide-up"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 id="filter-sheet-title" className="flex-1 px-1 text-base font-semibold">
            Filters
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg active:bg-secondary"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <Group label="Price">
            <div className="flex items-center gap-2">
              <NumberInput
                label="Min price"
                value={draft.minPrice ?? ''}
                onChange={(value) => setDraft({ ...draft, minPrice: value || undefined })}
              />
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
              <NumberInput
                label="Max price"
                value={draft.maxPrice ?? ''}
                onChange={(value) => setDraft({ ...draft, maxPrice: value || undefined })}
              />
            </div>
          </Group>

          <Group label="Year">
            <div className="flex items-center gap-2">
              <NumberInput
                label="From year"
                value={draft.minYear ?? ''}
                onChange={(value) => setDraft({ ...draft, minYear: value || undefined })}
              />
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
              <NumberInput
                label="To year"
                value={draft.maxYear ?? ''}
                onChange={(value) => setDraft({ ...draft, maxYear: value || undefined })}
              />
            </div>
          </Group>

          {makes.length > 0 ? (
            <Group label="Make">
              <ChipRow>
                {makes.map((make) => (
                  <Chip
                    key={make.value}
                    selected={draft.make === make.value}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        make: draft.make === make.value ? undefined : make.value,
                      })
                    }
                  >
                    {make.value}
                    <Count count={make.count} />
                  </Chip>
                ))}
              </ChipRow>
            </Group>
          ) : null}

          <Group label="Body type">
            <ChipRow>
              {BODY_TYPES.map((bodyType) => (
                <Chip
                  key={bodyType}
                  selected={draft.bodyType.includes(bodyType)}
                  onClick={() =>
                    setDraft({ ...draft, bodyType: toggleInArray(draft.bodyType, bodyType) })
                  }
                >
                  {formatEnum(bodyType)}
                </Chip>
              ))}
            </ChipRow>
          </Group>

          <Group label="Fuel">
            <ChipRow>
              {FUEL_TYPES.map((fuelType) => (
                <Chip
                  key={fuelType}
                  selected={draft.fuelType.includes(fuelType)}
                  onClick={() =>
                    setDraft({ ...draft, fuelType: toggleInArray(draft.fuelType, fuelType) })
                  }
                >
                  {formatEnum(fuelType)}
                </Chip>
              ))}
            </ChipRow>
          </Group>

          <Group label="Province">
            <ChipRow>
              {PROVINCES.map((province) => (
                <Chip
                  key={province}
                  selected={draft.province === province}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      province: draft.province === province ? undefined : province,
                    })
                  }
                >
                  {province}
                </Chip>
              ))}
            </ChipRow>
          </Group>

          <Group label="Condition report">
            <Chip
              selected={draft.inspectedOnly === 'true'}
              onClick={() =>
                setDraft({
                  ...draft,
                  inspectedOnly: draft.inspectedOnly === 'true' ? undefined : 'true',
                })
              }
            >
              Inspected only
            </Chip>
          </Group>
        </div>

        <footer
          className="flex gap-2 border-t border-border p-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <Button
            variant="outline"
            size="large"
            onClick={() => setDraft({ ...EMPTY_FILTERS, q: draft.q, sort: draft.sort })}
          >
            Reset
          </Button>
          <Button size="large" fullWidth onClick={() => onApply(draft)}>
            Show results
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {children}
    </fieldset>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-touch items-center gap-1 rounded-full border px-3.5 text-sm',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background',
      )}
    >
      {children}
    </button>
  );
}

function Count({ count }: { count: number }) {
  return <span className="text-xs opacity-70">{formatNumber(count)}</span>;
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={`filter-${label.replace(/\s+/g, '-').toLowerCase()}`}>
        {label}
      </label>
      <input
        id={`filter-${label.replace(/\s+/g, '-').toLowerCase()}`}
        type="text"
        // A numeric keypad without the spinner and locale quirks of type=number.
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
        className="min-h-touch w-full rounded-lg border border-input bg-background px-3 text-base"
      />
    </>
  );
}
