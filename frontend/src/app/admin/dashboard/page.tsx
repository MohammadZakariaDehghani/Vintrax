'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Car, DollarSign, Gavel, ShieldAlert, Users } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AdminAnalytics, AuditLogEntry, Paginated } from '@vintrax/shared';
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
import { StatTile } from '@/components/stat-tile';
import { AdminNav } from '@/components/admin-nav';

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--popover-foreground))',
};

function AdminDashboard() {
  const { data, isPending, error } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => api.get<AdminAnalytics>('/admin/analytics'),
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
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={data.usersSeries}>
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
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={data.listingsSeries}>
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
                  <Bar dataKey="value" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
                    <td className="px-4 py-2.5 text-muted-foreground">{entry.actorEmail ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatRelativeTime(entry.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
