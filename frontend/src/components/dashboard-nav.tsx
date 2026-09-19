'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Gavel,
  Heart,
  LayoutDashboard,
  MessagesSquare,
  Package,
  Bell,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { useIsSeller, useUser } from '@/store/auth-store';

const BUYER_LINKS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/favorites', label: 'Saved', icon: Heart },
  { href: '/dashboard/my-bids', label: 'My bids', icon: Gavel },
  { href: '/dashboard/messages', label: 'Messages', icon: MessagesSquare, badge: 'messages' },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
] as const;

/** Appended for sellers and dealers, who have a second surface to reach. */
const SELLER_LINKS = [
  { href: '/dealer/dashboard', label: 'Dealer', icon: Building2 },
  { href: '/dealer/inventory', label: 'Inventory', icon: Package },
] as const;

/**
 * Navigation across the signed-in dashboard.
 *
 * The same idea as `AdminNav`: without it every screen is reachable only from
 * a tile on the overview, so moving between saved vehicles and messages goes
 * back through the front page. The two counts are shown here as well as in the
 * header, because this row is where someone is when they are working.
 */
export function DashboardNav() {
  const pathname = usePathname();
  const user = useUser();
  const isSeller = useIsSeller();

  const messages = useQuery({
    queryKey: ['conversations', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/conversations/unread-count'),
    enabled: Boolean(user),
  });

  const notifications = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    enabled: Boolean(user),
  });

  const counts: Record<string, number | undefined> = {
    messages: messages.data?.unread,
    notifications: notifications.data?.unread,
  };

  const links = isSeller ? [...BUYER_LINKS, ...SELLER_LINKS] : BUYER_LINKS;

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Dashboard">
      {links.map((link) => {
        // Exact match only: /dashboard is a prefix of every other entry, so a
        // prefix test would light up Overview on all of them.
        const active = pathname === link.href;
        const count = 'badge' in link ? counts[link.badge] : undefined;

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <link.icon className="h-4 w-4" aria-hidden />
            {link.label}
            {count ? (
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold leading-4 text-accent-foreground">
                {count > 9 ? '9+' : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
