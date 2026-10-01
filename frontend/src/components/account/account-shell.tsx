'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Gavel,
  Heart,
  Mail,
  MessagesSquare,
  Package,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useIsSeller, useUser } from '@/store/auth-store';

interface SidebarLink {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: 'messages';
}

const ACTIVITY: SidebarLink[] = [
  { href: '/dashboard/favorites', label: 'Saved cars', icon: Heart },
  { href: '/dashboard/messages', label: 'Messages', icon: MessagesSquare, badge: 'messages' },
  { href: '/dashboard/my-bids', label: 'My bids', icon: Gavel },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
];

/** A private seller's own cars, reached from the same sidebar. */
const SELLING: SidebarLink = { href: '/dealer/inventory', label: 'My listings', icon: Package };

const ACCOUNT: SidebarLink[] = [
  { href: '/dashboard/account', label: 'Account settings', icon: UserCog },
  { href: '/dashboard/account/notifications', label: 'Email notifications', icon: Mail },
];

function Section({ title, links }: { title: string; links: SidebarLink[] }) {
  const pathname = usePathname();
  const user = useUser();
  const unread = useQuery({
    queryKey: ['conversations', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/conversations/unread-count'),
    enabled: Boolean(user),
  });

  return (
    <div className="contents md:block">
      <p className="hidden border-b border-border px-3 pb-2 md:block text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </p>
      <ul className="contents md:mt-2 md:flex md:flex-col md:gap-0.5">
        {links.map((link) => {
          const active = pathname === link.href;
          const count = link.badge === 'messages' ? unread.data?.unread : undefined;
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-colors md:gap-3',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary text-foreground/85 hover:bg-secondary hover:text-foreground md:bg-transparent',
                )}
              >
                <link.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="flex-1">{link.label}</span>
                {count ? (
                  <span
                    className={cn(
                      'tabular min-w-5 rounded-full px-1.5 text-center text-xs font-bold',
                      active
                        ? 'bg-primary-foreground text-primary'
                        : 'bg-primary text-primary-foreground',
                    )}
                    aria-label={`${count} unread`}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The account area: a sidebar with the account's activity and settings, and
 * the page beside it. On a phone the sidebar becomes a row of pills above
 * that scrolls sideways.
 */
export function AccountShell({ title, children }: { title: string; children: ReactNode }) {
  const isSeller = useIsSeller();
  const activity = isSeller ? [...ACTIVITY, SELLING] : ACTIVITY;

  return (
    <div className="container py-8 md:py-10">
      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
        <aside className="-mx-4 min-w-0 self-start px-4 md:sticky md:top-24 md:mx-0 md:rounded-2xl md:border md:border-border md:bg-card md:p-4">
          <nav
            aria-label="Account"
            className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-6 md:overflow-visible md:pb-0"
          >
            <Section title="My activity" links={activity} />
            <Section title="My account" links={ACCOUNT} />
          </nav>
        </aside>
        <div className="min-w-0">
          <h1 className="mb-6 text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
