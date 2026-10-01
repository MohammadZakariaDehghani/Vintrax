'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Car,
  CircleDollarSign,
  Download,
  EyeOff,
  FilePen,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  DEALER_INVENTORY_SORTS,
  DEALER_INVENTORY_SORT_LABELS,
  LISTING_STATUSES,
  MAX_BULK_VEHICLE_IDS,
  SELLER_SETTABLE_LISTING_STATUSES,
  VEHICLE_SOURCES,
  VEHICLE_SOURCE_LABELS,
  type BulkVehicleResult,
  type DealerInventoryPage,
  type DealerInventorySelection,
  type DealerInventorySort,
  type DealerInventoryStats,
  type ListingStatus,
  type SellerSettableListingStatus,
  type VehicleSource,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatPrice } from '@/lib/utils';
import { saveBlob } from '@/lib/save-file';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  ErrorAlert,
  Input,
  Pagination,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { PAGE_SIZE_OPTIONS } from '@/components/list-controls';
import { DashboardNav } from '@/components/dashboard-nav';
import { DealerNav } from '@/components/dealer-nav';
import { StatTile } from '@/components/stat-tile';
import { useIsPrivateSeller } from '@/store/auth-store';
import { InventoryImportFlow } from './import/import-flow';
import { InventoryCard, InventoryTable, useInvalidateInventory } from './inventory-items';
import { VehicleSidePanel } from './vehicle-side-panel';

/** The filters, as they live in the address bar. Blank means "any". */
interface Filters {
  q: string;
  status: ListingStatus | '';
  make: string;
  model: string;
  yearMin: string;
  yearMax: string;
  priceMin: string;
  priceMax: string;
  source: VehicleSource | '';
}

const FILTER_KEYS: Array<keyof Filters> = [
  'q',
  'status',
  'make',
  'model',
  'yearMin',
  'yearMax',
  'priceMin',
  'priceMax',
  'source',
];

type View = 'table' | 'grid';

function readFilters(params: URLSearchParams): Filters {
  const status = params.get('status') ?? '';
  const source = params.get('source') ?? '';
  return {
    q: params.get('q') ?? '',
    status: (LISTING_STATUSES as readonly string[]).includes(status)
      ? (status as ListingStatus)
      : '',
    make: params.get('make') ?? '',
    model: params.get('model') ?? '',
    yearMin: digits(params.get('yearMin')),
    yearMax: digits(params.get('yearMax')),
    priceMin: digits(params.get('priceMin')),
    priceMax: digits(params.get('priceMax')),
    source: (VEHICLE_SOURCES as readonly string[]).includes(source)
      ? (source as VehicleSource)
      : '',
  };
}

function digits(value: string | null): string {
  return (value ?? '').replace(/[^\d]/g, '');
}

/** The filters as query parameters, blanks left out. */
function filterParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  return params;
}

/** Runs one bulk action over any number of ids, in the API's batch size, and merges the answers. */
async function inBatches(
  ids: string[],
  run: (batch: string[]) => Promise<BulkVehicleResult>,
): Promise<BulkVehicleResult> {
  const merged: BulkVehicleResult = { succeeded: 0, failed: 0, outcomes: [] };
  for (let start = 0; start < ids.length; start += MAX_BULK_VEHICLE_IDS) {
    const result = await run(ids.slice(start, start + MAX_BULK_VEHICLE_IDS));
    merged.succeeded += result.succeeded;
    merged.failed += result.failed;
    merged.outcomes.push(...result.outcomes);
  }
  return merged;
}

