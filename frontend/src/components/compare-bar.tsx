'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { hydrateCompareStore, useCompareIds, useCompareStore } from '@/store/compare-store';
import { useCompareVehicles } from '@/lib/use-compare-vehicles';
import { Button } from '@/components/ui';

/**
 * The floating "you have vehicles selected" tray, mounted once in
 * `app/layout.tsx` so it survives navigating between inventory and a
 * vehicle's own page — the whole point of a persistent compare list.
 *
 * Hidden on `/compare` itself: that page already shows every vehicle in the
 * list in full, so repeating the same names in a bar above it would only be
 * clutter on the one page where the bar has nothing left to add.
 *
 * Not fixed-positioned itself, for the same reason `CookieConsentBanner`
 * isn't: `app/layout.tsx` stacks both inside one fixed-to-the-viewport
 * bottom container, so the rare visitor with both on screen at once sees
 * them stacked rather than overlapping.
 */
export function CompareBar() {
  const pathname = usePathname();
  const ids = useCompareIds();
  const remove = useCompareStore((state) => state.remove);
  const clear = useCompareStore((state) => state.clear);
  const { vehicles } = useCompareVehicles(ids);

  useEffect(() => {
    hydrateCompareStore();
  }, []);

  if (ids.length === 0 || pathname === '/compare') return null;

  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

  return (
    <div className="border-t border-border bg-card px-4 py-3 shadow-lg">
      <div className="container flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <p className="shrink-0 text-sm font-semibold">Compare ({ids.length})</p>
          <ul className="flex min-w-0 gap-2 overflow-x-auto">
            {ids.map((id) => {
              const vehicle = byId.get(id);
              const name = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Vehicle';
              return (
                <li
                  key={id}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs"
                >
                  <span className="max-w-[9rem] truncate">{name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${name} from comparison`}
                    onClick={() => remove(id)}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear All
          </Button>
          <Link href="/compare">
            <Button size="sm">Compare Now</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
