'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMyBids } from '@/lib/queries';
import { formatPrice, formatRelativeTime } from '@/lib/format';
import { Badge, Button, Card, Skeleton, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState } from '@/components/error-state';

export default function MyBidsPage() {
  return (
    <>
      <AppBar title="My bids" back />
      <RequireAuth>
        <BidList />
      </RequireAuth>
    </>
  );
}

function BidList() {
  const router = useRouter();
  const bids = useMyBids();
  const items = bids.data?.items ?? [];

  if (bids.isPending) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (bids.isError) return <ErrorState error={bids.error} onRetry={() => void bids.refetch()} />;

  if (items.length === 0) {
    return (
      <StateMessage
        title="No bids yet"
        description="Bids you place appear here with their current standing."
        action={<Button onClick={() => router.push('/auctions')}>See live auctions</Button>}
      />
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {items.map((bid) => (
        <li key={bid.id}>
          <Link href={`/auctions/${bid.auctionId}`} className="block active:opacity-90">
            <Card className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold tabular-nums">{formatPrice(bid.amountCad)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(bid.placedAt)}
                </p>
              </div>
              <Badge tone={toneFor(bid.status)}>{label(bid.status)}</Badge>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function toneFor(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'WINNING' || status === 'WON') return 'success';
  if (status === 'OUTBID') return 'warning';
  return 'neutral';
}

function label(status: string): string {
  switch (status) {
    case 'WINNING':
      return 'Winning';
    case 'OUTBID':
      return 'Outbid';
    case 'WON':
      return 'Won';
    case 'LOST':
      return 'Lost';
    default:
      return status;
  }
}
