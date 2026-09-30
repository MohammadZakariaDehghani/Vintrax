'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Mail, Search } from 'lucide-react';
import {
  CREDIT_RANGE_LABELS,
  FINANCE_APPLICATION_STATUSES,
  FINANCE_APPLICATION_STATUS_LABELS,
  type FinanceApplicationPage,
  type FinanceApplicationStatus,
  type FinanceSettings,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatPrice, formatRelativeTime } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Pagination,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { DealerNav } from '@/components/dealer-nav';
import { FINANCE_STATUS_VARIANT } from './status';

/** Where new applications are emailed, and whether listings take them at all. */
function FinanceSettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['finance-settings'],
    queryFn: () => api.get<FinanceSettings>('/dealer/finance-settings'),
  });
  const [email, setEmail] = useState('');
  const [accept, setAccept] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setEmail(settings.data.notificationEmail ?? '');
    setAccept(settings.data.acceptApplications);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<FinanceSettings>('/dealer/finance-settings', {
        acceptApplications: accept,
        notificationEmail: email.trim() || null,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['finance-settings'], next);
      setSaved(true);
    },
  });

  return (
    <Card className="mb-6">
      <CardContent className="pt-5">
        <form
          className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Send new applications to"
              htmlFor="finance-email"
              hint={
                settings.data
                  ? `Leave empty to use your account email (${settings.data.effectiveEmail}).`
                  : undefined
              }
            >
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="finance-email"
                  type="email"
                  className="pl-9"
                  placeholder={settings.data?.effectiveEmail ?? 'finance@yourdealership.ca'}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setSaved(false);
                  }}
                />
              </div>
            </Field>
            <label className="flex items-center gap-3 self-center text-sm sm:mt-6">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={accept}
                onChange={(event) => {
                  setAccept(event.target.checked);
                  setSaved(false);
                }}
              />
              <span>
                <span className="font-medium">Take finance applications on my listings</span>
                <span className="block text-xs text-muted-foreground">
                  Off: buyers see only “Send message”.
                </span>
              </span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            {saved ? <span className="text-sm text-success">Saved</span> : null}
            <Button type="submit" loading={save.isPending} disabled={!settings.data}>
              Save settings
            </Button>
          </div>
        </form>
        <ErrorAlert error={save.error ?? settings.error} className="mt-3" />
      </CardContent>
    </Card>
  );
}

function FinanceApplications() {
  const [status, setStatus] = useState<FinanceApplicationStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status !== 'ALL') query.set('status', status);
  if (search) query.set('q', search);

  const { data, isPending, error } = useQuery({
    queryKey: ['finance-applications', query.toString()],
    queryFn: () =>
      api.get<FinanceApplicationPage>(`/dealer/finance-applications?${query.toString()}`),
    placeholderData: (previous) => previous,
  });

  const counts = data?.counts;
  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null;
  const items = data?.items ?? [];

  return (
    <div className="container py-8">
      <DashboardNav />
      <DealerNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Finance applications</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Buyers who asked you to arrange financing on one of your listings. Only you can see these;
          work through them here and keep notes as you go.
        </p>
      </div>

      <FinanceSettingsCard />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {(['ALL', ...FINANCE_APPLICATION_STATUSES] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === status}
            onClick={() => {
              setStatus(entry);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              entry === status
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry === 'ALL' ? 'All' : FINANCE_APPLICATION_STATUS_LABELS[entry]}
            <span className="ml-1.5 tabular text-xs">
              {entry === 'ALL' ? (total ?? '') : (counts?.[entry] ?? '')}
            </span>
          </button>
        ))}
      </div>

      <div className="relative mb-4 max-w-xl">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          className="pl-9"
          placeholder="Search by name, email, phone, vehicle, stock # or VIN"
          aria-label="Search applications"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </div>

      <ErrorAlert error={error} className="mb-4" />

      {isPending ? (
        <Spinner label="Loading applications" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Landmark className="h-8 w-8" aria-hidden />}
            title={search ? `Nothing matches "${search}"` : 'No finance applications yet'}
            description="When a buyer applies for financing from one of your listings, it appears here and you get an email."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Applicant</th>
                  <th className="px-4 py-3 font-medium">Vehicle</th>
                  <th className="px-4 py-3 font-medium">Credit</th>
                  <th className="px-4 py-3 text-right font-medium">Income / yr</th>
                  <th className="px-4 py-3 text-right font-medium">Down</th>
                  <th className="px-4 py-3 font-medium">Received</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.id} className="relative hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dealer/finance/${item.id}`}
                        className="font-semibold after:absolute after:inset-0 hover:text-primary"
                      >
                        {item.firstName} {item.lastName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{item.phone}</p>
                    </td>
                    <td className="max-w-[16rem] px-4 py-3">
                      <p className="truncate">{item.vehicle.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.vehicle.stockNumber ? `Stock ${item.vehicle.stockNumber} · ` : ''}
                        {formatPrice(item.vehicle.priceCad)}
                        {item.hasTradeIn ? ' · Trade-in' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">{CREDIT_RANGE_LABELS[item.creditRange].label}</td>
                    <td className="tabular px-4 py-3 text-right">
                      {formatPrice(item.annualIncomeCad)}
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {formatPrice(item.downPaymentCad)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatRelativeTime(item.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={FINANCE_STATUS_VARIANT[item.status]}>
                        {FINANCE_APPLICATION_STATUS_LABELS[item.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Pagination page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
    </div>
  );
}

export default function DealerFinancePage() {
  return (
    <RequireAuth sellersOnly>
      <FinanceApplications />
    </RequireAuth>
  );
}
