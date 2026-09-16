'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List, Plus, Send, Trash2, Upload, X } from 'lucide-react';
import type { BulkVehicleResult, ListingStatus, Paginated, VehicleSummary } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Pagination,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { useIsAdmin } from '@/store/auth-store';
import { DashboardNav } from '@/components/dashboard-nav';
import { InventoryCard, InventoryRow } from './inventory-items';

const TABS: Array<{ label: string; status?: ListingStatus }> = [
  { label: 'All' },
  { label: 'Live', status: 'ACTIVE' },
  { label: 'In auction', status: 'IN_AUCTION' },
  { label: 'Drafts', status: 'DRAFT' },
  // Without these two a listing awaiting moderation, or one the seller
  // archived, is reachable only from the "All" tab.
  { label: 'In review', status: 'PENDING_REVIEW' },
  { label: 'Sold', status: 'SOLD' },
  { label: 'Archived', status: 'ARCHIVED' },
];

/** Capped by MAX_PAGE_SIZE on the server, which is 100. */
const PAGE_SIZES = [10, 50, 100] as const;

type View = 'list' | 'grid';

/**
 * Remembers the view and page size for this browser.
 *
 * A per-viewer convenience, so browser storage is the right home for it: it
 * never has to be read back by the server and it does not matter if it comes
 * back empty. Every access is guarded because it throws outright in a private
 * window with site data blocked.
 */
function useRemembered<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && (allowed as readonly string[]).includes(stored)) setValue(stored as T);
    } catch {
      // No stored preference available. The default is already correct.
    }
    // `allowed` is a module-level constant; re-running on its identity would
    // loop. The key is what identifies this preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Not storing it only costs the preference on the next visit.
    }
  };

  return [value, update] as const;
}

