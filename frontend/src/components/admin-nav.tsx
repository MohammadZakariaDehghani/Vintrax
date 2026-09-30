'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  FileText,
  Handshake,
  Headset,
  ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
  Mail,
  Newspaper,
  PanelBottom,
  ShieldAlert,
  Tag,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api-client';

const LINKS = [
  { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/moderation', label: 'Moderation', icon: ShieldAlert },
  { href: '/admin/dealers', label: 'Dealerships', icon: Building2 },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/blog', label: 'Blog', icon: Newspaper },
  { href: '/admin/promo-tiles', label: 'Home boxes', icon: LayoutGrid },
  { href: '/admin/home-features', label: 'Home features', icon: LayoutList },
  { href: '/admin/body-types', label: 'Body type icons', icon: ImageIcon },
  { href: '/admin/make-logos', label: 'Make logos', icon: Tag },
  { href: '/admin/partners', label: 'Partners', icon: Handshake },
  { href: '/admin/pages', label: 'Pages', icon: FileText },
  { href: '/admin/contact', label: 'Contact', icon: Mail },
  { href: '/admin/footer', label: 'Footer', icon: PanelBottom },
  { href: '/admin/support', label: 'Support', icon: Headset },
] as const;

/**
 * Navigation between the administration screens.
 *
 * Without it each page is reachable only from a dashboard tile, so moving from
 * moderation to dealer verification means going back through the overview.
 */
export function AdminNav() {
  const pathname = usePathname();
  // Open site chats with a visitor message nobody on the team has read.
  const unread = useQuery({
    queryKey: ['support-unread'],
    queryFn: () => api.get<{ unread: number }>('/admin/support-chats/unread'),
    refetchInterval: 30_000,
  }).data?.unread;

  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Administration">
      {LINKS.map((link) => {
        // A section's own sub-screens (a page's editor) keep its tab lit.
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
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
            {link.href === '/admin/support' && unread ? (
              <span
                className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground"
                aria-label={`${unread} unread`}
              >
                {unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
