'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import type { AuctionSummary, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatPrice } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Pagination,
  Select,
} from '@/components/ui';
import { VehicleCardSkeleton } from '@/components/vehicle-card';
import { AuctionCountdown } from '@/components/auction-countdown';

const STATUS_TABS = [
  { label: 'Live now', value: 'LIVE' },
  { label: 'Upcoming', value: 'SCHEDULED' },
  { label: 'Ended', value: 'ENDED' },
];

function AuctionsContent() {
  const [status, setStatus] = useState('LIVE');
  const [sort, setSort] = useState('ENDING_SOON');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ status, sort, page: String(page), pageSize: '24' });

  const { data, isPending, error } = useQuery({
    queryKey: ['auctions', status, sort, page],
    queryFn: () => api.get<Paginated<AuctionSummary>>(`/auctions?${query.toString()}`),
    placeholderData: keepPreviousData,
    // Auction prices move; a browse list should not go stale for long.
    refetchInterval: 30_000,
  });

  return (
    <div className="container py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Auctions</h1>
        <p className="mt-1 text-muted-foreground">
          Bid on dealer and private inventory. Bids in the final two minutes extend the auction.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1" role="tablist">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                status === tab.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="auction-sort" className="text-sm text-muted-foreground">
            Sort
          </label>
          <Select
            id="auction-sort"
            className="w-auto"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="ENDING_SOON">Ending soonest</option>
            <option value="NEWEST">Newest</option>
            <option value="PRICE_ASC">Current bid: low to high</option>
            <option value="PRICE_DESC">Current bid: high to low</option>
          </Select>
        </div>
      </div>

      <ErrorAlert error={error} className="mb-5" />

      {isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <VehicleCardSkeleton key={index} />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((auction) => (
              <Card key={auction.id} className="overflow-hidden transition-shadow hover:shadow-md">
                <Link href={`/auctions/${auction.id}`}>
                  <div className="aspect-[4/3] bg-muted">
                    {auction.vehicle?.primaryImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={auction.vehicle.primaryImageUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                </Link>
                <CardContent className="pt-4">
                  <Link href={`/auctions/${auction.id}`} className="hover:text-primary">
                    <h2 className="line-clamp-2 font-semibold">{auction.title}</h2>
                  </Link>

                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Current bid
                      </p>
                      <p className="tabular text-xl font-bold text-primary">
                        {formatPrice(auction.currentBidCad)}
                      </p>
                      <p className="tabular mt-0.5 text-xs text-muted-foreground">
                        {auction.bidCount} {auction.bidCount === 1 ? 'bid' : 'bids'}
                      </p>
                    </div>
                    <AuctionCountdown
                      endsAt={auction.endsAt}
                      initialSeconds={auction.secondsRemaining}
                      compact
                    />
                  </div>

                  {auction.hasReserve ? (
                    <Badge variant={auction.reserveMet ? 'success' : 'warning'} className="mt-3">
                      {auction.reserveMet ? 'Reserve met' : 'Reserve not met'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="mt-3">
                      No reserve
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Gavel className="h-8 w-8" aria-hidden />}
            title="No auctions here yet"
            description="Nothing is running in this category right now. Browse the marketplace or check back soon."
            action={
              <Link href="/vehicles">
                <Button variant="outline">Browse vehicles</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function AuctionsPage() {
  return (
    <Suspense fallback={<div className="container py-16" />}>
      <AuctionsContent />
    </Suspense>
  );
}
