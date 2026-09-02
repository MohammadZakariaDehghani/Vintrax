'use client';

import { useState } from 'react';
import { useAuctions } from '@/lib/queries';
import { cn } from '@/lib/format';
import { Button, Skeleton, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { AuctionRow } from '@/components/auction-row';
import { ErrorState } from '@/components/error-state';

const TABS = [
  { value: 'LIVE', label: 'Live' },
  { value: 'SCHEDULED', label: 'Upcoming' },
  { value: 'ENDED', label: 'Ended' },
] as const;

export default function AuctionsPage() {
  const [status, setStatus] = useState<string>('LIVE');
  const auctions = useAuctions(status);
  const items = auctions.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <AppBar title="Auctions" />

      <div
        role="tablist"
        aria-label="Auction status"
        className="sticky top-0 z-20 flex gap-1 border-b border-border bg-card px-3 py-2"
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => setStatus(tab.value)}
            className={cn(
              'min-h-touch flex-1 rounded-lg px-3 text-sm font-medium',
              status === tab.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-2 p-3">
        {auctions.isPending ? (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        ) : auctions.isError ? (
          <ErrorState error={auctions.error} onRetry={() => void auctions.refetch()} />
        ) : items.length === 0 ? (
          <StateMessage
            title={status === 'LIVE' ? 'No auctions running' : 'Nothing here yet'}
            description={
              status === 'LIVE'
                ? 'Check the upcoming tab for auctions that have not started.'
                : undefined
            }
          />
        ) : (
          <>
            {items.map((auction) => (
              <AuctionRow key={auction.id} auction={auction} />
            ))}
            {auctions.hasNextPage ? (
              <Button
                variant="outline"
                fullWidth
                size="large"
                loading={auctions.isFetchingNextPage}
                onClick={() => void auctions.fetchNextPage()}
              >
                Load more
              </Button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