function Inventory() {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(1);
  const [view, setView] = useRemembered<View>('vintrax.inventory.view', 'list', ['list', 'grid']);
  const [pageSizeText, setPageSizeText] = useRemembered(
    'vintrax.inventory.pageSize',
    '10',
    PAGE_SIZES.map(String),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // The verb rides with the result. Reading it off a mutation's `isSuccess`
  // would keep saying "deleted" after the next submit, because a settled
  // mutation stays settled.
  const [bulkResult, setBulkResult] = useState<{
    verb: string;
    result: BulkVehicleResult;
  } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();

  const pageSize = Number(pageSizeText);
  const status = TABS[tab]?.status;

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);

  const { data, isPending, error } = useQuery({
    queryKey: ['my-inventory', status ?? 'ALL', page, pageSize],
    queryFn: () => api.get<Paginated<VehicleSummary>>(`/vehicles/mine?${query.toString()}`),
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  // A selection is only meaningful for vehicles on screen. Carrying ids across
  // a tab or page change would mean confirming an action on rows the dealer can
  // no longer see.
  useEffect(() => {
    setSelected(new Set());
    setBulkResult(null);
    setConfirmingDelete(false);
  }, [tab, page, pageSize]);

  const submitMany = useMutation({
    mutationFn: (ids: string[]) =>
      api.patch<BulkVehicleResult>('/vehicles/bulk-status', { ids, status: 'PENDING_REVIEW' }),
    onSuccess: (result) => {
      setBulkResult({ verb: 'submitted for review', result });
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  /**
   * Deleting a selection.
   *
   * Offered to administrators only, which is what issue #34 asked for, and the
   * server enforces the rest: each id goes through the single-vehicle delete, so
   * a dealer calling this route directly still reaches only their own vehicles
   * and the live-auction and sales-record guards still refuse.
   */
  const deleteMany = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<BulkVehicleResult>('/vehicles/bulk-delete', { ids, confirm: true }),
    onSuccess: (result) => {
      setBulkResult({ verb: 'deleted', result });
      setSelected(new Set());
      setConfirmingDelete(false);
      void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  function toggle(id: string, next: boolean) {
    setSelected((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  }

  const allOnPageSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const someOnPageSelected = items.some((item) => selected.has(item.id));

  function toggleAll(next: boolean) {
    setSelected(next ? new Set(items.map((item) => item.id)) : new Set());
  }

  const selectedIds = items.filter((item) => selected.has(item.id)).map((item) => item.id);

  return (
    <div className="container py-8">
      <DashboardNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/dealer/inventory/import">
            <Button variant="outline">
              <Upload className="h-4 w-4" aria-hidden />
              Import / export CSV
            </Button>
          </Link>
          <Link href="/dealer/add-vehicle">
            <Button>
              <Plus className="h-4 w-4" aria-hidden />
              Add vehicle
            </Button>
          </Link>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((entry, index) => (
          <button
            key={entry.label}
            type="button"
            role="tab"
            aria-selected={index === tab}
            onClick={() => {
              setTab(index);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              index === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={allOnPageSelected}
            // Some but not all: the box shows neither ticked nor empty, because
            // clearing a partial selection and adding to it are different acts.
            ref={(node) => {
              if (node) node.indeterminate = someOnPageSelected && !allOnPageSelected;
            }}
            onChange={(event) => toggleAll(event.target.checked)}
            disabled={items.length === 0}
          />
          Select all on this page
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Per page
            <Select
              value={pageSizeText}
              onChange={(event) => {
                setPageSizeText(event.target.value);
                setPage(1);
              }}
              className="w-20"
              aria-label="Vehicles per page"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex rounded-md border border-border p-0.5" role="group">
            {(
              [
                ['list', List, 'List'],
                ['grid', LayoutGrid, 'Grid'],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                aria-label={`${label} view`}
                onClick={() => setView(value)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors ${
                  view === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <Card className="mb-4 border-primary">
          <CardContent className="flex flex-wrap items-center gap-3 pt-4">
            <span className="text-sm font-medium">{selectedIds.length} selected on this page</span>
            <Button
              size="sm"
              loading={submitMany.isPending}
              onClick={() => submitMany.mutate(selectedIds)}
            >
              <Send className="mr-2 h-4 w-4" aria-hidden />
              Submit for review
            </Button>
            {/* Administrators only. A second click is required because this is
                the one bulk action that cannot be undone, and the count is
                repeated in the confirmation so it is read rather than clicked
                past. */}
            {isAdmin ? (
              confirmingDelete ? (
                <>
                  <span className="text-sm font-medium text-destructive">
                    Delete {selectedIds.length} {selectedIds.length === 1 ? 'vehicle' : 'vehicles'}{' '}
                    permanently?
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    loading={deleteMany.isPending}
                    onClick={() => deleteMany.mutate(selectedIds)}
                  >
                    Yes, delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleteMany.isPending}
                  >
                    Keep them
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                  Delete
                </Button>
              )
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmingDelete(false);
                toggleAll(false);
              }}
            >
              <X className="mr-2 h-4 w-4" aria-hidden />
              Clear
            </Button>
            {/* Said before the click, not discovered after it. Only a draft can
                enter review, so a mixed selection is partly refused by design. */}
            <span className="text-sm text-muted-foreground">
              Only drafts can enter review. Anything else in the selection is reported and left as
              it is.
            </span>
          </CardContent>
        </Card>
      ) : null}

      <ErrorAlert error={error ?? submitMany.error ?? deleteMany.error} className="mb-5" />

      {/* Partial success is the normal outcome of a bulk action, so the result
          is shown per vehicle rather than as "done". */}
      {bulkResult ? (
        <Card className="mb-5">
          <CardContent className="pt-4">
            <p className="text-sm">
              <strong>{bulkResult.result.succeeded}</strong> {bulkResult.verb}
              {bulkResult.result.failed > 0 ? `, ${bulkResult.result.failed} left unchanged` : ''}.
            </p>
            {bulkResult.result.failed > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                {bulkResult.result.outcomes
                  .filter((outcome) => !outcome.ok)
                  .map((outcome) => (
                    <li key={outcome.id}>
                      {outcome.title ?? outcome.id}: {outcome.error}
                    </li>
                  ))}
              </ul>
            ) : null}
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setBulkResult(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isPending ? (
        <Spinner />
      ) : items.length > 0 ? (
        <>
          {view === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((vehicle) => (
                <InventoryCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  selected={selected.has(vehicle.id)}
                  onSelect={toggle}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((vehicle) => (
                <InventoryRow
                  key={vehicle.id}
                  vehicle={vehicle}
                  selected={selected.has(vehicle.id)}
                  onSelect={toggle}
                />
              ))}
            </div>
          )}

          <p className="mt-4 text-sm text-muted-foreground">
            Showing {items.length} of {data?.total ?? items.length}
          </p>
          {data ? (
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          ) : null}
        </>
      ) : (
        <Card>
          <EmptyState
            title="Nothing here yet"
            description="Vehicles you create appear here, including drafts that are not yet public."
            action={
              <Link href="/dealer/add-vehicle">
                <Button>Create your first listing</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <RequireAuth sellersOnly>
      <Inventory />
    </RequireAuth>
  );
}
