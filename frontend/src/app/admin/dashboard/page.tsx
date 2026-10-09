'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Car,
  DollarSign,
  Gavel,
  MessageSquareText,
  ShieldAlert,
  Users,
} from 'lucide-react';
import type { AdminAnalytics, AuditLogEntry, Paginated, ReviewMetrics } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';
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
import { SeriesChart } from '@/components/charts';
import { StatTile } from '@/components/stat-tile';
import { AdminNav } from '@/components/admin-nav';

function AdminDashboard() {
  const { data, isPending, error } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => api.get<AdminAnalytics>('/admin/analytics'),
  });

  // Its own small cached endpoint, so the platform analytics stay as they were.
  const { data: reviews } = useQuery({
    queryKey: ['admin-reviews-metrics'],
    queryFn: () => api.get<ReviewMetrics>('/admin/reviews/metrics'),
  });

  const { data: audit } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api.get<Paginated<AuditLogEntry>>('/admin/audit-logs?page=1&pageSize=12'),
  });

  if (isPending) return <Spinner label="Loading platform metrics" />;

  return (
    <div className="container py-8">
      <AdminNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Platform overview</h1>
        <p className="mt-1 text-muted-foreground">Marketplace health over the last 30 days.</p>
      </div>

      <ErrorAlert error={error} className="mb-5" />

      {/* Every tile but one goes somewhere. A number an administrator is meant
          to act on is a dead end without a destination, and the two that had
          none — pending dealers and listings awaiting review — were exactly
          the two that needed acting on. "Sold this month" has no matching
          page to link to; it is read only. */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatTile
          label="Total users"
          value={data?.totalUsers ?? 0}
          hint={`+${data?.newUsersThisMonth ?? 0} this month`}
          icon={Users}
          href="/admin/users"
        />
        <StatTile
          label="Active listings"
          value={data?.activeListings ?? 0}
          hint="Browse the marketplace"
          icon={Car}
          href="/vehicles"
        />
        <StatTile
          label="Live auctions"
          value={data?.liveAuctions ?? 0}
          hint="Watch the floor"
          icon={Gavel}
          href="/auctions"
        />
        <StatTile
          label="Pending dealers"
          value={data?.pendingDealers ?? 0}
          hint="Awaiting verification"
          icon={Building2}
          href="/admin/dealers"
        />
        <StatTile
          label="Awaiting review"
          value={data?.listingsPendingReview ?? 0}
          hint="Listings to moderate"
          icon={ShieldAlert}
          href="/admin/moderation"
        />
        <StatTile
          label="Reviews to approve"
          value={reviews?.pending ?? 0}
          hint={reviews?.reported ? `${reviews.reported} reported` : 'Vehicle reviews'}
          icon={MessageSquareText}
          href="/admin/reviews"
        />
        <StatTile
          label="Sold this month"
          value={data?.vehiclesSoldThisMonth ?? 0}
          hint="Vehicles marked sold"
          icon={DollarSign}
        />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New users</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.usersSeries.length > 0 ? (
              <SeriesChart
                data={data.usersSeries}
                kind="line"
                tone="primary"
                height={230}
                allowDecimals={false}
              />
            ) : (
              <EmptyState title="No signups in this window" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Listings published</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.listingsSeries.length > 0 ? (
              <SeriesChart
                data={data.listingsSeries}
                kind="bar"
                tone="accent"
                height={230}
                allowDecimals={false}
              />
            ) : (
              <EmptyState title="No listings in this window" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent audit trail</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {audit && audit.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Recent audited actions</caption>
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      Action
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Entity
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Actor
                    </th>
                    <th scope="col" className="px-4 py-3">
                      When
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audit.items.map((entry) => (
                    <tr key={entry.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium">{entry.action}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{entry.entityType}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {entry.actorEmail ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {formatRelativeTime(entry.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No audited actions yet"
              description="Security- and money-relevant actions appear here."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <RequireAuth adminOnly>
      <AdminDashboard />
    </RequireAuth>
  );
}
