'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  CalendarClock,
  CalendarDays,
  Columns3,
  LayoutDashboard,
  ListChecks,
  Mail,
  Megaphone,
  Search,
  Settings,
  FileText,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { COMPLIANCE_NOTE, DEALER_STAFF_ROLE_LABELS, type CrmPermission } from '@vintrax/shared';
import { Card, CardContent, ErrorAlert, Input, Select, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { crm, personName, qs, selectCrmDealer, selectedCrmDealer, type CrmDealership, type CrmMe } from '@/lib/crm';
import { CrmContext, useCrm } from './context';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: CrmPermission;
  exact?: boolean;
}

/** The sidebar the issue asks for, in its order. */
const NAV: NavItem[] = [
  { href: '/dealer/crm', label: 'Overview', icon: LayoutDashboard, permission: 'crm.view', exact: true },
  { href: '/dealer/crm/leads', label: 'Leads', icon: UserRound, permission: 'crm.view' },
  { href: '/dealer/crm/customers', label: 'Customers', icon: Users, permission: 'crm.view' },
  { href: '/dealer/crm/pipeline', label: 'Pipeline', icon: Columns3, permission: 'crm.view' },
  { href: '/dealer/crm/activities', label: 'Activities', icon: Activity, permission: 'crm.view' },
  { href: '/dealer/crm/tasks', label: 'Tasks', icon: ListChecks, permission: 'crm.view' },
  { href: '/dealer/crm/appointments', label: 'Appointments', icon: CalendarClock, permission: 'crm.view' },
  { href: '/dealer/crm/emails', label: 'Emails', icon: Mail, permission: 'crm.view' },
  { href: '/dealer/crm/templates', label: 'Templates', icon: FileText, permission: 'crm.view' },
  { href: '/dealer/crm/automations', label: 'Automations', icon: Workflow, permission: 'crm.view' },
  { href: '/dealer/crm/campaigns', label: 'Campaigns', icon: Megaphone, permission: 'crm.marketing' },
  { href: '/dealer/crm/calendar', label: 'Calendar', icon: CalendarDays, permission: 'crm.view' },
  { href: '/dealer/crm/reports', label: 'Reports', icon: BarChart3, permission: 'crm.reports' },
  { href: '/dealer/crm/settings', label: 'Settings', icon: Settings, permission: 'crm.view' },
];

function isActive(item: NavItem, path: string) {
  return item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
}

/**
 * The Dealer CRM area: which dealership, the caller's role, and the section
 * navigation. Everything here is a convenience; the API checks dealership
 * and role on every request.
 */
export function CrmShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <CrmGate>{children}</CrmGate>
    </RequireAuth>
  );
}

function CrmGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [dealerId, setDealerId] = useState<string | null>(null);
  const dealerships = useQuery({
    queryKey: ['crm-dealerships'],
    queryFn: () => crm.get<CrmDealership[]>('/dealerships'),
  });

  useEffect(() => {
    const list = dealerships.data;
    if (!list || list.length === 0) return;
    const stored = selectedCrmDealer();
    const chosen = list.find((entry) => entry.dealerId === stored)?.dealerId ?? list[0]!.dealerId;
    selectCrmDealer(chosen);
    setDealerId(chosen);
  }, [dealerships.data]);

  const me = useQuery({
    queryKey: ['crm', dealerId, 'me'],
    queryFn: () => crm.get<CrmMe>('/me'),
    enabled: Boolean(dealerId),
  });

  if (dealerships.isPending || (dealerships.data?.length && (!dealerId || me.isPending))) {
    return <Spinner label="Opening the CRM" />;
  }
  if (dealerships.error) return <Container><ErrorAlert error={dealerships.error} /></Container>;
  if (!dealerships.data?.length) {
    return (
      <Container>
        <Card>
          <CardContent className="py-10 text-center">
            <h1 className="text-xl font-semibold">The CRM is for dealerships</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Dealership owners and the staff they add work their leads here. If you work at a dealership, ask the
              owner to add you under Accounting → Settings &amp; team.
            </p>
          </CardContent>
        </Card>
      </Container>
    );
  }
  if (me.error || !me.data) return <Container><ErrorAlert error={me.error} /></Container>;

  const value = {
    me: me.data,
    dealerId: dealerId!,
    dealerships: dealerships.data,
    can: (permission: CrmPermission) => me.data.me.permissions.includes(permission),
    switchDealer: (next: string) => {
      selectCrmDealer(next);
      setDealerId(next);
      void client.invalidateQueries({ queryKey: ['crm'] });
    },
  };
  return (
    <CrmContext.Provider value={value}>
      <Frame>{children}</Frame>
    </CrmContext.Provider>
  );
}

