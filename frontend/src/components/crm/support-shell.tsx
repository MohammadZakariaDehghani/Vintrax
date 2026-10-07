'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  BarChart3,
  Building2,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Settings,
  Ticket,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Select } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

const NAV: Array<{ href: string; label: string; icon: LucideIcon; exact?: boolean }> = [
  { href: '/admin/crm', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/crm/tickets', label: 'Tickets', icon: Ticket },
  { href: '/admin/crm/dealers', label: 'Dealers', icon: Building2 },
  { href: '/admin/crm/users', label: 'Users', icon: Users },
  { href: '/admin/crm/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/admin/crm/communication', label: 'Communication', icon: MessageSquareText },
  { href: '/admin/crm/automations', label: 'Automations', icon: Workflow },
  { href: '/admin/crm/templates', label: 'Templates', icon: FileText },
  { href: '/admin/crm/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/crm/settings', label: 'Settings', icon: Settings },
];

/**
 * The Admin CRM (support desk): administrators only. The API refuses every
 * route without `support:manage` regardless of what this shell shows.
 */
export function SupportShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const active = (item: (typeof NAV)[number]) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
  const current = NAV.find(active);
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
          <nav aria-label="Admin CRM" className="mb-6 lg:mb-0">
            <div className="lg:hidden">
              <label htmlFor="support-section" className="sr-only">Section</label>
              <Select id="support-section" value={current?.href ?? ''} onChange={(event) => router.push(event.target.value)}>
                {NAV.map((item) => (
                  <option key={item.href} value={item.href}>{item.label}</option>
                ))}
              </Select>
            </div>
            <ul className="sticky top-20 hidden space-y-0.5 lg:block">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active(item) ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${active(item) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </RequireAuth>
  );
}
