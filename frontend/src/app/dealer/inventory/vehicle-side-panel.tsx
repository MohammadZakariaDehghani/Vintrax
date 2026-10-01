'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Calculator,
  Copy,
  Eye,
  FileText,
  Heart,
  Image as ImageIcon,
  Info,
  ListChecks,
  Pencil,
  Printer,
  Trash2,
  X,
} from 'lucide-react';
import {
  listingQuality,
  type DealerInventoryItem,
  type ListingQualityArea,
  type SimilarCars,
  type VehicleDetail,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { useIsPrivateSeller } from '@/store/auth-store';
import { cn, formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { Badge, Button, Dialog, ErrorAlert, Spinner } from '@/components/ui';
import { IMAGE_SIZES, OptimizedImage } from '@/components/optimized-image';
import {
  PriceDialog,
  QualityPill,
  STATUS_VARIANT,
  shortDate,
  useInvalidateInventory,
} from './inventory-items';

type Tab = 'standard' | 'performance' | 'competitors';

const QUALITY_ICON: Record<ListingQualityArea, typeof ImageIcon> = {
  PHOTOS: ImageIcon,
  DESCRIPTION: ListChecks,
  VEHICLE_DATA: Info,
};
const QUALITY_LABEL: Record<ListingQualityArea, string> = {
  PHOTOS: 'Images',
  DESCRIPTION: 'Description',
  VEHICLE_DATA: 'Vehicle data',
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-semibold">{value || '—'}</dd>
    </div>
  );
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * One vehicle at a glance, opened from the inventory list: the photo and key
 * facts, its price and listing quality, how it is doing, how its price sits
 * against the same car elsewhere on Vintrax, and the actions a dealer reaches
 * for — without leaving the list.
 */
export function VehicleSidePanel({
  vehicleId,
  item,
  onClose,
}: {
  vehicleId: string | null;
  /** The list row, when it is on the current page; the panel does not need it. */
  item?: DealerInventoryItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const invalidate = useInvalidateInventory();
  const simple = useIsPrivateSeller();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('standard');
  const [editingPrice, setEditingPrice] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [explainQuality, setExplainQuality] = useState(false);
  const open = vehicleId !== null;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (open) setTab('standard');
  }, [open, vehicleId]);

  const detail = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    enabled: open,
  });
  const vehicle = detail.data;

  const similar = useQuery({
    queryKey: ['car-value', 'similar-panel', vehicle?.year, vehicle?.make, vehicle?.model],
    queryFn: () =>
      api.get<SimilarCars>(
        `/car-value/similar?${new URLSearchParams({
          year: String(vehicle!.year),
          make: vehicle!.make,
          model: vehicle!.model,
          mileageKm: String(vehicle!.mileageKm),
          pageSize: '50',
        }).toString()}`,
      ),
    enabled: open && tab === 'competitors' && Boolean(vehicle),
    staleTime: 60_000,
  });

  const refresh = () => {
    invalidate();
    void detail.refetch();
  };

  const changeStatus = useMutation({
    mutationFn: (status: 'DRAFT' | 'PENDING_REVIEW') =>
      api.patch(`/vehicles/${vehicleId}/status`, { status }),
    onSuccess: refresh,
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/dealer/inventory/${vehicleId}/duplicate`),
    onSuccess: ({ id }) => {
      invalidate();
      router.push(`/dealer/inventory/${id}?duplicated=1`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/vehicles/${vehicleId}`),
    onSuccess: () => {
      setConfirmingDelete(false);
      invalidate();
      onClose();
    },
  });

  const quality = vehicle
    ? listingQuality({ ...vehicle, imageCount: vehicle.images.length })
    : null;
  const status = vehicle?.status;
  const live = status === 'ACTIVE' || status === 'PENDING_REVIEW';
  const toggleable = status === 'ACTIVE' || status === 'PENDING_REVIEW' || status === 'DRAFT';
  const deletable = status !== 'SOLD' && status !== 'IN_AUCTION';
  const others = (similar.data?.items ?? []).filter((car) => car.id !== vehicleId);
  const otherPrices = others.map((car) => car.priceCad).sort((a, b) => a - b);
  const median = otherPrices.length
    ? otherPrices.length % 2
      ? otherPrices[(otherPrices.length - 1) / 2]!
      : Math.round(
          (otherPrices[otherPrices.length / 2 - 1]! + otherPrices[otherPrices.length / 2]!) / 2,
        )
    : null;

  // What the row the panel was opened from needs, in the shape the price dialog takes.
  const priceItem: DealerInventoryItem | undefined =
    item ??
    (vehicle
      ? ({
          id: vehicle.id,
          title: vehicle.title,
          priceCad: vehicle.priceCad,
          previousPriceCad: vehicle.previousPriceCad,
        } as DealerInventoryItem)
      : undefined);

  return (
    <dialog
      ref={dialog}
      aria-label={vehicle ? vehicle.title : 'Vehicle'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="fixed inset-y-0 right-0 m-0 ml-auto h-full max-h-none w-full max-w-3xl border-l border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/50"
    >
      {open ? (
        <div className="flex h-full flex-col">
          {detail.isPending ? (
            <Spinner label="Loading vehicle" className="flex-1" />
          ) : detail.error || !vehicle ? (
            <div className="p-6">
              <ErrorAlert error={detail.error} />
              <Button variant="outline" className="mt-4" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="relative border-b border-border px-5 pb-0 pt-5 sm:px-7">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-4 top-4 z-10 rounded-full bg-card/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur hover:bg-secondary hover:text-foreground sm:bg-transparent sm:shadow-none"
                >
                  <X className="h-6 w-6" aria-hidden />
                </button>
                <div className="flex flex-col gap-5 sm:flex-row">
                  <div className="w-full shrink-0 overflow-hidden rounded-xl border border-border bg-muted sm:w-64">
                    <div className="aspect-[4/3]">
                      {vehicle.primaryImageUrl ? (
                        <OptimizedImage
                          image={vehicle.primaryImage}
                          src={vehicle.primaryImageUrl}
                          alt={vehicle.title}
                          sizes={IMAGE_SIZES.card}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-sm text-muted-foreground">
                          No photo yet
                        </div>
                      )}
                    </div>
                    <dl className="grid grid-cols-3 divide-x divide-border border-t border-border bg-card text-center">
                      <div className="py-2" title="Photos">
                        <dt className="flex justify-center">
                          <ImageIcon
                            className="h-4 w-4 text-muted-foreground"
                            aria-label="Photos"
                          />
                        </dt>
                        <dd className="text-sm font-semibold">{vehicle.images.length}</dd>
                      </div>
                      <div className="py-2" title="Documents">
                        <dt className="flex justify-center">
                          <FileText
                            className="h-4 w-4 text-muted-foreground"
                            aria-label="Documents"
                          />
                        </dt>
                        <dd className="text-sm font-semibold">{vehicle.documentCount}</dd>
                      </div>
                      <div className="py-2" title="Views">
                        <dt className="flex justify-center">
                          <Eye className="h-4 w-4 text-muted-foreground" aria-label="Views" />
                        </dt>
                        <dd className="text-sm font-semibold">{vehicle.viewCount}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="min-w-0 flex-1 pr-8">
                    <h2 className="text-xl font-bold tracking-tight">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </h2>
                    <p className="text-sm text-muted-foreground">{vehicle.trim ?? ' '}</p>
                    <Badge variant={STATUS_VARIANT[vehicle.status]} className="mt-2">
                      {formatEnum(vehicle.status)}
                    </Badge>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                      <Detail label="Stock number" value={vehicle.stockNumber} />
                      <Detail
                        label="VIN"
                        value={<span className="font-mono text-xs">{vehicle.vin}</span>}
                      />
                      <Detail label="Condition" value={formatEnum(vehicle.condition)} />
                      <Detail label="Mileage" value={formatKm(vehicle.mileageKm)} />
                      <Detail label="Transmission" value={formatEnum(vehicle.transmission)} />
                      <Detail label="Model year" value={vehicle.year} />
                    </dl>
                  </div>
                </div>

                <div
                  role="tablist"
                  aria-label="Vehicle views"
                  className="mt-5 flex gap-6 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {(
                    [
                      ['standard', 'Standard view'],
                      ['performance', 'Performance'],
                      ['competitors', 'Competitor analysis'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => setTab(value)}
                      className={cn(
                        'whitespace-nowrap border-b-2 pb-3 text-sm font-medium',
                        tab === value
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto">
                {tab === 'standard' ? (
                  <div className="divide-y divide-border">
                    <section className="grid gap-4 px-5 py-6 sm:grid-cols-[12rem_1fr] sm:px-7">
                      <h3 className="text-lg font-semibold">Price</h3>
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Asking price</p>
                          <button
                            type="button"
                            onClick={() => setEditingPrice(true)}
                            disabled={status === 'SOLD' || status === 'IN_AUCTION'}
                            className="group inline-flex items-center gap-1.5 text-xl font-bold text-primary disabled:text-foreground"
                          >
                            {formatPrice(vehicle.priceCad)}
                            <Pencil
                              className="h-4 w-4 opacity-70 group-hover:opacity-100 group-disabled:hidden"
                              aria-hidden
                            />
                            <span className="sr-only">Edit price</span>
                          </button>
                          {vehicle.previousPriceCad ? (
                            <p className="text-xs text-muted-foreground">
                              Was <s>{formatPrice(vehicle.previousPriceCad)}</s>
                            </p>
                          ) : null}
                        </div>
                        {vehicle.referencePrices ? (
                          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {(
                              [
                                ['Sale', vehicle.referencePrices.salePriceCad],
                                ['MSRP', vehicle.referencePrices.msrpCad],
                                ['Invoice', vehicle.referencePrices.invoicePriceCad],
                                ['Retail', vehicle.referencePrices.retailPriceCad],
                                ['Wholesale', vehicle.referencePrices.wholesalePriceCad],
                              ] as const
                            )
                              .filter(([, value]) => value !== null)
                              .map(([label, value]) => (
                                <Detail key={label} label={label} value={formatPrice(value!)} />
                              ))}
                          </dl>
                        ) : null}
                      </div>
                    </section>

                    {quality ? (
                      <section className="grid gap-4 px-5 py-6 sm:grid-cols-[12rem_1fr] sm:px-7">
                        <div>
                          <h3 className="text-lg font-semibold">Listing quality</h3>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Your listing quality score is:
                          </p>
                          <QualityPill score={quality.score} className="mt-2" />
                          <button
                            type="button"
                            onClick={() => setExplainQuality((current) => !current)}
                            className="mt-3 block text-sm font-semibold text-primary hover:underline"
                            aria-expanded={explainQuality}
                          >
                            How is this calculated?
                          </button>
                        </div>
                        <div className="flex flex-col gap-4">
                          {quality.tips.map((tip) => {
                            const Icon = QUALITY_ICON[tip.area];
                            return (
                              <div key={tip.area} className="flex gap-3">
                                <span
                                  className={cn(
                                    'grid h-7 w-7 shrink-0 place-items-center rounded-full',
                                    tip.done
                                      ? 'bg-success/10 text-success'
                                      : 'bg-secondary text-muted-foreground',
                                  )}
                                >
                                  <Icon className="h-4 w-4" aria-hidden />
                                </span>
                                <div>
                                  <p className="text-sm font-semibold">{QUALITY_LABEL[tip.area]}</p>
                                  <p className="text-sm text-muted-foreground">{tip.message}</p>
                                </div>
                              </div>
                            );
                          })}
                          {explainQuality ? (
                            <p className="rounded-md bg-secondary/60 p-3 text-xs text-muted-foreground">
                              Out of 100: photos 40 (full marks at 10 photos), description 20 (full
                              marks at 300 characters) and vehicle data 40 — VIN, trim, both
                              colours, doors, seats, engine or power, owners, damage, and at least
                              five pieces of equipment.
                            </p>
                          ) : null}
                        </div>
                      </section>
                    ) : null}

                    <section className="grid grid-cols-1 gap-1 px-3 py-4 sm:grid-cols-2 sm:px-5">
                      {simple ? null : (
                        <>
                          <Link
                            href={`/dealer/inventory/${vehicle.id}/sticker`}
                            target="_blank"
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold hover:bg-secondary"
                          >
                            <Printer className="h-4 w-4" aria-hidden />
                            Print window sticker
                          </Link>
                          <button
                            type="button"
                            onClick={() => duplicate.mutate()}
                            disabled={duplicate.isPending}
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold hover:bg-secondary disabled:opacity-50"
                          >
                            <Copy className="h-4 w-4" aria-hidden />
                            {duplicate.isPending ? 'Copying…' : 'Use as template'}
                          </button>
                          <Link
                            href={`/dealer/costs/${vehicle.id}`}
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold hover:bg-secondary"
                          >
                            <Calculator className="h-4 w-4" aria-hidden />
                            Costs and margin
                          </Link>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(true)}
                        disabled={!deletable}
                        title={
                          deletable
                            ? undefined
                            : 'A vehicle in an auction or marked sold cannot be deleted'
                        }
                        className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Delete
                      </button>
                    </section>
                    <ErrorAlert error={duplicate.error} className="mx-5 mb-4" />
                  </div>
                ) : tab === 'performance' ? (
                  <div className="grid gap-4 px-5 py-6 sm:grid-cols-2 sm:px-7">
                    {(
                      [
                        [
                          Eye,
                          'Views',
                          vehicle.viewCount.toLocaleString('en-CA'),
                          'Buyers who opened the listing.',
                        ],
                        [
                          Heart,
                          'Saved by buyers',
                          vehicle.favouriteCount.toLocaleString('en-CA'),
                          'Shoppers who saved it to their favourites.',
                        ],
                        [
                          Info,
                          'Days in inventory',
                          String(daysSince(item?.createdAt ?? vehicle.createdAt) ?? '—'),
                          `Added ${shortDate(item?.createdAt ?? vehicle.createdAt)}.`,
                        ],
                        [
                          ListChecks,
                          'Days live',
                          vehicle.publishedAt ? String(daysSince(vehicle.publishedAt)) : '—',
                          vehicle.publishedAt
                            ? `Published ${shortDate(vehicle.publishedAt)}.`
                            : 'Not published yet.',
                        ],
                      ] as const
                    ).map(([Icon, label, value, note]) => (
                      <div key={label} className="rounded-xl border border-border p-4">
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Icon className="h-4 w-4" aria-hidden />
                          {label}
                        </p>
                        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-6 sm:px-7">
                    <h3 className="text-lg font-semibold">
                      Similar {vehicle.make} {vehicle.model} on Vintrax
                    </h3>
                    {similar.isPending ? (
                      <Spinner label="Finding similar cars" />
                    ) : similar.error ? (
                      <ErrorAlert error={similar.error} className="mt-3" />
                    ) : others.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No other {vehicle.make} {vehicle.model} within three model years is for sale
                        on Vintrax right now.
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {others.length} for sale from {similar.data!.yearsCompared.from}–
                          {similar.data!.yearsCompared.to}, closest match first.
                        </p>
                        <dl className="mt-4 grid grid-cols-3 gap-3">
                          <div className="rounded-xl border border-border p-3">
                            <dt className="text-xs text-muted-foreground">Lowest</dt>
                            <dd className="font-bold tabular-nums">
                              {formatPrice(otherPrices[0]!)}
                            </dd>
                          </div>
                          <div className="rounded-xl border border-border p-3">
                            <dt className="text-xs text-muted-foreground">Median</dt>
                            <dd className="font-bold tabular-nums">{formatPrice(median!)}</dd>
                          </div>
                          <div className="rounded-xl border border-border p-3">
                            <dt className="text-xs text-muted-foreground">Highest</dt>
                            <dd className="font-bold tabular-nums">
                              {formatPrice(otherPrices[otherPrices.length - 1]!)}
                            </dd>
                          </div>
                        </dl>
                        {median !== null ? (
                          <p
                            className={cn(
                              'mt-3 rounded-md px-3 py-2 text-sm font-medium',
                              vehicle.priceCad <= median
                                ? 'bg-success/10 text-success'
                                : 'bg-warning/10 text-warning',
                            )}
                          >
                            Your price is{' '}
                            {vehicle.priceCad === median
                              ? 'exactly the median'
                              : `${formatPrice(Math.abs(vehicle.priceCad - median))} ${
                                  vehicle.priceCad < median ? 'below' : 'above'
                                } the median`}
                            .
                          </p>
                        ) : null}
                        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
                          {others.slice(0, 8).map((car) => (
                            <li key={car.id}>
                              <Link
                                href={`/vehicles/${car.slug}`}
                                target="_blank"
                                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-secondary/60"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">{car.title}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {formatKm(car.mileageKm)} · {car.city}
                                  </span>
                                </span>
                                <span className="shrink-0 font-semibold tabular-nums">
                                  {formatPrice(car.priceCad)}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-7">
                <label
                  className={cn(
                    'flex items-center gap-3 text-sm font-medium',
                    !toggleable && 'opacity-60',
                  )}
                  title={
                    toggleable
                      ? undefined
                      : status === 'IN_AUCTION'
                        ? 'In a running auction'
                        : 'Restore it to a draft first'
                  }
                >
                  {status === 'PENDING_REVIEW' ? 'In review' : 'Active'}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={live}
                    aria-label={live ? 'Take the listing offline' : 'Publish the listing'}
                    disabled={!toggleable || changeStatus.isPending}
                    onClick={() => changeStatus.mutate(live ? 'DRAFT' : 'PENDING_REVIEW')}
                    className={cn(
                      'relative h-7 w-12 rounded-full transition-colors disabled:cursor-not-allowed',
                      live ? 'bg-primary' : 'bg-input',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all',
                        live ? 'left-6' : 'left-1',
                      )}
                    />
                  </button>
                </label>
                <div className="flex gap-2">
                  <Link href={`/vehicles/${vehicle.slug}`} target="_blank">
                    <Button variant="outline" className="rounded-full px-5">
                      View listing
                    </Button>
                  </Link>
                  <Link href={`/dealer/inventory/${vehicle.id}`}>
                    <Button className="rounded-full px-6">Edit</Button>
                  </Link>
                </div>
                <ErrorAlert error={changeStatus.error} className="w-full" />
              </div>
            </>
          )}
        </div>
      ) : null}

      {priceItem ? (
        <PriceDialog
          vehicle={priceItem}
          open={editingPrice}
          onClose={() => setEditingPrice(false)}
          onSaved={refresh}
        />
      ) : null}
      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this vehicle?"
        size="sm"
        description={
          vehicle ? `${vehicle.title}${vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}` : undefined
        }
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
    </dialog>
  );
}
