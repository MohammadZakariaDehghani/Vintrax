'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SellerSettableListingStatus, VehicleSummary } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { Badge, Button, Card, CardContent, ErrorAlert, Input } from '@/components/ui';
import { IMAGE_SIZES, OptimizedImage } from '@/components/optimized-image';
import { PreviousPrice } from '@/components/previous-price';

export const STATUS_VARIANT = {
  DRAFT: 'outline',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  IN_AUCTION: 'accent',
  SOLD: 'default',
  ARCHIVED: 'outline',
} as const;

/** Shared by the row and the card, so the two views cannot drift apart. */
interface ItemProps {
  vehicle: VehicleSummary;
  selected: boolean;
  onSelect: (id: string, selected: boolean) => void;
}

/**
 * The per-vehicle actions.
 *
 * Kept as one component used by both views. A grid card and a list row are two
 * arrangements of the same vehicle, and the moment each grows its own copy of
 * "which buttons does a SOLD listing get" they start disagreeing.
 */
function useVehicleActions(vehicle: VehicleSummary) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };

  // Status has its own endpoint, and a seller cannot reach ACTIVE through it —
  // publishing is a moderation decision, so "Submit for review" is as far as
  // this page goes. PATCH /vehicles/:id no longer accepts the field at all.
  const changeStatus = useMutation({
    mutationFn: (status: SellerSettableListingStatus) =>
      api.patch(`/vehicles/${vehicle.id}/status`, { status }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/vehicles/${vehicle.id}`),
    onSuccess: invalidate,
  });

  return { changeStatus, remove, confirming, setConfirming, invalidate };
}

/**
 * Changing the asking price without opening the full edit form. The price it
 * replaces is kept and shown struck through above the new one, here and on
 * the public listing.
 *
 * Not offered in a live auction, where the API refuses a price change so the
 * terms do not move under the bidders, nor on a sold vehicle.
 */
function QuickPriceEdit({
  vehicle,
  onDone,
  onSaved,
}: {
  vehicle: VehicleSummary;
  onDone: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(String(vehicle.priceCad));
  const price = Number(text.replace(/[^\d]/g, ''));
  const valid = Number.isInteger(price) && price >= 1;

  const save = useMutation({
    mutationFn: () => api.patch(`/vehicles/${vehicle.id}`, { priceCad: price }),
    onSuccess: () => {
      onSaved();
      onDone();
    },
  });

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || price === vehicle.priceCad) {
          onDone();
          return;
        }
        save.mutate();
      }}
    >
      <label className="sr-only" htmlFor={`price-${vehicle.id}`}>
        New price for {vehicle.title}
      </label>
      <span className="text-sm text-muted-foreground">$</span>
      <Input
        id={`price-${vehicle.id}`}
        inputMode="numeric"
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="h-9 w-32"
        aria-invalid={!valid}
      />
      <Button type="submit" size="sm" loading={save.isPending} disabled={!valid}>
        Save price
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        Cancel
      </Button>
      <ErrorAlert error={save.error} className="w-full" />
    </form>
  );
}

/** The price line: the previous price struck through, when there is one, above the current one. */
function PriceLine({ vehicle }: { vehicle: VehicleSummary }) {
  return (
    <div className="mt-1">
      <PreviousPrice previous={vehicle.previousPriceCad} current={vehicle.priceCad} />
      <p className="text-sm text-muted-foreground">
        <span className="tabular font-semibold text-foreground">
          {formatPrice(vehicle.priceCad)}
        </span>{' '}
        · {formatKm(vehicle.mileageKm)}
      </p>
    </div>
  );
}

function VehicleActions({ vehicle }: { vehicle: VehicleSummary }) {
  const { changeStatus, remove, confirming, setConfirming, invalidate } =
    useVehicleActions(vehicle);
  const [editingPrice, setEditingPrice] = useState(false);
  const priceEditable = vehicle.status !== 'IN_AUCTION' && vehicle.status !== 'SOLD';

  return (
    <>
      <ErrorAlert error={changeStatus.error ?? remove.error} className="mt-2" />

      {editingPrice ? (
        <QuickPriceEdit
          vehicle={vehicle}
          onDone={() => setEditingPrice(false)}
          onSaved={invalidate}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/dealer/inventory/${vehicle.id}`}>
          <Button variant="outline" size="sm">
            Edit
          </Button>
        </Link>
        {priceEditable && !editingPrice ? (
          <Button variant="outline" size="sm" onClick={() => setEditingPrice(true)}>
            Edit price
          </Button>
        ) : null}

        {vehicle.status === 'DRAFT' ? (
          <Button
            size="sm"
            loading={changeStatus.isPending}
            onClick={() => changeStatus.mutate('PENDING_REVIEW')}
          >
            Submit for review
          </Button>
        ) : null}

        {vehicle.status === 'PENDING_REVIEW' ? (
          <>
            <span className="self-center text-sm text-muted-foreground">Awaiting moderation</span>
            <Button
              variant="ghost"
              size="sm"
              loading={changeStatus.isPending}
              onClick={() => changeStatus.mutate('DRAFT')}
            >
              Withdraw
            </Button>
          </>
        ) : null}

        {vehicle.status === 'ACTIVE' ? (
          <>
            <Link href={`/auctions/new?vehicleId=${vehicle.id}`}>
              <Button variant="accent" size="sm">
                Run auction
              </Button>
            </Link>
            {/* Cars get sold off the platform. Marking it sold here takes it
                off the market without pretending the sale went through
                Vintrax. */}
            <Button
              variant="outline"
              size="sm"
              loading={changeStatus.isPending}
              onClick={() => changeStatus.mutate('SOLD')}
            >
              Mark as sold
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={changeStatus.isPending}
              onClick={() => changeStatus.mutate('DRAFT')}
            >
              Unpublish
            </Button>
          </>
        ) : null}

        {vehicle.status === 'ARCHIVED' ? (
          <Button
            variant="outline"
            size="sm"
            loading={changeStatus.isPending}
            onClick={() => changeStatus.mutate('DRAFT')}
          >
            Restore to draft
          </Button>
        ) : null}

        {vehicle.status === 'SOLD' ? (
          // Refused by the API when a real order exists, which is the case that
          // must not be undone by relabelling.
          <Button
            variant="ghost"
            size="sm"
            loading={changeStatus.isPending}
            onClick={() => changeStatus.mutate('DRAFT')}
          >
            Reopen as draft
          </Button>
        ) : null}

        {confirming ? (
          <>
            <span className="self-center text-sm">Delete permanently?</span>
            <Button
              variant="destructive"
              size="sm"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Yes, delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>
    </>
  );
}

/** The checkbox that puts a vehicle into a bulk action. */
function SelectBox({ vehicle, selected, onSelect }: ItemProps) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0 accent-primary"
      checked={selected}
      onChange={(event) => onSelect(vehicle.id, event.target.checked)}
      aria-label={`Select ${vehicle.title}`}
    />
  );
}

