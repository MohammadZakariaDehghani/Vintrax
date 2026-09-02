'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { Bell, Gavel, Heart, LayoutDashboard, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuthStore, useIsAdmin, useIsSeller, useUser } from '@/store/auth-store';
import { Button } from '@/components/ui';
import { LogoMark } from '@/components/logo';

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Theme is unknown until hydration; rendering the resolved icon before then
  // would mismatch the server output.
  useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {mounted && resolvedTheme === 'dark' ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </Button>
  );
}

function NotificationBell() {
  const user = useUser();

  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    enabled: Boolean(user),
    // In-app notifications do not need a socket; a periodic poll is enough.
    refetchInterval: 60_000,
  });

  if (!user) return null;

  return (
    <Link
      href="/dashboard/notifications"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-secondary"
      aria-label={data?.unread ? `${data.unread} unread notifications` : 'Notifications'}
    >
      <Bell className="h-4 w-4" aria-hidden />
      {data?.unread ? (
        <span className="absolute right-1.5 top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-foreground">
          {data.unread > 9 ? '9+' : data.unread}
        </span>
      ) : null}
    </Link>
  );
}

const NAV_LINKS = [
  { href: '/vehicles', label: 'Browse', icon: Search },
  { href: '/auctions', label: 'Auctions', icon: Gavel },
];

export function SiteHeader() {
  const pathname = usePathname();
  const user = useUser();
  const isSeller = useIsSeller();
  const isAdmin = useIsAdmin();
  const logout = useAuthStore((state) => state.logout);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <LogoMark className="h-8 w-8" aria-hidden />
          <span className="text-lg">Atlas</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary',
                isActive(link.href) ? 'bg-secondary text-foreground' : 'text-muted-foreground',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />

          {user ? (
            <>
              <NotificationBell />
              <Link
                href="/dashboard/favorites"
                className="hidden h-10 w-10 items-center justify-center rounded-md hover:bg-secondary sm:inline-flex"
                aria-label="Saved vehicles"
              >
                <Heart className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href={isAdmin ? '/admin/dashboard' : isSeller ? '/dealer/dashboard' : '/dashboard'}
                className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary sm:inline-flex"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                Dashboard
              </Link>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
              >
                Sign in
              </Link>
              <Link href="/register">
                <Button size="sm">Create account</Button>
              </Link>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <nav className="border-t border-border px-5 py-3 md:hidden" aria-label="Mobile">
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
                >
                  <link.icon className="h-4 w-4" aria-hidden />
                  {link.label}
                </Link>
              </li>
            ))}
            {user ? (
              <li>
                <Link
                  href={isAdmin ? '/admin/dashboard' : isSeller ? '/dealer/dashboard' : '/dashboard'}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary"
                >
                  <LayoutDashboard className="h-4 w-4" aria-hidden />
                  Dashboard
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
