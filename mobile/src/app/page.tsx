'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Gavel, Heart, MessageSquare, Plus, Search } from 'lucide-react';
import { useAuctions, useVehicleSearch } from '@/lib/queries';
import { useIsSeller, useUser } from '@/store/session';
import { Button, Card, Skeleton } from '@/components/ui';
import { VehicleCard, VehicleCardSkeleton } from '@/components/vehicle-card';
import { AuctionRow } from '@/components/auction-row';

/**
 * The home screen.
 *
 * One search field, the quick actions worth a tap, live auctions, then recent
 * inventory. Everything here comes from the platform's own APIs — nothing is
 * computed on the phone that the server did not report.
 */
export default function HomePage() {
  const router = useRouter();
  const user = useUser();
  const isSeller = useIsSeller();
  const [term, setTerm] = useState('');

  const auctions = useAuctions('LIVE');
  const recent = useVehicleSearch('?sort=NEWEST&pageSize=6');

  const liveAuctions = auctions.data?.pages[0]?.items.slice(0, 3) ?? [];
  const recentVehicles = recent.data?.pages[0]?.items.slice(0, 6) ?? [];

  return (
    <div className="space-y-6 pb-6">
      <section
        className="bg-primary px-4 pb-5 pt-4 text-primary-foreground"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
      >
        <p className="text-sm opacity-90">{user ? `Hello, ${user.firstName}` : 'Vintrax'}</p>
        <h1 className="mb-3 text-xl font-semibold">Find your next vehicle</h1>

        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const query = term.trim();
            router.push(query ? `/browse?q=${encodeURIComponent(query)}` : '/browse');
          }}
        >
          <label htmlFor="home-search" className="sr-only">
            Search vehicles
          </label>
          <div className="flex items-center gap-2 rounded-xl bg-background px-3 text-foreground">
            <Search aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              id="home-search"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Make, model or keyword"
              className="min-h-touch w-full bg-transparent py-3 text-base outline-none"
            />
          </div>
        </form>
      </section>

      <section className="px-4">
        <h2 className="sr-only">Quick actions</h2>
        <div className="grid grid-cols-3 gap-2">
          <QuickAction href="/auctions" icon={Gavel} label="Auctions" />
          <QuickAction href="/saved" icon={Heart} label="Saved" />
          {isSeller ? (
            <QuickAction href="/dealer/inventory/new" icon={Plus} label="Add vehicle" />
          ) : (
            <QuickAction href="/messages" icon={MessageSquare} label="Messages" />
          )}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading title="Live auctions" href="/auctions" />
        <div className="space-y-2 px-4">
          {auctions.isPending ? (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </>
          ) : liveAuctions.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              No auctions are running right now.
            </Card>
          ) : (
            liveAuctions.map((auction) => <AuctionRow key={auction.id} auction={auction} />)
          )}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading title="Recently listed" href="/browse" />
        <div className="grid grid-cols-2 gap-3 px-4">
          {recent.isPending ? (
            <>
              <VehicleCardSkeleton />
              <VehicleCardSkeleton />
            </>
          ) : (
            recentVehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)
          )}
        </div>
      </section>

      {!user ? (
        <section className="px-4">
          <Card className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">
              Sign in to save vehicles, message sellers and bid in live auctions.
            </p>
            <div className="flex gap-2">
              <Button fullWidth onClick={() => router.push('/login')}>
                Sign in
              </Button>
              <Button variant="outline" fullWidth onClick={() => router.push('/register')}>
                Create account
              </Button>
            </div>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Gavel;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-touch flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-xs font-medium active:bg-secondary"
    >
      <Icon aria-hidden className="h-5 w-5 text-primary" />
      {label}
    </Link>
  );
}

function SectionHeading({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between px-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <Link
        href={href}
        className="inline-flex min-h-touch items-center gap-1 text-sm font-medium text-primary"
      >
        See all
        <ArrowRight aria-hidden className="h-4 w-4" />
      </Link>
    </div>
  );
}
