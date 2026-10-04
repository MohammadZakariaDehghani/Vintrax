'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BookOpen,
  Building,
  CalendarRange,
  Car,
  FileBarChart,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListTree,
  Receipt,
  Scale,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  DEALER_STAFF_ROLE_LABELS,
  PROVINCES,
  PROVINCE_LABELS,
  TAX_DISCLAIMER,
  TAX_FILING_FREQUENCIES,
  type AccountingPermission,
} from '@vintrax/shared';
import {
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { ApiError } from '@/lib/api-client';
import { formatEnum } from '@/lib/utils';
import {
  acct,
  qs,
  selectDealer,
  selectedDealerId,
  type AccountingStatus,
  type Dealership,
} from '@/lib/accounting';
import { AccountingContext, useAccounting } from './context';
import { MoneyInput } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: AccountingPermission;
  exact?: boolean;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Overview',
    items: [
      {
        href: '/dealer/accounting',
        label: 'Overview',
        icon: LayoutDashboard,
        permission: 'accounting.view',
        exact: true,
      },
      {
        href: '/dealer/accounting/health',
        label: 'Accounting health',
        icon: Activity,
        permission: 'accounting.view',
      },
    ],
  },
  {
    group: 'Sales',
    items: [
      {
        href: '/dealer/accounting/sales',
        label: 'Deal desk',
        icon: ShoppingCart,
        permission: 'accounting.sales',
      },
      {
        href: '/dealer/accounting/deposits',
        label: 'Deposits & trade-ins',
        icon: HandCoins,
        permission: 'accounting.sales',
      },
      {
        href: '/dealer/accounting/customers',
        label: 'Customers & vendors',
        icon: Users,
        permission: 'accounting.sales',
      },
    ],
  },
  {
    group: 'Inventory',
    items: [
      {
        href: '/dealer/accounting/purchases',
        label: 'Vehicle purchases',
        icon: Car,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/floor-plan',
        label: 'Floor plan',
        icon: Truck,
        permission: 'accounting.view',
      },
    ],
  },
  {
    group: 'Money',
    items: [
      {
        href: '/dealer/accounting/receivables',
        label: 'Receivables',
        icon: FileText,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/payables',
        label: 'Payables',
        icon: Receipt,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/payments',
        label: 'Payments',
        icon: Wallet,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/expenses',
        label: 'Expenses',
        icon: Receipt,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/banking',
        label: 'Banking & reconciliation',
        icon: Landmark,
        permission: 'accounting.view',
      },
    ],
  },
  {
    group: 'Books',
    items: [
      {
        href: '/dealer/accounting/journal',
        label: 'Journal entries',
        icon: BookOpen,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/ledger',
        label: 'General ledger',
        icon: ListTree,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/accounts',
        label: 'Chart of accounts',
        icon: Building,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/periods',
        label: 'Fiscal periods',
        icon: CalendarRange,
        permission: 'accounting.view',
      },
    ],
  },
  {
    group: 'Tax & reports',
    items: [
      {
        href: '/dealer/accounting/tax',
        label: 'Tax center',
        icon: Scale,
        permission: 'accounting.view',
      },
      {
        href: '/dealer/accounting/reports',
        label: 'Reports',
        icon: FileBarChart,
        permission: 'accounting.view',
      },
    ],
  },
  {
    group: 'Administration',
    items: [
      {
        href: '/dealer/accounting/settings',
        label: 'Settings & team',
        icon: Settings,
        permission: 'accounting.settings',
      },
    ],
  },
];

function isActive(item: NavItem, path: string) {
  return item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
}

/**
 * The accounting area: who the caller is in which dealership's books, the
 * one-time setup, and the section navigation. Every rule here is a
 * convenience; the API checks role and dealership on every request.
 */
export function AccountingShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AccountingGate>{children}</AccountingGate>
    </RequireAuth>
  );
}

function AccountingGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [dealerId, setDealerId] = useState<string | null>(null);

  const dealerships = useQuery({
    queryKey: ['acct-dealerships'],
    queryFn: () => acct.get<Dealership[]>('/dealerships'),
  });

  useEffect(() => {
    const list = dealerships.data;
    if (!list || list.length === 0) return;
    const stored = selectedDealerId();
    const chosen = list.find((entry) => entry.dealerId === stored)?.dealerId ?? list[0]!.dealerId;
    selectDealer(chosen);
    setDealerId(chosen);
  }, [dealerships.data]);

  const status = useQuery({
    queryKey: ['acct', dealerId, 'status'],
    queryFn: () => acct.get<AccountingStatus>('/status'),
    enabled: Boolean(dealerId),
  });

  if (dealerships.isPending || (dealerships.data?.length && (!dealerId || status.isPending))) {
    return <Spinner label="Opening the books" />;
  }
  if (dealerships.error)
    return (
      <Container>
        <ErrorAlert error={dealerships.error} />
      </Container>
    );
  if (!dealerships.data?.length) {
    return (
      <Container>
        <Card>
          <CardContent className="py-10 text-center">
            <h1 className="text-xl font-semibold">Accounting is for dealerships</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Dealer accounting is available to dealership owners and the staff they add. If you
              work at a dealership, ask the owner to add you under Accounting → Settings & team.
            </p>
          </CardContent>
        </Card>
      </Container>
    );
  }
  if (status.error || !status.data)
    return (
      <Container>
        <ErrorAlert error={status.error} />
      </Container>
    );

  const value = {
    status: status.data,
    dealerId: dealerId!,
    dealerships: dealerships.data,
    can: (permission: AccountingPermission) => status.data.permissions.includes(permission),
    switchDealer: (next: string) => {
      selectDealer(next);
      setDealerId(next);
      void client.invalidateQueries({ queryKey: ['acct'] });
    },
  };

  return (
    <AccountingContext.Provider value={value}>
      {status.data.setUp ? <Frame>{children}</Frame> : <SetupScreen />}
    </AccountingContext.Provider>
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
  const { status, can, dealerships, dealerId, switchDealer } = useAccounting();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.permission === 'accounting.settings'
        ? can('accounting.settings') || can('accounting.manage_team')
        : can(item.permission),
    ),
  })).filter((group) => group.items.length > 0);
  const flat = groups.flatMap((group) => group.items);
  const current = flat.find((item) => isActive(item, pathname));

  // Sales staff land on the deal desk, not a dashboard they cannot read.
  useEffect(() => {
    if (pathname === '/dealer/accounting' && !can('accounting.view') && can('accounting.sales')) {
      router.replace('/dealer/accounting/sales');
    }
  }, [pathname, can, router]);

  return (
    <div className="container py-8">
      <DashboardNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Accounting
          </p>
          <p className="truncate font-semibold">
            {status.dealer.name}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              · {DEALER_STAFF_ROLE_LABELS[status.role]}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dealerships.length > 1 ? (
            <Select
              aria-label="Dealership"
              className="h-9 w-56"
              value={dealerId}
              onChange={(event) => switchDealer(event.target.value)}
            >
              {dealerships.map((entry) => (
                <option key={entry.dealerId} value={entry.dealerId}>
                  {entry.name}
                </option>
              ))}
            </Select>
          ) : null}
          {can('accounting.view') ? <GlobalSearch /> : null}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Accounting" className="mb-6 lg:mb-0">
          <div className="lg:hidden">
            <label htmlFor="acct-section" className="sr-only">
              Section
            </label>
            <Select
              id="acct-section"
              value={current?.href ?? ''}
              onChange={(event) => router.push(event.target.value)}
            >
              {current ? null : <option value="">Choose a section</option>}
              {groups.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map((item) => (
                    <option key={item.href} value={item.href}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div className="sticky top-20 hidden space-y-4 lg:block">
            {groups.map((group) => (
              <div key={group.group}>
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.group}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                          }`}
                        >
                          <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <main className="min-w-0">
          {children}
          <p className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
            {TAX_DISCLAIMER}
          </p>
        </main>
      </div>
    </div>
  );
}

interface SearchHit {
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

function GlobalSearch() {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const { dealerId } = useAccounting();
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery({
    queryKey: ['acct', dealerId, 'search', term],
    queryFn: () => acct.get<SearchHit[]>(`/search${qs({ q: term })}`),
    enabled: term.length >= 2,
  });
  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        aria-label="Search the books"
        placeholder="Search VIN, invoice, customer, reference…"
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
          ) : results.data && results.data.length > 0 ? (
            <ul>
              {results.data.map((hit) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <Link
                    href={hit.href}
                    className="block px-3 py-2 text-sm hover:bg-secondary"
                    onClick={() => setOpen(false)}
                  >
                    <span className="mr-2 text-xs font-semibold uppercase text-muted-foreground">
                      {formatEnum(hit.kind)}
                    </span>
                    {hit.title}
                    {hit.subtitle ? (
                      <span className="block text-xs text-muted-foreground">{hit.subtitle}</span>
                    ) : null}
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

// --- One-time setup ----------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function SetupScreen() {
  const { status, can } = useAccounting();
  const client = useQueryClient();
  const [form, setForm] = useState({
    legalName: status.dealer.name,
    businessNumber: status.dealer.businessNumber ?? '',
    gstHstNumber: '',
    pstNumber: '',
    qstNumber: '',
    province: status.dealer.province ?? 'ON',
    fiscalYearStartMonth: '1',
    fiscalYearStartDay: '1',
    taxFilingFrequency: 'QUARTERLY',
    bankName: 'Operating chequing',
    bankInstitution: '',
    last4: '',
    openingBalance: '',
    withBank: true,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const needsPst = useMemo(() => ['BC', 'SK', 'MB'].includes(form.province), [form.province]);

  if (!can('accounting.settings')) {
    return (
      <Container>
        <Card>
          <CardContent className="py-10 text-center">
            <h1 className="text-xl font-semibold">Accounting is not set up yet</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              The dealership owner or an accountant sets up the books once — the chart of accounts,
              fiscal year and tax registration. Ask them to open Accounting.
            </p>
          </CardContent>
        </Card>
      </Container>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acct.post('/setup', {
        legalName: form.legalName,
        businessNumber: form.businessNumber || null,
        gstHstNumber: form.gstHstNumber || null,
        pstNumber: needsPst ? form.pstNumber || null : null,
        qstNumber: form.province === 'QC' ? form.qstNumber || null : null,
        province: form.province,
        fiscalYearStartMonth: Number(form.fiscalYearStartMonth),
        fiscalYearStartDay: Number(form.fiscalYearStartDay),
        taxFilingFrequency: form.taxFilingFrequency,
        openingBank: form.withBank
          ? {
              name: form.bankName,
              bankName: form.bankInstitution || null,
              accountNumberLast4: form.last4 || null,
              openingBalance: form.openingBalance || '0',
            }
          : undefined,
      });
      await client.invalidateQueries({ queryKey: ['acct'] });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (name: string) =>
    error instanceof ApiError ? error.details[name]?.[0] : undefined;

  return (
    <Container>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Set up accounting</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This creates a Canadian dealership chart of accounts, your current fiscal year and its
          periods, and your bank account. You can add accounts and change settings later; the fiscal
          calendar is fixed once you post.
        </p>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-6">
          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              <Field
                label="Legal name"
                htmlFor="legalName"
                error={fieldError('legalName')}
                className="sm:col-span-2"
              >
                <Input
                  id="legalName"
                  required
                  value={form.legalName}
                  onChange={(event) => set('legalName')(event.target.value)}
                />
              </Field>
              <Field
                label="Province or territory"
                htmlFor="province"
                hint="Sets which sales taxes apply by default."
              >
                <Select
                  id="province"
                  value={form.province}
                  onChange={(event) => set('province')(event.target.value)}
                >
                  {PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {PROVINCE_LABELS[province]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Business number" htmlFor="bn">
                <Input
                  id="bn"
                  value={form.businessNumber}
                  onChange={(event) => set('businessNumber')(event.target.value)}
                />
              </Field>
              <Field label="GST/HST registration" htmlFor="gst" hint="e.g. 123456789RT0001">
                <Input
                  id="gst"
                  value={form.gstHstNumber}
                  onChange={(event) => set('gstHstNumber')(event.target.value)}
                />
              </Field>
              {needsPst ? (
                <Field label="PST / RST registration" htmlFor="pst">
                  <Input
                    id="pst"
                    value={form.pstNumber}
                    onChange={(event) => set('pstNumber')(event.target.value)}
                  />
                </Field>
              ) : null}
              {form.province === 'QC' ? (
                <Field label="QST registration" htmlFor="qst">
                  <Input
                    id="qst"
                    value={form.qstNumber}
                    onChange={(event) => set('qstNumber')(event.target.value)}
                  />
                </Field>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-3">
              <Field label="Fiscal year starts" htmlFor="fyMonth">
                <Select
                  id="fyMonth"
                  value={form.fiscalYearStartMonth}
                  onChange={(event) => set('fiscalYearStartMonth')(event.target.value)}
                >
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="On day" htmlFor="fyDay">
                <Input
                  id="fyDay"
                  type="number"
                  min={1}
                  max={28}
                  value={form.fiscalYearStartDay}
                  onChange={(event) => set('fiscalYearStartDay')(event.target.value)}
                />
              </Field>
              <Field label="Sales tax filing" htmlFor="freq">
                <Select
                  id="freq"
                  value={form.taxFilingFrequency}
                  onChange={(event) => set('taxFilingFrequency')(event.target.value)}
                >
                  {TAX_FILING_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {formatEnum(frequency)}
                    </option>
                  ))}
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.withBank}
                  onChange={(event) => set('withBank')(event.target.checked)}
                />
                Add my operating bank account now
              </label>
              {form.withBank ? (
                <>
                  <Field label="Account name" htmlFor="bankName">
                    <Input
                      id="bankName"
                      value={form.bankName}
                      onChange={(event) => set('bankName')(event.target.value)}
                    />
                  </Field>
                  <Field label="Bank" htmlFor="bankInstitution">
                    <Input
                      id="bankInstitution"
                      value={form.bankInstitution}
                      onChange={(event) => set('bankInstitution')(event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Last 4 digits only"
                    htmlFor="last4"
                    hint="Never the full account number."
                    error={fieldError('openingBank.accountNumberLast4')}
                  >
                    <Input
                      id="last4"
                      inputMode="numeric"
                      maxLength={4}
                      pattern="\d{4}"
                      value={form.last4}
                      onChange={(event) => set('last4')(event.target.value.replace(/\D/g, ''))}
                    />
                  </Field>
                  <Field
                    label="Opening balance"
                    htmlFor="openingBalance"
                    hint="The balance on the day you start."
                  >
                    <MoneyInput
                      id="openingBalance"
                      allowNegative
                      value={form.openingBalance}
                      onChange={(value) => set('openingBalance')(value)}
                    />
                  </Field>
                </>
              ) : null}
            </CardContent>
          </Card>

          <ErrorAlert error={error} />
          <div className="flex justify-end">
            <Button type="submit" size="lg" loading={busy}>
              Set up accounting
            </Button>
          </div>
        </form>
      </div>
    </Container>
  );
}
