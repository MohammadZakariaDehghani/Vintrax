'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Gavel, Heart, MessageSquare, ShoppingBag } from 'lucide-react';
import type {
  BidSummary,
  ConversationSummary,
  Paginated,
  TransactionSummary,
  VehicleSummary,
} from '@atlas/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatPrice, formatRelativeTime } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { StatTile } from '@/components/stat-tile';
import { VehicleCard } from '@/components/vehicle-card';

function BuyerDashboard() {
  const user = useUser();

  const { data: favourites } = useQuery({
    queryKey: ['favourites', 1],
    queryFn: () => api.get<Paginated<VehicleSummary>>('/me/favourites?page=1&pageSize=4'),
  });

  const { data: bids } = useQuery({
    queryKey: ['my-bids', 1],
    queryFn: () => api.get<Paginated<BidSummary>>('/auctions/my-bids?page=1&pageSize=5'),
  });

  const { data: orders } = useQuery({
    queryKey: ['orders', 'buyer', 1],
    queryFn: () => api.get<Paginated<TransactionSummary>>('/orders?role=buyer&page=1&pageSize=5'),
  });

  const { data: conversations } = useQuery({
    queryKey: ['conversations', 1],
    queryFn: () => api.get<Paginated<ConversationSummary>>('/conversations?page=1&pageSize=1'),
  });

  if (!user) return <Spinner />;

  const winningBids = bids?.items.filter((bid) => bid.status === 'WINNING' || bid.status === 'WON').length ?? 0;

  return (
    <div className="container py-8">
      <DashboardNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back, {user.firstName}</h1>
        <p className="mt-1 text-muted-foreground">Your saved vehicles, bids and purchases.</p>
      </div>

      {!user.emailVerified ? (
        <Card className="mb-6 border-warning/40 bg-warning/10">
          <CardContent className="pt-5 text-sm">
            <p className="font-semibold text-warning">Verify your email address</p>
            <p className="mt-1 text-muted-foreground">
              Bidding and purchasing require a verified email. Check your inbox for the link — in
              development it is printed to the API log.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Saved vehicles" value={favourites?.total ?? 0} icon={Heart} href="/dashboard/favorites" />
        <StatTile label="Active bids" value={bids?.total ?? 0} hint={`${winningBids} leading`} icon={Gavel} href="/dashboard/my-bids" />
        <StatTile label="Purchases" value={orders?.total ?? 0} icon={ShoppingBag} href="/dashboard/purchases" />
        <StatTile label="Messages" value={conversations?.total ?? 0} hint="Conversations with sellers" icon={MessageSquare} href="/dashboard/messages" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent bids</CardTitle>
              <Link href="/dashboard/my-bids" className="text-sm text-primary hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {bids && bids.items.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {bids.items.map((bid) => (
                  <li key={bid.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <Link href={`/auctions/${bid.auctionId}`} className="text-primary hover:underline">
                      Auction {bid.auctionId.slice(0, 8)}
                    </Link>
                    <span className="flex items-center gap-3">
                      <span className="tabular font-semibold">{formatPrice(bid.amountCad)}</span>
                      <Badge variant={bid.status === 'WINNING' || bid.status === 'WON' ? 'success' : 'outline'}>
                        {formatEnum(bid.status)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No bids yet"
                description="Find a live auction and place your first bid."
                action={<Link href="/auctions"><Button variant="outline">Browse auctions</Button></Link>}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Purchases</CardTitle>
              <Link href="/dashboard/purchases" className="text-sm text-primary hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {orders && orders.items.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {orders.items.map((order) => (
                  <li key={order.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{order.reference}</span>
                      <Badge variant="outline">{formatEnum(order.status)}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {order.vehicle?.title} · {formatPrice(order.totalCad)} ·{' '}
                      {formatRelativeTime(order.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No purchases yet" description="Vehicles you buy will appear here." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Saved vehicles</h2>
          <Link href="/dashboard/favorites" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        {favourites && favourites.items.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {favourites.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<Heart className="h-8 w-8" aria-hidden />}
              title="Nothing saved yet"
              description="Tap the heart on any vehicle to save it here for later."
              action={<Link href="/vehicles"><Button variant="outline">Browse vehicles</Button></Link>}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <BuyerDashboard />
    </RequireAuth>
  );
}
