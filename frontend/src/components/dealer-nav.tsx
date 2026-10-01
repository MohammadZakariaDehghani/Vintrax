'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calculator,
  CircleHelp,
  FileUp,
  Landmark,
  LayoutDashboard,
  Package,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { openDealerHelp } from '@/components/dealer-help-assistant';
import { useIsPrivateSeller } from '@/store/auth-store';

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Whether a path belongs to this entry. */
  match: (path: string) => boolean;
  /** Shown to private sellers too, not only dealerships, under this label. */
  privateSeller?: string;
}

/**
 * The dealer portal's sections: the dashboard, the inventory and what hangs
 * off it, costs, and finance applications. Help opens the assistant rather than a page.
 *
 * "Inventory" owns every /dealer/inventory path except the import screen,
 * which has its own entry, so exactly one entry is ever marked current.
 */
const LINKS: NavLink[] = [
  {
    href: '/dealer/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    match: (path) => path === '/dealer/dashboard',
  },
  {
    href: '/dealer/inventory',
    label: 'All vehicles',
    icon: Package,
    privateSeller: 'My listings',
    match: (path) =>
      path.startsWith('/dealer/inventory') && !path.startsWith('/dealer/inventory/import'),
  },
  {
    href: '/dealer/add-vehicle',
    label: 'Add vehicle',
    icon: Plus,
    privateSeller: 'Add vehicle',
    match: (path) => path === '/dealer/add-vehicle',
  },
  {
    href: '/dealer/inventory/import',
    label: 'Import inventory',
    icon: FileUp,
    match: (path) => path.startsWith('/dealer/inventory/import'),
  },
  {
    href: '/dealer/costs',
    label: 'Costs',
    icon: Calculator,
    match: (path) => path.startsWith('/dealer/costs'),
  },
  {
    href: '/dealer/finance',
    label: 'Finance',
    icon: Landmark,
    match: (path) => path.startsWith('/dealer/finance'),
  },
];

export function DealerNav() {
  const pathname = usePathname() ?? '';
  const privateSeller = useIsPrivateSeller();
  const links = privateSeller ? LINKS.filter((link) => link.privateSeller) : LINKS;

  return (
    <nav aria-label="Dealer portal" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max min-w-full gap-1 rounded-lg border border-border bg-card p-1 sm:w-auto">
        {links.map((link) => {
          const active = link.match(pathname);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <link.icon className="h-4 w-4" aria-hidden />
                {privateSeller ? link.privateSeller : link.label}
              </Link>
            </li>
          );
        })}
        {privateSeller ? null : (
          <li className="ml-auto">
            <button
              type="button"
              onClick={() => openDealerHelp()}
              className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <CircleHelp className="h-4 w-4" aria-hidden />
              Help
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
