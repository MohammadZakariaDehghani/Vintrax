'use client';

import type { VehicleDetail } from '@vintrax/shared';
import { buildCompareSpecs } from '@/lib/compare-specs';
import { cn } from '@/lib/utils';

/**
 * The specification table: one row per field, one column per vehicle.
 *
 * The first column is `sticky left-0`, so on a narrow screen the row label
 * stays visible while only the vehicle columns scroll — the table's own
 * `overflow-x-auto` wrapper is the only thing that scrolls horizontally, not
 * the page. A row where every vehicle agrees stays visually quiet; a row
 * that differs gets both a subtle background tint and a bolder value, never
 * color alone, so the distinction still reads for a reader who cannot see
 * the tint.
 */
export function CompareTable({ vehicles }: { vehicles: VehicleDetail[] }) {
  const rows = buildCompareSpecs(vehicles);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[9rem] border-b border-r border-border bg-card p-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Specification
            </th>
            {vehicles.map((vehicle) => (
              <th
                key={vehicle.id}
                scope="col"
                className="min-w-[10rem] border-b border-border bg-card p-3 text-left font-semibold"
              >
                {vehicle.year} {vehicle.make} {vehicle.model}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={cn(row.differs && 'bg-primary/5')}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-r border-border bg-card p-3 text-left font-medium text-muted-foreground"
              >
                {row.label}
                {row.differs ? <span className="sr-only"> — differs across vehicles</span> : null}
              </th>
              {row.values.map((value, index) => (
                <td
                  key={index}
                  className={cn(
                    'border-b border-border p-3',
                    row.differs ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
