'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { VehicleDetail } from '@vintrax/shared';
import { formatPrice } from '@/lib/utils';
import { useCompareStore } from '@/store/compare-store';
import { Button } from '@/components/ui';
import { VehicleBadgeStrip } from '@/components/vehicle-badge-strip';

/** One vehicle's column header on `/compare`: photo, the fields a shopper reads first, and its two actions. */
export function CompareVehicleCard({ vehicle }: { vehicle: VehicleDetail }) {
  const remove = useCompareStore((state) => state.remove);
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="relative">
        <button
          type="button"
          aria-label={`Remove ${name} from comparison`}
          onClick={() => remove(vehicle.id)}
          className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <div className="aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
          {vehicle.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vehicle.primaryImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
              No photo
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="font-semibold leading-tight">{name}</p>
        <p className="mt-1 text-lg font-bold text-primary">{formatPrice(vehicle.priceCad)}</p>
        {vehicle.stockNumber ? (
          <p className="mt-0.5 text-xs text-muted-foreground">Stock # {vehicle.stockNumber}</p>
        ) : null}
        <VehicleBadgeStrip vehicle={vehicle} compact className="mt-1.5" />
      </div>

      <Link href={`/vehicles/${vehicle.slug}`}>
        <Button variant="outline" size="sm" className="w-full">
          View Details
        </Button>
      </Link>
    </div>
  );
}
