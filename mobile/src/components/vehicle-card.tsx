'use client';

import Link from 'next/link';
import { Camera, Heart, ShieldCheck } from 'lucide-react';
import type { VehicleSummary } from '@vintrax/shared';
import { cn, formatKm, formatPrice, joinSpecs } from '@/lib/format';
import { useToggleFavourite } from '@/lib/queries';
import { useUser } from '@/store/session';
import { Badge } from '@/components/ui';
import { OptimizedImage } from '@/components/optimized-image';

/**
 * One listing in a scrolling list.
 *
 * The whole card is the tap target for the listing, with the favourite button
 * as the single nested action — anything more and thumbs start hitting the
 * wrong thing on a moving list.
 */
export function VehicleCard({ vehicle }: { vehicle: VehicleSummary }) {
  const user = useUser();
  const toggleFavourite = useToggleFavourite();

  const auction = vehicle.activeAuction;
  const price = auction ? auction.currentBidCad : vehicle.priceCad;

  return (
    <article className="relative overflow-hidden rounded-xl border border-border bg-card">
      <Link href={`/vehicles/${vehicle.slug}`} className="block active:opacity-90">
        <div className="relative aspect-[4/3] bg-muted">
          {vehicle.primaryImageUrl ? (
            <OptimizedImage
              image={vehicle.primaryImage}
              src={vehicle.primaryImageUrl}
              alt={vehicle.title}
              // Cards are one per row below 480px and two above, which is what
              // stops a phone downloading a desktop-sized image.
              sizes="(max-width: 480px) 100vw, 320px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Camera aria-hidden className="h-8 w-8" />
              <span className="sr-only">No photo</span>
            </div>
          )}

          {auction ? (
            <Badge tone="warning" className="absolute left-2 top-2">
              Live auction
            </Badge>
          ) : null}

          {vehicle.imageCount > 1 ? (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
              {vehicle.imageCount} photos
            </span>
          ) : null}
        </div>

        <div className="space-y-1 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-lg font-semibold tabular-nums">{formatPrice(price)}</p>
            {vehicle.hasInspection ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
                {vehicle.inspectionGrade ?? 'Inspected'}
              </span>
            ) : null}
          </div>
          <h3 className="truncate text-sm font-medium">{vehicle.title}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {joinSpecs(formatKm(vehicle.mileageKm), `${vehicle.city}, ${vehicle.province}`)}
          </p>
        </div>
      </Link>

      {user ? (
        <button
          type="button"
          onClick={() =>
            toggleFavourite.mutate({ vehicleId: vehicle.id, favourited: vehicle.isFavourited })
          }
          disabled={toggleFavourite.isPending}
          aria-pressed={vehicle.isFavourited}
          aria-label={vehicle.isFavourited ? 'Remove from saved' : 'Save this vehicle'}
          className="absolute right-2 top-2 inline-flex min-h-touch min-w-touch items-center justify-center rounded-full bg-black/50 text-white active:bg-black/70"
        >
          <Heart
            aria-hidden
            className={cn('h-5 w-5', vehicle.isFavourited && 'fill-current text-destructive')}
          />
        </button>
      ) : null}
    </article>
  );
}

export function VehicleCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="aspect-[4/3] animate-pulse bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
