'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Gavel, Heart, MapPin, ShieldCheck } from 'lucide-react';
import type { VehicleSummary } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  PAYMENT_ESTIMATE,
  cn,
  estimateMonthlyPayment,
  formatEnum,
  formatKm,
  formatLocation,
  formatPrice,
} from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Badge, Skeleton } from '@/components/ui';
import { VehicleBadgeStrip } from '@/components/vehicle-badge-strip';
import { AuctionCountdown } from '@/components/auction-countdown';
import { CompareButton } from '@/components/compare-button';

/**
 * A search result, laid out as a row rather than a card.
 *
 * The grid of cards this replaces showed three vehicles per screen and made
 * comparing them a matter of memory. Marketplaces converge on a horizontal row
 * — photo, then everything that decides a shortlist, then price — because it
 * fits eight or nine to a screen and puts the same fields at the same
 * horizontal position on every one, so the eye can run down a column.
 */
export function VehicleRow({ vehicle }: { vehicle: VehicleSummary }) {
  const user = useUser();
  const queryClient = useQueryClient();

  const toggleFavourite = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await api.put(`/vehicles/${vehicle.id}/favourite`);
      else await api.delete(`/vehicles/${vehicle.id}/favourite`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['favourites'] });
    },
  });

  const auction = vehicle.activeAuction;
  const href = auction ? `/auctions/${auction.id}` : `/vehicles/${vehicle.slug}`;
  const price = auction ? auction.currentBidCad : vehicle.priceCad;
  const monthly = estimateMonthlyPayment(price);

  return (
    <article className="group relative flex flex-col gap-4 border-b border-border bg-card p-3.5 transition-colors last:border-b-0 hover:bg-secondary/40 sm:flex-row">
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-md bg-muted sm:aspect-auto sm:h-[132px] sm:w-[196px]">
        {vehicle.primaryImageUrl ? (
          // Placeholder images are SVG from the same origin, so next/image
          // optimisation adds cost without benefit.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vehicle.primaryImageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No photo
          </div>
        )}

        {/* `z-10` so anything clickable in here sits above the stretched link's
            `::after`, which covers the whole row. Without it the CARFAX badge
            is painted under the overlay and every click on it opens the listing
            instead of the report — the same reason the save button below is
            `relative z-10`. */}
        <div className="absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
          {auction ? (
            <Badge variant="accent" className="shadow-sm">
              <Gavel className="h-3 w-3" aria-hidden />
              Auction
            </Badge>
          ) : null}
          {vehicle.hasInspection ? (
            <Badge variant="success" className="shadow-sm">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Inspected
            </Badge>
          ) : null}
          <CompareButton compact vehicleId={vehicle.id} />
        </div>

        {vehicle.imageCount > 1 ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
            <Camera className="h-3 w-3" aria-hidden />
            {vehicle.imageCount}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="pr-10 text-base font-semibold leading-snug">
          {/* Stretched so the whole row is the target, while the price, the
              save button and any nested link stay individually clickable. */}
          <Link href={href} className="after:absolute after:inset-0 hover:text-primary">
            {vehicle.title}
          </Link>
        </h3>

        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <dt className="sr-only">Mileage</dt>
            <dd>{formatKm(vehicle.mileageKm)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Transmission</dt>
            <dd>{formatEnum(vehicle.transmission)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Fuel</dt>
            <dd>{formatEnum(vehicle.fuelType)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Drivetrain</dt>
            <dd>{formatEnum(vehicle.drivetrain)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Condition</dt>
            <dd>{formatEnum(vehicle.condition)}</dd>
          </div>
        </dl>

        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {formatLocation(vehicle.city, vehicle.province)}
        </p>

        {auction ? (
          <p className="mt-auto pt-1">
            <AuctionCountdown
              endsAt={auction.endsAt}
              initialSeconds={auction.secondsRemaining}
              compact
            />
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-row items-end justify-between gap-2 sm:w-44 sm:flex-col sm:items-end sm:justify-start">
        <div className="text-left sm:text-right">
          {auction ? (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current bid</p>
          ) : null}
          <p className="tabular text-2xl font-bold leading-tight text-primary">
            {formatPrice(price)}
          </p>
          {monthly > 0 ? (
            <p className="tabular mt-0.5 text-sm text-muted-foreground">
              est. {formatPrice(monthly)}/mo
            </p>
          ) : null}
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            {PAYMENT_ESTIMATE.termMonths} mo at {PAYMENT_ESTIMATE.aprPercent}%, taxes and fees extra
          </p>
        </div>

        {user ? (
          <button
            type="button"
            aria-pressed={vehicle.isFavourited}
            aria-label={
              vehicle.isFavourited
                ? `Remove ${vehicle.title} from saved vehicles`
                : `Save ${vehicle.title}`
            }
            disabled={toggleFavourite.isPending}
            onClick={() => toggleFavourite.mutate(!vehicle.isFavourited)}
            // Above the stretched link, or the row would swallow the click.
            className="relative z-10 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-background sm:mt-2"
          >
            <Heart
              className={cn(
                'h-4 w-4',
                vehicle.isFavourited
                  ? 'fill-destructive text-destructive'
                  : 'text-muted-foreground',
              )}
              aria-hidden
            />
            {vehicle.isFavourited ? 'Saved' : 'Save'}
          </button>
        ) : null}

        {/* After the save button, off the photograph.
            `relative z-10` for the reason the save button has it: the row's
            title carries a stretched link covering the whole row, and without
            a stacking context above it every click on the badge would open the
            listing instead of the report. */}
        <VehicleBadgeStrip vehicle={vehicle} compact className="relative z-10 sm:mt-2" />
      </div>
    </article>
  );
}

export function VehicleRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 border-b border-border p-3.5 last:border-b-0 sm:flex-row">
      <Skeleton className="aspect-[4/3] w-full sm:aspect-auto sm:h-[132px] sm:w-[196px]" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/5" />
      </div>
      <div className="sm:w-44">
        <Skeleton className="h-7 w-28" />
      </div>
    </div>
  );
}
