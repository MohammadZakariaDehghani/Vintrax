'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Check, GitCompare } from 'lucide-react';
import { hydrateCompareStore, useCompareIds, useCompareStore } from '@/store/compare-store';
import { useCompareVehicles } from '@/lib/use-compare-vehicles';
import { buildFeatureCategoryMatrix } from '@/lib/compare-feature-matrix';
import { CompareVehicleCard } from '@/components/compare-vehicle-card';
import { CompareTable } from '@/components/compare-table';
import { CompareFeatureGroup } from '@/components/compare-feature-group';
import { Button, EmptyState, Spinner } from '@/components/ui';

/**
 * The comparison list is the only source of truth this page reads — there is
 * no `?ids=` in the URL. The list already survives navigation and a refresh
 * on its own (`useCompareStore`, backed by `localStorage`), and the feature
 * as asked for never needed a shareable link; adding one would mean keeping
 * two representations of the same selection in sync for a use case nobody
 * asked for.
 */
export default function ComparePage() {
  const ids = useCompareIds();
  const clear = useCompareStore((state) => state.clear);
  const { vehicles, isLoading, failedIds } = useCompareVehicles(ids);

  useEffect(() => {
    hydrateCompareStore();
  }, []);

  const featureGroups = vehicles.length >= 2 ? buildFeatureCategoryMatrix(vehicles) : [];

  return (
    <div className="container py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Compare Vehicles</h1>
        {ids.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear All
          </Button>
        ) : null}
      </div>

      {ids.length === 0 ? (
        <EmptyState
          icon={<GitCompare className="h-10 w-10" aria-hidden />}
          title="You haven't added any vehicles to compare yet"
          description="Browse our inventory and add vehicles to compare their prices, specifications, and features."
          action={
            <Link href="/vehicles">
              <Button>Browse Inventory</Button>
            </Link>
          }
        />
      ) : isLoading ? (
        <Spinner label="Loading vehicles" />
      ) : (
        <div className="flex flex-col gap-8">
          {failedIds.length > 0 ? (
            <div
              role="status"
              className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
            >
              {failedIds.length === 1
                ? 'One vehicle in your comparison could no longer be loaded and was left out.'
                : `${failedIds.length} vehicles in your comparison could no longer be loaded and were left out.`}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {vehicles.map((vehicle) => (
              <CompareVehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>

          {vehicles.length === 1 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Add another vehicle to compare.{' '}
              <Link href="/vehicles" className="font-medium text-primary hover:underline">
                Browse inventory
              </Link>
            </div>
          ) : vehicles.length >= 2 ? (
            <>
              <section>
                <h2 className="mb-3 text-lg font-semibold">Specifications</h2>
                <CompareTable vehicles={vehicles} />
              </section>

              {featureGroups.length > 0 ? (
                <section>
                  <h2 className="mb-1 text-lg font-semibold">Features</h2>
                  <p className="mb-4 text-xs text-muted-foreground">
                    <Check className="mr-1 inline h-3 w-3 text-success" aria-hidden />
                    Listed by the seller &nbsp;·&nbsp;
                    <span aria-hidden>—</span> Not listed — not necessarily absent, only not
                    mentioned in that listing.
                  </p>
                  <div className="flex flex-col gap-6">
                    {featureGroups.map((group) => (
                      <CompareFeatureGroup key={group.category} group={group} vehicles={vehicles} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
