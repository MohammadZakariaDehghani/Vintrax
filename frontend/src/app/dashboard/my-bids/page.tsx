'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import type { BidSummary, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatPrice, formatRelativeTime } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Pagination,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';

const STATUS_VARIANT = {
  ACTIVE: 'outline',
  OUTBID: 'warning',
  WINNING: 'success',
  WON: 'success',
  LOST: 'default',
  RETRACTED: 'outline',
} as const;

function MyBids() {
  const [page, setPage] = useState(1);

  const { data, isPending, error } = useQuery({
    queryKey: ['my-bids', page],
    queryFn: () => api.get<Paginated<BidSummary>>(`/auctions/my-bids?page=${page}&pageSize=20`),
    refetchInterval: 30_000,
  });

  return (
    <div className="container py-8">
      <DashboardNav />

      <h1 className="mb-6 text-3xl font-bold tracking-tight">My bids</h1>
      <ErrorAlert error={error} className="mb-5" />

      {isPending ? (
        <Spinner />
      ) : data && data.items.length > 0 ? (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Your bid history</caption>
                  <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Auction
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Amount
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Placed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((bid) => (
                      <tr key={bid.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <Link
                            href={`/auctions/${bid.auctionId}`}
                            className="text-primary hover:underline"
                          >
                            {bid.auctionId.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="tabular px-4 py-3 font-semibold">
                          {formatPrice(bid.amountCad)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[bid.status]}>
                            {formatEnum(bid.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatRelativeTime(bid.placedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Gavel className="h-8 w-8" aria-hidden />}
            title="You have not bid yet"
            description="Find a live auction and place your first bid."
            action={
              <Link href="/auctions">
                <Button>Browse auctions</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function MyBidsPage() {
  return (
    <RequireAuth>
      <MyBids />
    </RequireAuth>
  );
}
