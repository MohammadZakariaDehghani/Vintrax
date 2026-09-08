'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AdminAnalytics } from '@atlas/shared';
import { PLATFORM_FEE_MAX, PLATFORM_FEE_MIN, PLATFORM_FEE_RATE } from '@atlas/shared';
import { api } from '@/lib/api-client';
import { formatPrice } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorAlert,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--popover-foreground))',
};

function Revenue() {
  const { data, isPending, error } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => api.get<AdminAnalytics>('/admin/analytics'),
  });

  if (isPending) return <Spinner label="Loading revenue" />;

  const gmv = data?.grossMerchandiseValueCad ?? 0;
  const revenue = data?.platformRevenueCad ?? 0;
  const take = gmv > 0 ? (revenue / gmv) * 100 : 0;

  return (
    <div className="container py-8">
      <AdminNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Revenue</h1>
        <p className="mt-1 text-muted-foreground">
          Completed sales over the last 30 days. Atlas records payments rather than processing
          them, so these are settled orders, not cleared funds.
        </p>
      </div>

      <ErrorAlert error={error} className="mb-5" />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Gross merchandise value
            </p>
            <p className="tabular mt-1 text-2xl font-bold">{formatPrice(gmv)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">What buyers paid sellers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Platform revenue
            </p>
            <p className="tabular mt-1 text-2xl font-bold">{formatPrice(revenue)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Fees Atlas kept</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Effective take rate
            </p>
            <p className="tabular mt-1 text-2xl font-bold">{take.toFixed(1)}%</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Nominal {(PLATFORM_FEE_RATE * 100).toFixed(0)}%, floored at{' '}
              {formatPrice(PLATFORM_FEE_MIN)} and capped at {formatPrice(PLATFORM_FEE_MAX)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales</CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.salesSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.salesSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                  allowDecimals={false}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              title="No completed sales in this window"
              description="A sale counts once its order is marked complete."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminRevenuePage() {
  return (
    <RequireAuth adminOnly>
      <Revenue />
    </RequireAuth>
  );
}
