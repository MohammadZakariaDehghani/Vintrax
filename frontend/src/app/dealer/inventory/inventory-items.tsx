'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Copy, Ellipsis, Eye, Pencil, Trash2 } from 'lucide-react';
import {
  VEHICLE_SOURCE_LABELS,
  formatCents,
  type DealerInventoryItem,
  type SellerSettableListingStatus,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { Badge, Button, Card, CardContent, Dialog, ErrorAlert, Input } from '@/components/ui';
import { PreviousPrice } from '@/components/previous-price';
import { IMAGE_SIZES, OptimizedImage } from '@/components/optimized-image';

/** "Sep 28, 2026": short enough for a table column. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const STATUS_VARIANT = {
  DRAFT: 'outline',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  IN_AUCTION: 'accent',
  SOLD: 'default',
  ARCHIVED: 'outline',
} as const;

/** Every query this page's writes can change. */
export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['dealer-inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['dealer-inventory-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['dealer-costs'] });
    void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };
}

/**
 * The status moves offered for a vehicle, following the seller transition
 * table the API enforces. ACTIVE is never offered: publishing is a moderation
 * decision.
 */
function statusMoves(
  status: DealerInventoryItem['status'],
): Array<{ to: SellerSettableListingStatus; label: string }> {
  switch (status) {
    case 'DRAFT':
      return [
        { to: 'PENDING_REVIEW', label: 'Submit for review' },
        { to: 'SOLD', label: 'Mark as sold' },
        { to: 'ARCHIVED', label: 'Archive' },
      ];
    case 'PENDING_REVIEW':
      return [
        { to: 'DRAFT', label: 'Withdraw to draft' },
        { to: 'SOLD', label: 'Mark as sold' },
      ];
    case 'ACTIVE':
      return [
        { to: 'SOLD', label: 'Mark as sold' },
        { to: 'DRAFT', label: 'Unpublish' },
        { to: 'ARCHIVED', label: 'Archive' },
      ];
    case 'ARCHIVED':
      return [
        { to: 'DRAFT', label: 'Restore to draft' },
        { to: 'SOLD', label: 'Mark as sold' },
      ];
    case 'SOLD':
      return [{ to: 'DRAFT', label: 'Reopen as draft' }];
    case 'IN_AUCTION':
    default:
      return [];
  }
}

