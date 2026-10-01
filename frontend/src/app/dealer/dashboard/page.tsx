'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Car, DollarSign, Eye, MessageSquare, Plus } from 'lucide-react';
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
import { DealerNav } from '@/components/dealer-nav';
import { SeriesChart } from '@/components/charts';
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
      <DealerNav />

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
              <SeriesChart
                data={data.viewsSeries}
                kind="area"
                tone="primary"
                height={220}
                allowDecimals={false}
              />
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
              <SeriesChart
                data={data.salesSeries}
                kind="area"
                tone="accent"
                height={220}
                formatValue={formatPrice}
              />
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
    <RequireAuth sellersOnly dealersOnly>
      <DealerDashboard />
    </RequireAuth>
  );
}