function Container({ children }: { children: ReactNode }) {
  return (
    <div className="container py-8">
      <DashboardNav />
      {children}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { me, can, dealerships, dealerId, switchDealer } = useCrm();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const items = NAV.filter((item) => can(item.permission));
  const current = items.find((item) => isActive(item, pathname));

  return (
    <div className="container py-8">
      <DashboardNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CRM</p>
          <p className="truncate font-semibold">
            {me.dealer.name}{' '}
            <span className="text-sm font-normal text-muted-foreground">· {DEALER_STAFF_ROLE_LABELS[me.me.role]}</span>
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {dealerships.length > 1 ? (
            <Select aria-label="Dealership" className="h-9 w-56" value={dealerId} onChange={(event) => switchDealer(event.target.value)}>
              {dealerships.map((entry) => (
                <option key={entry.dealerId} value={entry.dealerId}>
                  {entry.name}
                </option>
              ))}
            </Select>
          ) : null}
          <CrmSearch />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="CRM" className="mb-6 lg:mb-0">
          <div className="lg:hidden">
            <label htmlFor="crm-section" className="sr-only">
              Section
            </label>
            <Select id="crm-section" value={current?.href ?? ''} onChange={(event) => router.push(event.target.value)}>
              {current ? null : <option value="">Choose a section</option>}
              {items.map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
            </Select>
          </div>
          <ul className="sticky top-20 hidden space-y-0.5 lg:block">
            {items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">
          {children}
          <p className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">{COMPLIANCE_NOTE}</p>
        </div>
      </div>
    </div>
  );
}

interface SearchResult {
  leads: Array<{ id: string; number: number; firstName: string; lastName: string | null; email: string | null; phone: string | null; status: { label: string } }>;
  customers: Array<{ id: string; name: string; email: string | null; crmLeads: Array<{ id: string }> }>;
  tasks: Array<{ id: string; title: string; status: string; leadId: string | null }>;
  campaigns: Array<{ id: string; name: string; status: string }>;
  vehicles: Array<{ id: string; title: string; vin: string | null; stockNumber: string | null; _count: { crmLeads: number } }>;
}

function CrmSearch() {
  const { dealerId } = useCrm();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery({
    queryKey: ['crm', dealerId, 'search', term],
    queryFn: () => crm.get<SearchResult>(`/search${qs({ q: term })}`),
    enabled: term.length >= 2,
  });
  const data = results.data;
  const hits = data
    ? [
        ...data.leads.map((lead) => ({
          key: `l${lead.id}`,
          kind: `Lead #${lead.number}`,
          title: personName(lead),
          subtitle: [lead.email, lead.phone, lead.status.label].filter(Boolean).join(' · '),
          href: `/dealer/crm/leads/${lead.id}`,
        })),
        ...data.customers
          .filter((customer) => customer.crmLeads[0])
          .map((customer) => ({
            key: `c${customer.id}`,
            kind: 'Customer',
            title: customer.name,
            subtitle: customer.email ?? '',
            href: `/dealer/crm/leads/${customer.crmLeads[0]!.id}`,
          })),
        ...data.tasks.map((task) => ({
          key: `t${task.id}`,
          kind: 'Task',
          title: task.title,
          subtitle: task.status,
          href: task.leadId ? `/dealer/crm/leads/${task.leadId}` : '/dealer/crm/tasks',
        })),
        ...data.campaigns.map((campaign) => ({
          key: `m${campaign.id}`,
          kind: 'Campaign',
          title: campaign.name,
          subtitle: campaign.status,
          href: '/dealer/crm/campaigns',
        })),
        ...data.vehicles.map((vehicle) => ({
          key: `v${vehicle.id}`,
          kind: 'Vehicle',
          title: vehicle.title,
          subtitle: `${vehicle._count.crmLeads} lead(s)${vehicle.vin ? ` · ${vehicle.vin}` : ''}`,
          href: `/dealer/crm/leads?q=${encodeURIComponent(vehicle.vin ?? vehicle.title)}`,
        })),
      ]
    : [];
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        aria-label="Search the CRM"
        placeholder="Name, email, phone, VIN, lead #…"
        className="h-9 pl-9"
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
      />
      {open && term.length >= 2 ? (
        <div className="absolute right-0 z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg sm:w-96">
          {results.isPending ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : hits.length ? (
            <ul>
              {hits.map((hit) => (
                <li key={hit.key}>
                  <Link href={hit.href} className="block px-3 py-2 text-sm hover:bg-secondary" onClick={() => setOpen(false)}>
                    <span className="mr-2 text-xs font-semibold uppercase text-muted-foreground">{hit.kind}</span>
                    {hit.title}
                    {hit.subtitle ? <span className="block text-xs text-muted-foreground">{hit.subtitle}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matches.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
