'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Gavel } from 'lucide-react';
import type { AuctionSummary } from '@atlas/shared';
import { formatPrice } from '@/lib/format';
import { Badge } from '@/components/ui';
import { Countdown } from '@/components/countdown';

/** One auction in a list: what it costs now, and how long is left. */
export function AuctionRow({ auction }: { auction: AuctionSummary }) {
  const vehicle = auction.vehicle;

  return (
    <Link
      href={`/auctions/${auction.id}`}
      className="flex gap-3 rounded-xl border border-border bg-card p-2.5 active:bg-secondary"
    >
      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
        {vehicle?.primaryImageUrl ? (
          <Image
            src={vehicle.primaryImageUrl}
            alt=""
            fill
            sizes="96px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Gavel aria-hidden className="h-5 w-5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate text-sm font-medium">{auction.title}</h3>
        <p className="text-lg font-semibold tabular-nums">{formatPrice(auction.currentBidCad)}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {auction.bidCount} bid{auction.bidCount === 1 ? '' : 's'}
          </span>
          <span aria-hidden>·</span>
          <Countdown endsAt={auction.endsAt} />
          {auction.hasReserve ? (
            <Badge tone={auction.reserveMet ? 'success' : 'neutral'}>
              {auction.reserveMet ? 'Reserve met' : 'Reserve not met'}
            </Badge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
