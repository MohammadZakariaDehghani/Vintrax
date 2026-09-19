'use client';

import { Check } from 'lucide-react';
import type { VehicleDetail } from '@vintrax/shared';
import type { CompareFeatureCategoryGroup } from '@/lib/compare-feature-matrix';
import { cn } from '@/lib/utils';

/**
 * One feature category's table — "Technology", "Safety", and so on.
 *
 * Repeats a short vehicle header of its own rather than relying on the
 * specification table above it, because this table's `overflow-x-auto`
 * scrolls independently: without its own header, scrolling this one out of
 * sync with the table above would leave a column with no way to tell whose
 * checkmark is whose.
 */
export function CompareFeatureGroup({
  group,
  vehicles,
}: {
  group: CompareFeatureCategoryGroup;
  vehicles: VehicleDetail[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{group.category}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[9rem] border-b border-r border-border bg-card p-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Feature
              </th>
              {vehicles.map((vehicle) => (
                <th
                  key={vehicle.id}
                  scope="col"
                  className="min-w-[7rem] border-b border-border bg-card p-2.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {vehicle.make} {vehicle.model}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => {
              const differs = row.present.some((present) => present !== row.present[0]);
              return (
                <tr key={row.feature} className={cn(differs && 'bg-primary/5')}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r border-border bg-card p-2.5 text-left font-medium text-muted-foreground"
                  >
                    {row.feature}
                    {differs ? <span className="sr-only"> — differs across vehicles</span> : null}
                  </th>
                  {row.present.map((present, index) => (
                    <td key={index} className="border-b border-border p-2.5 text-center">
                      {present ? (
                        <Check className="mx-auto h-4 w-4 text-success" aria-hidden />
                      ) : (
                        <span className="text-muted-foreground" aria-hidden>
                          —
                        </span>
                      )}
                      <span className="sr-only">{present ? 'Listed' : 'Not listed'}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
