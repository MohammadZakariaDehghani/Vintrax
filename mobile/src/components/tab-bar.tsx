'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Car, Gavel, Heart, Home, User } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * The primary navigation.
 *
 * Five destinations, fixed to the bottom where a thumb reaches without
 * regripping the phone. Everything else in the app is reachable from one of
 * these in a single tap, which is the constraint that keeps the count at five.
 */
const TABS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/browse', label: 'Browse', icon: Car },
  { href: '/auctions', label: 'Auctions', icon: Gavel },
  { href: '/saved', label: 'Saved', icon: Heart },
  { href: '/account', label: 'Account', icon: User },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-touch flex-col items-center justify-center gap-1 py-2.5 text-[0.6875rem] font-medium',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon aria-hidden className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
