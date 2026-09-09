'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  DollarSign,
  ImageIcon,
  LayoutDashboard,
  Newspaper,
  ShieldAlert,
  Users,
} from 'lucide-react';

const LINKS = [
  { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/moderation', label: 'Moderation', icon: ShieldAlert },
  { href: '/admin/dealers', label: 'Dealerships', icon: Building2 },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/revenue', label: 'Revenue', icon: DollarSign },
  { href: '/admin/blog', label: 'Blog', icon: Newspaper },
  { href: '/admin/body-types', label: 'Body type photos', icon: ImageIcon },
] as const;

/**
 * Navigation between the administration screens.
 *
 * Without it each page is reachable only from a dashboard tile, so moving from
 * moderation to dealer verification means going back through the overview.
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Administration">
      {LINKS.map((link) => {
        const active = pathname === link.href;
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
          </Link>
        );
      })}
    </nav>
  );
}
