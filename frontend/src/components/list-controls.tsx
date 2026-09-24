'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Select } from '@/components/ui';

/** Page sizes offered on every admin and dealer list. The server caps a page at 100. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/**
 * A list's page size, remembered per list in this browser so an operator who
 * works a hundred at a time is not put back to twenty on every visit.
 */
export function usePageSize(storageKey: string, fallback: number = 20) {
  const [size, setSize] = useState<number>(fallback);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(storageKey));
      if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(stored)) setSize(stored);
    } catch {
      // No storage (a private window): the default stands.
    }
  }, [storageKey]);

  const update = useCallback(
    (next: number) => {
      setSize(next);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Not remembering it only costs the preference on the next visit.
      }
    },
    [storageKey],
  );

  return [size, update] as const;
}

/**
 * Ticked rows on the page on screen.
 *
 * `resetKey` is whatever identifies that page — tab, page number, size,
 * search. When it changes the selection is cleared: carrying ids across would
 * mean acting on rows the operator can no longer see.
 */
export function useRowSelection(ids: readonly string[], resetKey: string) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setSelected(new Set());
  }, [resetKey]);

  const toggle = useCallback((id: string, next: boolean) => {
    setSelected((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  }, []);

  const toggleAll = useCallback(
    (next: boolean) => setSelected(next ? new Set(ids) : new Set()),
    [ids],
  );

  const selectedIds = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);

  return {
    selected,
    selectedIds,
    toggle,
    toggleAll,
    clear: () => setSelected(new Set()),
    allSelected: ids.length > 0 && selectedIds.length === ids.length,
    someSelected: selectedIds.length > 0,
  };
}

/** What a bulk action did, one request per row. */
export interface BulkOutcome {
  succeeded: number;
  failed: number;
  /** The first failure's message, which usually explains the rest. */
  firstError: string | null;
}

/**
 * Runs one request per selected row and reports how many worked. Rows are
 * independent — one dealership already verified, or one user an administrator
 * may not suspend, does not stop the others.
 */
export async function runBulk(
  ids: readonly string[],
  action: (id: string) => Promise<unknown>,
): Promise<BulkOutcome> {
  const results = await Promise.allSettled(ids.map((id) => action(id)));
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  return {
    succeeded: results.length - failures.length,
    failed: failures.length,
    firstError: failures[0]
      ? failures[0].reason instanceof Error
        ? failures[0].reason.message
        : String(failures[0].reason)
      : null,
  };
}

/** One line saying what a bulk action did. */
export function BulkOutcomeNote({ outcome, verb }: { outcome: BulkOutcome; verb: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {outcome.succeeded} {verb}
      {outcome.failed > 0
        ? `, ${outcome.failed} not${outcome.firstError ? ` (${outcome.firstError})` : ''}`
        : ''}
      .
    </p>
  );
}

/** A row's own checkbox, labelled for a screen reader by what it selects. */
export function RowCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      className="mt-1 h-4 w-4 shrink-0 accent-primary"
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/**
 * The bar above a list: "Select all on this page", the actions for the ticked
 * rows (shown once something is ticked), and how many rows a page shows.
 */
export function ListToolbar({
  selection,
  itemCount,
  pageSize,
  onPageSizeChange,
  noun,
  children,
}: {
  selection: Pick<
    ReturnType<typeof useRowSelection>,
    'allSelected' | 'someSelected' | 'toggleAll' | 'selectedIds'
  >;
  itemCount: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  /** Plural, for the page-size label: "dealerships per page". */
  noun: string;
  /** The bulk actions, shown only while something is selected. */
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={selection.allSelected}
          // Some but not all: neither ticked nor empty, because clearing a
          // partial selection and adding to it are different acts.
          ref={(node) => {
            if (node) node.indeterminate = selection.someSelected && !selection.allSelected;
          }}
          onChange={(event) => selection.toggleAll(event.target.checked)}
          disabled={itemCount === 0}
        />
        Select all on this page
      </label>

      {selection.someSelected ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {selection.selectedIds.length} selected
          </span>
          {children}
        </div>
      ) : null}

      <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        Per page
        <Select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="w-20"
          aria-label={`${noun} per page`}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
