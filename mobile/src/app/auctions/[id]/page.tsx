'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Radio, TriangleAlert } from 'lucide-react';
import type { AuctionEvent } from '@vintrax/shared';
import { ApiError } from '@/lib/api-client';
import { vintrax } from '@/lib/vintrax';
import { keys, useAuction, useAuctionBids } from '@/lib/queries';
import { isSubmittableBid, quickBidLadder } from '@/lib/bidding';
import { useAuctionSocket } from '@/hooks/use-auction-socket';
import { useUser } from '@/store/session';
import { useOnline } from '@/components/connectivity';
import { cn, formatPrice, formatRelativeTime } from '@/lib/format';
import { Badge, Button, Card, Spinner, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { Countdown } from '@/components/countdown';
import { ErrorState } from '@/components/error-state';

/**
 * The live auction room.
 *
 * Updates arrive over the shared WebSocket, but the bid itself goes over HTTP
 * so it gets the same validation, rate limiting and serializable transaction
 * as every other write. That is why a 409 here is a real outcome and not an
 * error to hide: it means someone else's bid committed first.
 */
export default function AuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const user = useUser();
  const online = useOnline();
  const queryClient = useQueryClient();

  const auctionQuery = useAuction(id);
  const bidsQuery = useAuctionBids(id);

  const [flash, setFlash] = useState(false);
  const [amount, setAmount] = useState('');
  const [bidError, setBidError] = useState<Error | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onEvent = useCallback(
    (event: AuctionEvent) => {
      if (event.auctionId !== id) return;
      // The socket carries the new state, but the detail response has more of
      // it — refetching keeps one source of truth rather than patching a
      // partial payload into the cache.
      void queryClient.invalidateQueries({ queryKey: keys.auction(id) });
      void queryClient.invalidateQueries({ queryKey: keys.auctionBids(id) });
      setFlash(true);
    },
    [id, queryClient],
  );

  const { connected } = useAuctionSocket(id, onEvent);

  // A dropped socket must not mean a stale price in front of someone about to
  // bid, so a slow poll runs whenever the connection is down.
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: keys.auction(id) });
    }, 20_000);
    return () => clearInterval(timer);
  }, [connected, id, queryClient]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 1_000);
    return () => clearTimeout(timer);
  }, [flash]);

  const auction = auctionQuery.data;

  const quickBids = useMemo(() => (auction ? quickBidLadder(auction) : []), [auction]);

  if (auctionQuery.isPending) {
    return (
      <>
        <AppBar title="Auction" back />
        <Spinner label="Loading auction" />
      </>
    );
  }

  if (auctionQuery.isError || !auction) {
    return (
      <>
        <AppBar title="Auction" back />
        <ErrorState error={auctionQuery.error} onRetry={() => void auctionQuery.refetch()} />
      </>
    );
  }

  const isLive = auction.status === 'LIVE';
  const viewerWinning = auction.viewerBid?.isWinning ?? false;

  async function placeBid(value: number) {
    setSubmitting(true);
    setBidError(null);
    try {
      await vintrax.auctions.placeBid(auction!.id, value);
      setAmount('');
      await queryClient.invalidateQueries({ queryKey: keys.auction(auction!.id) });
      await queryClient.invalidateQueries({ queryKey: keys.auctionBids(auction!.id) });
    } catch (caught) {
      setBidError(caught instanceof Error ? caught : new Error('Bid failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppBar
        title={auction.title}
        back
        action={
          isLive ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium',
                connected ? 'text-success' : 'text-muted-foreground',
              )}
            >
              <Radio aria-hidden className={cn('h-3.5 w-3.5', connected && 'animate-pulse')} />
              {connected ? 'Live' : 'Reconnecting'}
            </span>
          ) : null
        }
      />

      <div className="space-y-4 p-4">
        <Card className={cn('space-y-3 p-4', flash && 'animate-flash-price')}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Current bid</p>
              <p className="text-3xl font-semibold tabular-nums">
                {formatPrice(auction.currentBidCad)}
              </p>
              <p className="text-xs text-muted-foreground">
                {auction.bidCount} bid{auction.bidCount === 1 ? '' : 's'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                {isLive ? 'Ends in' : formatStatus(auction.status)}
              </p>
              {isLive ? (
                <Countdown endsAt={auction.endsAt} className="text-lg font-medium" />
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {auction.hasReserve ? (
              <Badge tone={auction.reserveMet ? 'success' : 'neutral'}>
                {auction.reserveMet ? 'Reserve met' : 'Reserve not met'}
              </Badge>
            ) : (
              <Badge tone="neutral">No reserve</Badge>
            )}
            {viewerWinning ? <Badge tone="success">You are winning</Badge> : null}
            {auction.viewerBid && !viewerWinning ? (
              <Badge tone="warning">You have been outbid</Badge>
            ) : null}
          </div>

          {auction.vehicle ? (
            <Link
              href={`/vehicles/${auction.vehicle.slug}`}
              className="block text-sm font-medium text-primary"
            >
              View vehicle details
            </Link>
          ) : null}
        </Card>

        {isLive ? (
          user ? (
            <Card className="space-y-3 p-4">
              <h2 className="text-base font-semibold">Place a bid</h2>
              <p className="text-sm text-muted-foreground">
                Minimum next bid is {formatPrice(auction.minimumNextBidCad)}.
              </p>

              <div className="grid grid-cols-3 gap-2">
                {quickBids.map((value) => (
                  <Button
                    key={value}
                    variant="outline"
                    size="large"
                    disabled={submitting || !online}
                    onClick={() => void placeBid(value)}
                  >
                    {formatPrice(value)}
                  </Button>
                ))}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isSubmittableBid(amount, auction)) void placeBid(Number(amount));
                }}
                className="flex gap-2"
              >
                <label htmlFor="bid-amount" className="sr-only">
                  Custom bid amount in Canadian dollars
                </label>
                <input
                  id="bid-amount"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Other amount"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))}
                  className="min-h-touch flex-1 rounded-lg border border-input bg-background px-3 text-base tabular-nums"
                />
                <Button
                  type="submit"
                  size="large"
                  loading={submitting}
                  disabled={!online || !isSubmittableBid(amount, auction)}
                >
                  Bid
                </Button>
              </form>

              {!online ? (
                <p role="status" className="text-sm font-medium text-warning">
                  You are offline. Bids cannot be placed until the connection returns.
                </p>
              ) : null}

              {bidError ? <BidError error={bidError} /> : null}
            </Card>
          ) : (
            <StateMessage
              title="Sign in to bid"
              action={
                <Button onClick={() => router.push(`/login?next=/auctions/${auction.id}`)}>
                  Sign in
                </Button>
              }
            />
          )
        ) : null}

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Bid history</h2>
          {bidsQuery.isPending ? (
            <Spinner label="Loading bids" />
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {(bidsQuery.data?.items ?? []).map((bid) => (
                  <li key={bid.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{bid.isOwn ? 'You' : bid.bidderHandle}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(bid.placedAt)}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatPrice(bid.amountCad)}
                    </p>
                  </li>
                ))}
                {(bidsQuery.data?.items.length ?? 0) === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No bids yet — the first one starts at {formatPrice(auction.startingBidCad)}.
                  </li>
                ) : null}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * A 409 is not a failure to apologise for — it means another bid committed
 * first, which is exactly what the serializable transaction is there to
 * guarantee. It gets its own treatment so the bidder knows to look at the new
 * price rather than assume the app broke.
 */
function BidError({ error }: { error: Error }) {
  const conflict = error instanceof ApiError && error.status === 409;

  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg p-3 text-sm font-medium',
        conflict ? 'bg-warning/15 text-warning' : 'bg-destructive/10 text-destructive',
      )}
    >
      <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      {conflict
        ? 'Another bid landed at the same moment. The price above is current — bid again if you still want it.'
        : error.message}
    </p>
  );
}

function formatStatus(status: string): string {
  switch (status) {
    case 'SCHEDULED':
      return 'Not started';
    case 'ENDED':
      return 'Ended';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}
