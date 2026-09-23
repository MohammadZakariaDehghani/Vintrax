'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useDealerAnalytics, useMyVehicles } from '@/lib/queries';
import { useIsSeller } from '@/store/session';
import { formatCompact, formatEnum, formatPrice } from '@/lib/format';
import { Badge, Button, Card, Skeleton, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState } from '@/components/error-state';
import { OptimizedImage } from '@/components/optimized-image';

export default function InventoryPage() {
  return (
    <>
      <AppBar
        title="My inventory"
        back
        action={
          <Link
            href="/dealer/inventory/new"
            aria-label="Add a vehicle"
            className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-primary active:bg-secondary"
          >
            <Plus aria-hidden className="h-6 w-6" />
          </Link>
        }
      />
      <RequireAuth permission="vehicle:write">
        <Inventory />
      </RequireAuth>
    </>
  );
}

function Inventory() {
  const isSeller = useIsSeller();
  const vehicles = useMyVehicles({ pageSize: 50 });
  // Only dealers have a dealership record behind this, so a private seller
  // must not be sent to an endpoint that will refuse them.
  const analytics = useDealerAnalytics(isSeller);

  const items = vehicles.data?.items ?? [];

  return (
    <div className="space-y-4 p-3">
      {analytics.data ? (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Active" value={formatCompact(analytics.data.activeListings)} />
          <Stat label="Views" value={formatCompact(analytics.data.totalViews)} />
          <Stat label="Sold this month" value={formatCompact(analytics.data.soldThisMonth)} />
        </div>
      ) : null}

      {vehicles.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : vehicles.isError ? (
        <ErrorState error={vehicles.error} onRetry={() => void vehicles.refetch()} />
      ) : items.length === 0 ? (
        <StateMessage
          title="No vehicles yet"
          description="Add your first listing — you can photograph it with the phone's camera."
          action={
            <Link href="/dealer/inventory/new">
              <Button size="large">Add a vehicle</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((vehicle) => (
            <li key={vehicle.id}>
              <Link href={`/vehicles/${vehicle.slug}`} className="block active:opacity-90">
                <Card className="flex gap-3 p-2.5">
                  <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {vehicle.primaryImageUrl ? (
                      <OptimizedImage
                        image={vehicle.primaryImage}
                        src={vehicle.primaryImageUrl}
                        alt=""
                        sizes="80px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{vehicle.title}</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatPrice(vehicle.priceCad)}
                    </p>
                    <Badge tone={vehicle.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {formatEnum(vehicle.status)}
                    </Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3 text-center">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}