function Inventory() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const invalidate = useInvalidateInventory();
  // A private seller gets the simple list: no CSV, costs, filters or value.
  const simple = useIsPrivateSeller();

  const filters = useMemo(() => readFilters(new URLSearchParams(params.toString())), [params]);
  const sort = (DEALER_INVENTORY_SORTS as readonly string[]).includes(params.get('sort') ?? '')
    ? (params.get('sort') as DealerInventorySort)
    : 'updated_desc';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(Number(params.get('pageSize')))
    ? Number(params.get('pageSize'))
    : 20;
  const view: View = params.get('view') === 'grid' ? 'grid' : 'table';

  const [searchText, setSearchText] = useState(filters.q);
  const [showFilters, setShowFilters] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [allMatching, setAllMatching] = useState<DealerInventorySelection | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<SellerSettableListingStatus | ''>('');
  const [bulkResult, setBulkResult] = useState<{
    verb: string;
    result: BulkVehicleResult;
  } | null>(null);

  /** Writes new values into the address bar. Changing a filter returns to page 1. */
  function update(next: Record<string, string | number | null>, resetPage = true) {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, String(value));
    }
    if (resetPage) merged.delete('page');
    const query = merged.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Typing settles for a third of a second before it becomes a search.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText.trim() !== filters.q) update({ q: searchText.trim() });
    }, 300);
    return () => clearTimeout(timer);
    // `update` reads the current params; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const filterKey = filterParams(filters).toString();

  // A selection is of vehicles matching a filter; a different filter is a
  // different set, so it starts again.
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(null);
    setBulkResult(null);
  }, [filterKey]);

  const listQuery = new URLSearchParams(filterKey);
  listQuery.set('sort', sort);
  listQuery.set('page', String(page));
  listQuery.set('pageSize', String(pageSize));

  const list = useQuery({
    queryKey: ['dealer-inventory', listQuery.toString()],
    queryFn: () => api.get<DealerInventoryPage>(`/dealer/inventory?${listQuery.toString()}`),
    placeholderData: (previous) => previous,
  });
  const stats = useQuery({
    queryKey: ['dealer-inventory-stats'],
    queryFn: () => api.get<DealerInventoryStats>('/dealer/inventory/stats'),
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pageChecked = items.length > 0 && items.every((item) => selected.has(item.id));
  const pageIndeterminate = !pageChecked && items.some((item) => selected.has(item.id));
  const selectedIds = [...selected];

  function toggle(id: string, next: boolean) {
    setAllMatching(null);
    setSelected((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  }

  function togglePage(next: boolean) {
    setAllMatching(null);
    setSelected((current) => {
      const updated = new Set(current);
      for (const item of items) {
        if (next) updated.add(item.id);
        else updated.delete(item.id);
      }
      return updated;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(null);
    setConfirmingDelete(false);
  }

  const selectAll = useMutation({
    mutationFn: () => api.get<DealerInventorySelection>(`/dealer/inventory/selection?${filterKey}`),
    onSuccess: (selection) => {
      setSelected(new Set(selection.ids));
      setAllMatching(selection);
    },
  });

  const afterBulk = (verb: string, result: BulkVehicleResult) => {
    setBulkResult({ verb, result });
    clearSelection();
    invalidate();
  };

  const deleteMany = useMutation({
    mutationFn: (ids: string[]) =>
      inBatches(ids, (batch) =>
        api.post<BulkVehicleResult>('/vehicles/bulk-delete', { ids: batch, confirm: true }),
      ),
    onSuccess: (result) => afterBulk('deleted', result),
  });

  const statusMany = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: SellerSettableListingStatus }) =>
      inBatches(ids, (batch) =>
        api.patch<BulkVehicleResult>('/vehicles/bulk-status', { ids: batch, status }),
      ),
    onSuccess: (result, { status }) => {
      setBulkStatus('');
      afterBulk(`moved to ${formatEnum(status).toLowerCase()}`, result);
    },
  });

  const exportSelected = useMutation({
    mutationFn: async (ids: string[]) =>
      saveBlob(
        await api.download('/dealer/inventory/export', { ids }),
        'vintrax-inventory-selection.csv',
      ),
  });

  // The side panel's vehicle lives in the address bar, so a saved listing can
  // come back to it open, and the browser's back button closes it.
  const openId = params.get('open');
  const openVehicle = (id: string) => update({ open: id }, false);
  const closeVehicle = () => update({ open: null }, false);

  const activeFilterCount = FILTER_KEYS.filter((key) => key !== 'q' && filters[key]).length;
  const busy = deleteMany.isPending || statusMany.isPending;

  return (
    <div className="container py-8">
      <DashboardNav />
      <DealerNav />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {simple ? 'My listings' : 'Inventory'}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {simple
              ? 'Add your car, save it as a draft, publish it, and mark it sold.'
              : 'Manage your vehicles, pricing, costs, and listings.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {simple ? null : (
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              Upload CSV
            </Button>
          )}
          <Link href="/dealer/add-vehicle">
            <Button>
              <Plus className="h-4 w-4" aria-hidden />
              Add Vehicle
            </Button>
          </Link>
        </div>
      </div>

      <div
        className={`mb-6 grid gap-3 sm:grid-cols-2 ${simple ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}
      >
        <StatTile
          label={simple ? 'All cars' : 'Total inventory'}
          value={stats.data?.total ?? '—'}
          icon={Car}
        />
        <StatTile
          label="Active"
          value={stats.data?.active ?? '—'}
          hint={stats.data && !simple ? `${stats.data.inAuction} in auction` : undefined}
          icon={Tag}
        />
        <StatTile label="Sold" value={stats.data?.sold ?? '—'} icon={CircleDollarSign} />
        <StatTile
          label="Draft"
          value={stats.data?.draft ?? '—'}
          hint={stats.data ? `${stats.data.inReview} awaiting review` : undefined}
          icon={FilePen}
        />
        {simple ? null : (
          <StatTile
            label="Total inventory value"
            value={stats.data ? formatPrice(stats.data.inventoryValueCad) : '—'}
            hint="Asking prices, excluding sold and archived"
            icon={CircleDollarSign}
          />
        )}
      </div>
      <ErrorAlert error={stats.error} className="mb-4" />

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                className="pl-9"
                placeholder={
                  simple ? 'Search by make, model or VIN' : 'Search by VIN, stock #, make or model'
                }
                aria-label="Search your inventory"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </div>
            <Select
              aria-label="Status"
              className="w-auto"
              value={filters.status}
              onChange={(event) => update({ status: event.target.value })}
            >
              <option value="">All statuses</option>
              {LISTING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatEnum(status)}
                </option>
              ))}
            </Select>
            {simple ? null : (
              <Button
                variant={showFilters || activeFilterCount > 0 ? 'secondary' : 'outline'}
                onClick={() => setShowFilters((current) => !current)}
                aria-expanded={showFilters}
                aria-controls="inventory-filters"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Button>
            )}
            <Select
              aria-label="Sort by"
              className="w-auto"
              value={sort}
              onChange={(event) => update({ sort: event.target.value })}
            >
              {DEALER_INVENTORY_SORTS.map((option) => (
                <option key={option} value={option}>
                  {DEALER_INVENTORY_SORT_LABELS[option]}
                </option>
              ))}
            </Select>
            <div
              className="flex rounded-md border border-border p-0.5"
              role="group"
              aria-label="View"
            >
              {(
                [
                  ['table', List, 'Table'],
                  ['grid', LayoutGrid, 'Cards'],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  aria-label={`${label} view`}
                  onClick={() => update({ view: value === 'table' ? null : value }, false)}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors ${
                    view === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {showFilters ? (
            <div
              id="inventory-filters"
              className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Make</span>
                <Select
                  value={filters.make}
                  onChange={(event) => update({ make: event.target.value })}
                >
                  <option value="">Any make</option>
                  {(stats.data?.makes ?? []).map((make) => (
                    <option key={make} value={make}>
                      {make}
                    </option>
                  ))}
                </Select>
              </label>
              <FilterInput
                label="Model"
                value={filters.model}
                placeholder="e.g. Civic"
                onCommit={(value) => update({ model: value })}
              />
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Year</span>
                <div className="flex gap-2">
                  <FilterInput
                    label="From year"
                    hideLabel
                    numeric
                    value={filters.yearMin}
                    placeholder="From"
                    onCommit={(value) => update({ yearMin: value })}
                  />
                  <FilterInput
                    label="To year"
                    hideLabel
                    numeric
                    value={filters.yearMax}
                    placeholder="To"
                    onCommit={(value) => update({ yearMax: value })}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Price (CAD)</span>
                <div className="flex gap-2">
                  <FilterInput
                    label="Minimum price"
                    hideLabel
                    numeric
                    value={filters.priceMin}
                    placeholder="Min"
                    onCommit={(value) => update({ priceMin: value })}
                  />
                  <FilterInput
                    label="Maximum price"
                    hideLabel
                    numeric
                    value={filters.priceMax}
                    placeholder="Max"
                    onCommit={(value) => update({ priceMax: value })}
                  />
                </div>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Inventory source</span>
                <Select
                  value={filters.source}
                  onChange={(event) => update({ source: event.target.value })}
                >
                  <option value="">Any source</option>
                  {VEHICLE_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {VEHICLE_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearchText('');
                    update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
                  }}
                >
                  <X className="h-4 w-4" aria-hidden />
                  Clear filters
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <Card className="sticky top-2 z-10 mb-4 border-primary shadow-md">
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold" aria-live="polite">
                {selected.size} {selected.size === 1 ? 'vehicle' : 'vehicles'} selected
              </span>

              <div className="flex flex-wrap items-center gap-2 sm:ml-2">
                <Select
                  aria-label="New status for the selected vehicles"
                  className="h-8 w-auto min-w-44 text-sm"
                  value={bulkStatus}
                  onChange={(event) =>
                    setBulkStatus(event.target.value as SellerSettableListingStatus | '')
                  }
                >
                  <option value="">Change status…</option>
                  {SELLER_SETTABLE_LISTING_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatEnum(status)}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!bulkStatus || busy}
                  loading={statusMany.isPending}
                  onClick={() =>
                    bulkStatus && statusMany.mutate({ ids: selectedIds, status: bulkStatus })
                  }
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => statusMany.mutate({ ids: selectedIds, status: 'DRAFT' })}
                  title="Take the selected listings off the site, back to draft"
                >
                  <EyeOff className="h-4 w-4" aria-hidden />
                  Unpublish
                </Button>
                {simple ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={exportSelected.isPending}
                    onClick={() => exportSelected.mutate(selectedIds)}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Export CSV
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  <X className="h-4 w-4" aria-hidden />
                  Deselect all
                </Button>
              </div>
            </div>

            {allMatching ? (
              <p className="text-sm text-muted-foreground">
                All {allMatching.ids.length.toLocaleString('en-CA')} vehicles matching this view are
                selected
                {allMatching.truncated
                  ? ` (the first ${allMatching.ids.length.toLocaleString('en-CA')} of ${allMatching.total.toLocaleString('en-CA')} — narrow the filter to reach the rest)`
                  : ''}
                .{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline"
                  onClick={clearSelection}
                >
                  Clear selection
                </button>
              </p>
            ) : pageChecked && total > items.length ? (
              <p className="text-sm text-muted-foreground">
                All {items.length} on this page are selected.{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline disabled:opacity-60"
                  disabled={selectAll.isPending}
                  onClick={() => selectAll.mutate()}
                >
                  Select all {total.toLocaleString('en-CA')} matching vehicles
                </button>
              </p>
            ) : null}
            <ErrorAlert error={selectAll.error ?? exportSelected.error} />
          </CardContent>
        </Card>
      ) : null}

      <ErrorAlert error={list.error ?? deleteMany.error ?? statusMany.error} className="mb-4" />

      {bulkResult ? (
        <Card className="mb-4">
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

      {list.isPending ? (
        <Spinner label="Loading inventory" />
      ) : items.length > 0 ? (
        <>
          {/* Phones always get cards; the table needs a wider screen. */}
          <div className={view === 'table' ? 'hidden md:block' : 'hidden'}>
            <InventoryTable
              items={items}
              selected={selected}
              onSelect={toggle}
              onOpen={openVehicle}
              pageChecked={pageChecked}
              pageIndeterminate={pageIndeterminate}
              onTogglePage={togglePage}
            />
          </div>
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 ${view === 'table' ? 'md:hidden' : ''}`}
          >
            <label className="flex items-center gap-2 text-sm sm:col-span-2 xl:col-span-3">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={pageChecked}
                ref={(node) => {
                  if (node) node.indeterminate = pageIndeterminate;
                }}
                onChange={(event) => togglePage(event.target.checked)}
              />
              Select all on this page
            </label>
            {items.map((vehicle) => (
              <InventoryCard
                key={vehicle.id}
                vehicle={vehicle}
                selected={selected}
                onSelect={toggle}
                onOpen={openVehicle}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * pageSize + 1}–{(page - 1) * pageSize + items.length} of{' '}
              {total.toLocaleString('en-CA')}
            </p>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Per page
              <Select
                value={pageSize}
                onChange={(event) => update({ pageSize: event.target.value })}
                className="w-20"
                aria-label="Vehicles per page"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {list.data ? (
            <Pagination
              page={list.data.page}
              totalPages={list.data.totalPages}
              onChange={(next) => update({ page: next }, false)}
            />
          ) : null}
        </>
      ) : (
        <Card>
          {filterKey ? (
            <EmptyState
              title="No vehicles match"
              description="Nothing in your inventory matches this search and these filters, including drafts."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchText('');
                    update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
                  }}
                >
                  Clear search and filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No vehicles yet"
              description={
                simple
                  ? 'Add your car with its details and photos. Save it as a draft until it is ready.'
                  : 'Add a vehicle by hand, or upload your inventory as a CSV.'
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {simple ? null : (
                    <Button variant="outline" onClick={() => setUploadOpen(true)}>
                      Upload CSV
                    </Button>
                  )}
                  <Link href="/dealer/add-vehicle">
                    <Button>Add Vehicle</Button>
                  </Link>
                </div>
              }
            />
          )}
        </Card>
      )}

      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete ${selected.size} ${selected.size === 1 ? 'vehicle' : 'vehicles'}?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Keep them
            </Button>
            <Button
              variant="destructive"
              loading={deleteMany.isPending}
              onClick={() => deleteMany.mutate(selectedIds)}
            >
              Yes, delete
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The listings, their photos and their recorded costs are removed permanently. Vehicles in a
          live auction or marked sold are not deleted; they are listed afterwards with the reason.
        </p>
      </Dialog>

      <Dialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload inventory CSV"
        description="Nothing changes until you confirm. The first step checks every row and shows what it would do."
        size="xl"
      >
        <InventoryImportFlow compact onDone={() => setUploadOpen(false)} />
        <p className="mt-4 text-sm text-muted-foreground">
          Past imports and photo download progress are on the{' '}
          <Link href="/dealer/inventory/import" className="text-primary underline">
            Import inventory
          </Link>{' '}
          page.
        </p>
      </Dialog>

      <VehicleSidePanel
        vehicleId={openId}
        item={items.find((item) => item.id === openId)}
        onClose={closeVehicle}
      />
    </div>
  );
}

/** A text filter that applies when the dealer leaves the field or presses Enter. */
function FilterInput({
  label,
  value,
  placeholder,
  numeric = false,
  hideLabel = false,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  numeric?: boolean;
  hideLabel?: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = numeric ? text.replace(/[^\d]/g, '') : text.trim();
    if (next !== value) onCommit(next);
  };
  const input = (
    <Input
      value={text}
      placeholder={placeholder}
      inputMode={numeric ? 'numeric' : undefined}
      aria-label={hideLabel ? label : undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
  if (hideLabel) return input;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {input}
    </label>
  );
}

export default function InventoryPage() {
  return (
    <RequireAuth sellersOnly>
      {/* The filters live in the address bar, which a prerendered page can only
          read on the client. */}
      <Suspense fallback={<Spinner label="Loading inventory" />}>
        <Inventory />
      </Suspense>
    </RequireAuth>
  );
}