/** A small popover menu that closes on an outside click or Escape. */
function MoreMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false);
        return;
      }
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 px-0"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis className="h-4 w-4" aria-hidden />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onSelect,
  children,
  destructive = false,
  disabled = false,
}: {
  onSelect: () => void;
  children: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm hover:bg-secondary disabled:opacity-50',
        destructive && 'text-destructive',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The actions for one vehicle, shared by the table row and the card so the two
 * cannot disagree about what a vehicle offers.
 */
export function VehicleActions({
  vehicle,
  compact = false,
}: {
  vehicle: DealerInventoryItem;
  compact?: boolean;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);

  const changeStatus = useMutation({
    mutationFn: (status: SellerSettableListingStatus) =>
      api.patch(`/vehicles/${vehicle.id}/status`, { status }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/vehicles/${vehicle.id}`),
    onSuccess: () => {
      setConfirmingDelete(false);
      invalidate();
    },
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/dealer/inventory/${vehicle.id}/duplicate`),
    onSuccess: ({ id }) => {
      invalidate();
      router.push(`/dealer/inventory/${id}?duplicated=1`);
    },
  });

  const priceEditable = vehicle.status !== 'IN_AUCTION' && vehicle.status !== 'SOLD';
  const deletable = !vehicle.inLiveAuction && vehicle.status !== 'SOLD';

  return (
    <div className={cn('flex items-center gap-1', compact ? 'justify-end' : 'flex-wrap')}>
      <Link
        href={`/vehicles/${vehicle.slug}`}
        title="View listing"
        aria-label={`View ${vehicle.title}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Eye className="h-4 w-4" aria-hidden />
      </Link>
      <Link
        href={`/dealer/inventory/${vehicle.id}`}
        title="Edit"
        aria-label={`Edit ${vehicle.title}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Pencil className="h-4 w-4" aria-hidden />
      </Link>
      <Link
        href={`/dealer/costs/${vehicle.id}`}
        title="Costs"
        aria-label={`Costs for ${vehicle.title}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Calculator className="h-4 w-4" aria-hidden />
      </Link>
      <button
        type="button"
        title="Duplicate"
        aria-label={`Duplicate ${vehicle.title}`}
        disabled={duplicate.isPending}
        onClick={() => duplicate.mutate()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        <Copy className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        title={deletable ? 'Delete' : 'A vehicle in an auction or marked sold cannot be deleted'}
        aria-label={`Delete ${vehicle.title}`}
        disabled={!deletable}
        onClick={() => setConfirmingDelete(true)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>

      <MoreMenu label={`More actions for ${vehicle.title}`}>
        {priceEditable ? (
          <MenuItem onSelect={() => setEditingPrice(true)}>Edit price</MenuItem>
        ) : null}
        {vehicle.status === 'ACTIVE' ? (
          <MenuItem onSelect={() => router.push(`/auctions/new?vehicleId=${vehicle.id}`)}>
            Run auction
          </MenuItem>
        ) : null}
        {statusMoves(vehicle.status).map((move) => (
          <MenuItem
            key={move.to}
            disabled={changeStatus.isPending}
            onSelect={() => changeStatus.mutate(move.to)}
          >
            {move.label}
          </MenuItem>
        ))}
        {vehicle.status === 'IN_AUCTION' ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
            In a running auction: cancel it to change the status.
          </p>
        ) : null}
      </MoreMenu>

      {changeStatus.error || duplicate.error ? (
        <ErrorAlert error={changeStatus.error ?? duplicate.error} className="mt-2 w-full" />
      ) : null}

      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this vehicle?"
        size="sm"
        description={`${vehicle.title}${vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The listing, its photos and its recorded costs are removed. This cannot be undone.
        </p>
        <ErrorAlert error={remove.error} className="mt-3" />
      </Dialog>

      <PriceDialog
        vehicle={vehicle}
        open={editingPrice}
        onClose={() => setEditingPrice(false)}
        onSaved={invalidate}
      />
    </div>
  );
}

/**
 * Changing the asking price without opening the full form. The previous price
 * is kept and shown struck through, here and on the public listing.
 */
function PriceDialog({
  vehicle,
  open,
  onClose,
  onSaved,
}: {
  vehicle: DealerInventoryItem;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(String(vehicle.priceCad));
  const price = Number(text.replace(/[^\d]/g, ''));
  const valid = Number.isInteger(price) && price >= 1;

  useEffect(() => {
    if (open) setText(String(vehicle.priceCad));
  }, [open, vehicle.priceCad]);

  const save = useMutation({
    mutationFn: () => api.patch(`/vehicles/${vehicle.id}`, { priceCad: price }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} title="Edit price" size="sm" description={vehicle.title}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || price === vehicle.priceCad) return onClose();
          save.mutate();
        }}
      >
        <label className="text-sm font-medium" htmlFor={`price-${vehicle.id}`}>
          New price (CAD)
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            id={`price-${vehicle.id}`}
            inputMode="numeric"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={!valid}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          The current price, {formatPrice(vehicle.priceCad)}, is shown struck through above the new
          one.
        </p>
        <ErrorAlert error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!valid}>
            Save price
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Thumb({ vehicle, className }: { vehicle: DealerInventoryItem; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-md bg-muted', className)}>
      {vehicle.primaryImageUrl ? (
        <OptimizedImage
          image={vehicle.primaryImage}
          src={vehicle.primaryImageUrl}
          alt=""
          sizes={IMAGE_SIZES.thumb}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-[10px] text-muted-foreground">
          No photo
        </div>
      )}
    </div>
  );
}

function CostCell({ vehicle }: { vehicle: DealerInventoryItem }) {
  if (vehicle.costCount === 0) {
    return (
      <Link
        href={`/dealer/costs/${vehicle.id}`}
        className="text-xs text-muted-foreground hover:text-primary hover:underline"
      >
        Add costs
      </Link>
    );
  }
  return (
    <Link
      href={`/dealer/costs/${vehicle.id}`}
      className="tabular hover:text-primary hover:underline"
    >
      {formatCents(vehicle.totalCostCents)}
    </Link>
  );
}

function StatusCell({ vehicle }: { vehicle: DealerInventoryItem }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={STATUS_VARIANT[vehicle.status]}>{formatEnum(vehicle.status)}</Badge>
      <span className="text-[11px] text-muted-foreground">
        {VEHICLE_SOURCE_LABELS[vehicle.source]}
      </span>
    </div>
  );
}

interface SelectionProps {
  selected: ReadonlySet<string>;
  onSelect: (id: string, selected: boolean) => void;
}

function SelectBox({
  vehicle,
  selected,
  onSelect,
}: SelectionProps & { vehicle: DealerInventoryItem }) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0 accent-primary"
      checked={selected.has(vehicle.id)}
      onChange={(event) => onSelect(vehicle.id, event.target.checked)}
      aria-label={`Select ${vehicle.title}`}
    />
  );
}

/** The desktop table. Scrolls sideways inside its card rather than widening the page. */
export function InventoryTable({
  items,
  selected,
  onSelect,
  pageChecked,
  pageIndeterminate,
  onTogglePage,
}: SelectionProps & {
  items: DealerInventoryItem[];
  pageChecked: boolean;
  pageIndeterminate: boolean;
  onTogglePage: (next: boolean) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-border bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  aria-label="Select every vehicle on this page"
                  checked={pageChecked}
                  ref={(node) => {
                    if (node) node.indeterminate = pageIndeterminate;
                  }}
                  onChange={(event) => onTogglePage(event.target.checked)}
                  disabled={items.length === 0}
                />
              </th>
              <th scope="col" className="w-20 px-2 py-3">
                Photo
              </th>
              <th scope="col" className="px-3 py-3">
                Year / Make / Model
              </th>
              <th scope="col" className="px-3 py-3">
                VIN
              </th>
              <th scope="col" className="px-3 py-3">
                Stock #
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Mileage
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Price
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Cost
              </th>
              <th scope="col" className="px-3 py-3">
                Status
              </th>
              <th scope="col" className="px-3 py-3">
                Last updated
              </th>
              <th scope="col" className="px-3 py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((vehicle) => {
              const isSelected = selected.has(vehicle.id);
              return (
                <tr
                  key={vehicle.id}
                  className={cn(
                    'align-middle',
                    isSelected ? 'bg-primary/5' : 'hover:bg-secondary/40',
                  )}
                >
                  <td className="px-3 py-2">
                    <SelectBox vehicle={vehicle} selected={selected} onSelect={onSelect} />
                  </td>
                  <td className="px-2 py-2">
                    <Thumb vehicle={vehicle} className="h-12 w-16" />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/dealer/inventory/${vehicle.id}`}
                      className="font-semibold hover:text-primary"
                    >
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </Link>
                    {vehicle.trim ? (
                      <p className="text-xs text-muted-foreground">{vehicle.trim}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{vehicle.vin ?? '—'}</td>
                  <td className="px-3 py-2">{vehicle.stockNumber ?? '—'}</td>
                  <td className="tabular px-3 py-2 text-right">{formatKm(vehicle.mileageKm)}</td>
                  <td className="px-3 py-2 text-right">
                    <PreviousPrice previous={vehicle.previousPriceCad} current={vehicle.priceCad} />
                    <span className="tabular font-semibold">{formatPrice(vehicle.priceCad)}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CostCell vehicle={vehicle} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusCell vehicle={vehicle} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {shortDate(vehicle.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <VehicleActions vehicle={vehicle} compact />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** A vehicle as a card: the grid view, and the list on a phone. */
export function InventoryCard({
  vehicle,
  selected,
  onSelect,
}: SelectionProps & { vehicle: DealerInventoryItem }) {
  const isSelected = selected.has(vehicle.id);
  return (
    <Card className={cn('flex min-w-0 flex-col', isSelected && 'border-primary')}>
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <div className="flex items-start gap-3">
          <div className="pt-1">
            <SelectBox vehicle={vehicle} selected={selected} onSelect={onSelect} />
          </div>
          <Thumb vehicle={vehicle} className="h-16 w-24 shrink-0" />
          <div className="min-w-0 flex-1">
            <Link
              href={`/dealer/inventory/${vehicle.id}`}
              className="block truncate font-semibold hover:text-primary"
            >
              {vehicle.year} {vehicle.make} {vehicle.model}
            </Link>
            {vehicle.trim ? (
              <p className="truncate text-xs text-muted-foreground">{vehicle.trim}</p>
            ) : null}
            <div className="mt-1">
              <StatusCell vehicle={vehicle} />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Price</dt>
          <dd className="text-right">
            <PreviousPrice previous={vehicle.previousPriceCad} current={vehicle.priceCad} />
            <span className="tabular font-semibold">{formatPrice(vehicle.priceCad)}</span>
          </dd>
          <dt className="text-muted-foreground">Cost</dt>
          <dd className="text-right">
            <CostCell vehicle={vehicle} />
          </dd>
          <dt className="text-muted-foreground">Mileage</dt>
          <dd className="tabular text-right">{formatKm(vehicle.mileageKm)}</dd>
          <dt className="text-muted-foreground">VIN</dt>
          <dd className="truncate text-right font-mono">{vehicle.vin ?? '—'}</dd>
          <dt className="text-muted-foreground">Stock #</dt>
          <dd className="text-right">{vehicle.stockNumber ?? '—'}</dd>
          <dt className="text-muted-foreground">Updated</dt>
          <dd className="text-right">{shortDate(vehicle.updatedAt)}</dd>
        </dl>

        <div className="mt-auto border-t border-border pt-2">
          <VehicleActions vehicle={vehicle} />
        </div>
      </CardContent>
    </Card>
  );
}
