'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Radio, ShieldCheck, TrendingUp } from 'lucide-react';
import type { AuctionDetail, AuctionEvent, BidSummary } from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { cn, formatEnum, formatKm, formatPrice, formatRelativeTime } from '@/lib/utils';
import { useHasPermission, useUser } from '@/store/auth-store';
import { useAuctionSocket } from '@/hooks/use-auction-socket';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Field,
  Input,
  Spinner,
} from '@/components/ui';
import { AuctionCountdown } from '@/components/auction-countdown';
import { VehicleGallery } from '@/components/vehicle-gallery';

export function AuctionRoom({ auctionId }: { auctionId: string }) {
  const user = useUser();
  const canBid = useHasPermission('bid:place');
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [flash, setFlash] = useState(false);

  const queryKey = ['auction', auctionId];

  const {
    data: auction,
    isPending,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => api.get<AuctionDetail>(`/auctions/${auctionId}`),
    // A slow poll backs up the socket, so a dropped connection degrades
    // freshness rather than leaving the page frozen on stale data.
    refetchInterval: 20_000,
  });

  const handleEvent = useCallback(
    (event: AuctionEvent) => {
      // The event carries the new state, but refetching keeps one source of
      // truth for the whole page rather than patching a partial cache entry.
      void queryClient.invalidateQueries({ queryKey });
      if (event.type === 'BID_PLACED' || event.type === 'AUCTION_EXTENDED') {
        setFlash(true);
        window.setTimeout(() => setFlash(false), 900);
      }
    },
    // queryKey is derived from auctionId, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auctionId, queryClient],
  );

  const { connected } = useAuctionSocket(auctionId, handleEvent);

  // Prefill the bid box with the smallest legal bid, and keep it in step as
  // the price moves — but never overwrite what the user is typing.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (auction && !touched) setAmount(String(auction.minimumNextBidCad));
  }, [auction, touched]);

  const placeBid = useMutation({
    mutationFn: (amountCad: number) =>
      api.post<{ bid: BidSummary; auction: AuctionDetail }>(`/auctions/${auctionId}/bids`, {
        amountCad,
      }),
    onSuccess: () => {
      setTouched(false);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (isPending) return <Spinner label="Loading auction" />;

  if (error || !auction) {
    return (
      <div className="container py-16">
        <Card>
          <CardContent className="pt-6 text-center">
            <h1 className="text-xl font-semibold">Auction not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have been cancelled or removed.
            </p>
            <Link href="/auctions" className="mt-4 inline-block">
              <Button variant="outline">Back to auctions</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const vehicle = auction.vehicle;
  const isLive = auction.status === 'LIVE' && auction.secondsRemaining > 0;
  const conflictError =
    placeBid.error instanceof ApiError && placeBid.error.status === 409 ? placeBid.error : null;

  return (
    <div className="container py-8">
      <nav className="mb-4 text-sm" aria-label="Breadcrumb">
        <Link href="/auctions" className="text-muted-foreground hover:text-foreground">
          ← All auctions
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle as="h1" className="text-2xl">
                    {auction.title}
                  </CardTitle>
                  {vehicle ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatKm(vehicle.mileageKm)} · {formatEnum(vehicle.transmission)} ·{' '}
                      {formatEnum(vehicle.fuelType)} · {vehicle.city}, {vehicle.province}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isLive ? (
                    <Badge variant="destructive">
                      <Radio className="h-3 w-3 animate-pulse" aria-hidden />
                      Live
                    </Badge>
                  ) : (
                    <Badge variant="outline">{formatEnum(auction.status)}</Badge>
                  )}
                  {vehicle?.hasInspection ? (
                    <Badge variant="success">
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      Inspected
                    </Badge>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {vehicle ? (
                <VehicleGallery
                  images={
                    vehicle.primaryImageUrl
                      ? [
                          {
                            id: 'primary',
                            url: vehicle.primaryImageUrl,
                            alt: vehicle.title,
                            position: 0,
                            optimized: vehicle.primaryImage,
                          },
                        ]
                      : []
                  }
                  title={auction.title}
                />
              ) : null}
              {vehicle ? (
                <Link
                  href={`/vehicles/${vehicle.slug}`}
                  className="mt-4 inline-block text-sm text-primary hover:underline"
                >
                  View full vehicle details and inspection report
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" aria-hidden />
                Bid history
              </CardTitle>
            </CardHeader>
            <CardContent>
              {auction.recentBids.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bids yet. The opening bid is {formatPrice(auction.startingBidCad)}.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {auction.recentBids.map((bid, index) => (
                    <li
                      key={bid.id}
                      className={cn(
                        'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                        index === 0 ? 'border-primary/40 bg-primary/5' : 'border-border',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{bid.isOwn ? 'You' : bid.bidderHandle}</span>
                        {index === 0 ? <Badge variant="primary">Leading</Badge> : null}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular font-semibold">{formatPrice(bid.amountCad)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(bid.placedAt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {/* Identities are pseudonymous by design, so watchers can follow a
                  bidding war without learning who is in it. */}
              <p className="mt-3 text-xs text-muted-foreground">
                Bidder identities are anonymised. Your own bids are labelled “You”.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card className={cn('transition-colors', flash && 'border-primary')}>
            <CardContent className="pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {auction.bidCount > 0 ? 'Current bid' : 'Opening bid'}
              </p>
              <p
                className={cn(
                  'tabular text-4xl font-bold transition-colors',
                  flash ? 'text-warning' : 'text-primary',
                )}
                aria-live="polite"
              >
                {formatPrice(auction.currentBidCad)}
              </p>
              <p className="tabular mt-1 text-sm text-muted-foreground">
                {auction.bidCount} {auction.bidCount === 1 ? 'bid' : 'bids'}
                {auction.hasReserve
                  ? auction.reserveMet
                    ? ' · reserve met'
                    : ' · reserve not met'
                  : ' · no reserve'}
              </p>

              <AuctionCountdown
                className="mt-4"
                endsAt={auction.endsAt}
                initialSeconds={auction.secondsRemaining}
              />

              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full',
                    connected ? 'bg-success' : 'bg-muted-foreground',
                  )}
                  aria-hidden
                />
                {connected ? 'Live updates connected' : 'Reconnecting — prices refresh on a timer'}
              </p>

              <hr className="my-4 border-border" />

              {!user ? (
                <Link href="/login">
                  <Button className="w-full">Sign in to bid</Button>
                </Link>
              ) : !canBid ? (
                // Administrators and inspectors hold no `bid:place`: the people
                // running the marketplace and the people grading the cars do not
                // bid in it. The API refuses them, so offering the form here
                // would only produce a 403 on submit.
                <p className="text-sm text-muted-foreground">
                  This account cannot place bids. Sign in with a buyer or seller account to bid.
                </p>
              ) : !isLive ? (
                <p className="text-sm text-muted-foreground">
                  {auction.status === 'ENDED' || auction.secondsRemaining === 0
                    ? 'This auction has closed.'
                    : 'This auction is not accepting bids yet.'}
                </p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    placeBid.mutate(Number(amount));
                  }}
                >
                  <Field
                    label="Your bid (CAD)"
                    htmlFor="bid-amount"
                    hint={`Minimum ${formatPrice(auction.minimumNextBidCad)}`}
                    error={
                      placeBid.error instanceof ApiError && !conflictError
                        ? placeBid.error.message
                        : undefined
                    }
                  >
                    <Input
                      id="bid-amount"
                      type="number"
                      inputMode="numeric"
                      min={auction.minimumNextBidCad}
                      step={100}
                      value={amount}
                      onChange={(event) => {
                        setTouched(true);
                        setAmount(event.target.value);
                      }}
                      required
                    />
                  </Field>

                  {conflictError ? (
                    <div
                      role="alert"
                      className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
                    >
                      {conflictError.message}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    className="mt-3 w-full"
                    size="lg"
                    loading={placeBid.isPending}
                    disabled={Number(amount) < auction.minimumNextBidCad}
                  >
                    <Gavel className="h-4 w-4" aria-hidden />
                    Place bid
                  </Button>

                  {auction.buyNowPriceCad ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 w-full"
                      loading={placeBid.isPending}
                      onClick={() => placeBid.mutate(auction.buyNowPriceCad!)}
                    >
                      Buy now for {formatPrice(auction.buyNowPriceCad)}
                    </Button>
                  ) : null}

                  <p className="mt-3 text-xs text-muted-foreground">
                    Bids are binding. A bid in the final two minutes extends the auction by two
                    minutes.
                  </p>
                </form>
              )}

              {auction.viewerBid ? (
                <div className="mt-4 rounded-md border border-border bg-secondary/50 p-3 text-sm">
                  <p className="font-medium">
                    Your highest bid: {formatPrice(auction.viewerBid.highestAmountCad)}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {auction.viewerBid.isWinning
                      ? 'You are currently the leading bidder.'
                      : `Status: ${formatEnum(auction.viewerBid.status)}`}
                  </p>
                </div>
              ) : null}

              <ErrorAlert error={conflictError ? null : placeBid.error} className="mt-3" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
