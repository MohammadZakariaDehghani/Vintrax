'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gavel, Heart, ShieldCheck } from 'lucide-react';
import type { VehicleSummary } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatEnum, formatKm, formatLocation, formatPrice, joinSpecs } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Badge, Skeleton } from '@/components/ui';
import { CarfaxBadge } from '@/components/carfax-badge';
import { AuctionCountdown } from '@/components/auction-countdown';

const STATUS_VARIANT = {
  DRAFT: 'outline',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  IN_AUCTION: 'accent',
  SOLD: 'default',
  ARCHIVED: 'outline',
} as const;

export function VehicleCard({
  vehicle,
  showStatus = false,
}: {
  vehicle: VehicleSummary;
  showStatus?: boolean;
}) {
  const user = useUser();
  const queryClient = useQueryClient();

  const toggleFavourite = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await api.put(`/vehicles/${vehicle.id}/favourite`);
      else await api.delete(`/vehicles/${vehicle.id}/favourite`);
    },
    onSuccess: () => {
      // Refresh anything showing favourite state.
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['favourites'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
    },
  });

  const auction = vehicle.activeAuction;
  const href = auction ? `/auctions/${auction.id}` : `/vehicles/${vehicle.slug}`;

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <Link href={href} tabIndex={-1} aria-hidden="true">
          {vehicle.primaryImageUrl ? (
            // Placeholder images are SVG and served from the same origin, so
            // next/image optimisation adds cost without benefit here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={vehicle.primaryImageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              No photo
            </div>
          )}
        </Link>

        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
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
          {/* Compact here: the card is already carrying up to two badges. The
              badge draws itself, including nothing at all when there is no
              report, so there is no condition to keep in step with it. */}
          <CarfaxBadge vehicle={vehicle} compact className="shadow-sm" />
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
            className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-background/90 shadow-sm transition-transform hover:scale-110"
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
          </button>
        ) : null}

        {vehicle.imageCount > 1 ? (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
            {vehicle.imageCount} photos
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link href={href} className="hover:text-primary">
          <h3 className="line-clamp-2 font-semibold leading-snug">{vehicle.title}</h3>
        </Link>

        {auction ? (
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Current bid</p>
              <p className="tabular text-xl font-bold text-primary">
                {formatPrice(auction.currentBidCad)}
              </p>
            </div>
            <AuctionCountdown
              endsAt={auction.endsAt}
              initialSeconds={auction.secondsRemaining}
              compact
            />
          </div>
        ) : (
          <p className="tabular text-xl font-bold text-primary">{formatPrice(vehicle.priceCad)}</p>
        )}

        <p className="text-sm text-muted-foreground">
          {joinSpecs(
            formatKm(vehicle.mileageKm),
            formatEnum(vehicle.transmission),
            formatEnum(vehicle.fuelType),
          )}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>{formatLocation(vehicle.city, vehicle.province)}</span>
          {showStatus ? (
            <Badge variant={STATUS_VARIANT[vehicle.status]}>{formatEnum(vehicle.status)}</Badge>
          ) : (
            <span>{formatEnum(vehicle.condition)}</span>
          )}
        </div>
      </div>
    </article>
  );
}

export function VehicleCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
