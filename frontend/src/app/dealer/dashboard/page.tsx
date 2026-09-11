'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Car, DollarSign, Eye, MessageSquare, Plus } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DealerAnalytics } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatCompact, formatPrice } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorAlert,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { StatTile } from '@/components/stat-tile';
import { VehicleCard } from '@/components/vehicle-card';

function DealerDashboard() {
  const user = useUser();

  const { data, isPending, error } = useQuery({
    queryKey: ['dealer-analytics'],
    queryFn: () => api.get<DealerAnalytics>('/dealers/analytics/me'),
  });

  if (isPending) return <Spinner label="Loading dashboard" />;

  return (
    <div className="container py-8">
      <DashboardNav />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {user?.dealer?.name ?? 'Seller dashboard'}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {user?.dealer && !user.dealer.verified
              ? 'Your dealership is awaiting verification. You can prepare listings in the meantime.'
              : 'Inventory performance over the last 30 days.'}
          </p>
        </div>
        <Link href="/dealer/add-vehicle">
          <Button>
            <Plus className="h-4 w-4" aria-hidden />
            Add vehicle
          </Button>
        </Link>
      </div>

      <ErrorAlert error={error} className="mb-5" />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Active listings"
          value={data?.activeListings ?? 0}
          hint={`${data?.draftListings ?? 0} drafts`}
          icon={Car}
          href="/dealer/inventory"
        />
        <StatTile
          label="Sold this month"
          value={data?.soldThisMonth ?? 0}
          hint="Your sales"
          icon={DollarSign}
          href="/dashboard/purchases"
        />
        <StatTile
          label="Gross sales"
          value={formatPrice(data?.grossSalesCadThisMonth ?? 0)}
          hint="This month"
          icon={DollarSign}
        />
        <StatTile
          label="Total views"
          value={formatCompact(data?.totalViews ?? 0)}
          hint={`${data?.totalEnquiries ?? 0} enquiries`}
          icon={Eye}
          href="/dashboard/messages"
        />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Listings published</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.viewsSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.viewsSeries}>
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
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      color: 'hsl(var(--popover-foreground))',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary) / 0.18)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="No activity yet"
                description="Publish a listing to start collecting data."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.salesSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.salesSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    formatter={(value: number) => formatPrice(value)}
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      color: 'hsl(var(--popover-foreground))',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--accent))"
                    fill="hsl(var(--accent) / 0.18)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="No sales yet" description="Completed sales appear here." />
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Most viewed inventory</h2>
          <Link href="/dealer/inventory" className="text-sm text-primary hover:underline">
            Manage inventory
          </Link>
        </div>
        {data && data.topVehicles.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {data.topVehicles.map((entry) => (
              <VehicleCard key={entry.vehicle.id} vehicle={entry.vehicle} showStatus />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<MessageSquare className="h-8 w-8" aria-hidden />}
              title="No published inventory"
              description="Add your first vehicle to start selling."
              action={
                <Link href="/dealer/add-vehicle">
                  <Button>Add vehicle</Button>
                </Link>
              }
            />
          </Card>
        )}
      </div>
    </div>
  );
}

export default function DealerDashboardPage() {
  return (
    <RequireAuth sellersOnly>
      <DealerDashboard />
    </RequireAuth>
  );
}