export function InventoryRow({ vehicle, selected, onSelect }: ItemProps) {
  return (
    <Card className={selected ? 'border-primary' : undefined}>
      <CardContent className="flex flex-wrap items-start gap-4 pt-5">
        <div className="pt-1">
          <SelectBox vehicle={vehicle} selected={selected} onSelect={onSelect} />
        </div>

        <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
          {vehicle.primaryImageUrl ? (
            <OptimizedImage
              image={vehicle.primaryImage}
              src={vehicle.primaryImageUrl}
              alt=""
              sizes={IMAGE_SIZES.thumb}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/vehicles/${vehicle.slug}`} className="font-semibold hover:text-primary">
              {vehicle.title}
            </Link>
            <Badge variant={STATUS_VARIANT[vehicle.status]}>{formatEnum(vehicle.status)}</Badge>
          </div>
          <PriceLine vehicle={vehicle} />

          <VehicleActions vehicle={vehicle} />
        </div>
      </CardContent>
    </Card>
  );
}

export function InventoryCard({ vehicle, selected, onSelect }: ItemProps) {
  return (
    <Card className={`flex flex-col ${selected ? 'border-primary' : ''}`}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-lg bg-muted">
        {vehicle.primaryImageUrl ? (
          <OptimizedImage
            image={vehicle.primaryImage}
            src={vehicle.primaryImageUrl}
            alt=""
            sizes={IMAGE_SIZES.card}
            className="h-full w-full object-cover"
          />
        ) : null}
        {/* On its own plate, because the checkbox sits over a photograph that
            may be any colour at all. */}
        <div className="absolute left-2 top-2 rounded-md bg-background/90 p-1.5 shadow-sm">
          <SelectBox vehicle={vehicle} selected={selected} onSelect={onSelect} />
        </div>
        <div className="absolute right-2 top-2">
          <Badge variant={STATUS_VARIANT[vehicle.status]}>{formatEnum(vehicle.status)}</Badge>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col pt-4">
        <Link
          href={`/vehicles/${vehicle.slug}`}
          className="font-semibold leading-snug hover:text-primary"
        >
          {vehicle.title}
        </Link>
        <PriceLine vehicle={vehicle} />

        <div className="mt-auto">
          <VehicleActions vehicle={vehicle} />
        </div>
      </CardContent>
    </Card>
  );
}
