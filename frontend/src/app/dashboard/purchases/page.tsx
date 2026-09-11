'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag } from 'lucide-react';
import type { Paginated, TransactionSummary } from '@vintrax/shared';
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

function Purchases() {
  const [page, setPage] = useState(1);

  const { data, isPending, error } = useQuery({
    queryKey: ['orders', 'buyer', page],
    queryFn: () =>
      api.get<Paginated<TransactionSummary>>(`/orders?role=buyer&page=${page}&pageSize=20`),
  });

  return (
    <div className="container py-8">
      <DashboardNav />

      <h1 className="mb-6 text-3xl font-bold tracking-tight">Purchases</h1>
      <ErrorAlert error={error} className="mb-5" />

      {isPending ? (
        <Spinner />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="flex flex-col gap-3">
            {data.items.map((order) => (
              <Link
                key={order.id}
                href={`/dashboard/purchases/${order.id}`}
                className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
                    <div>
                      <p className="font-semibold">{order.vehicle?.title ?? 'Vehicle'}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Reference {order.reference} · {formatRelativeTime(order.createdAt)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Sale {formatPrice(order.salePriceCad)} + platform fee{' '}
                        {formatPrice(order.platformFeeCad)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-lg font-bold">{formatPrice(order.totalCad)}</p>
                      <Badge variant="outline" className="mt-1">
                        {formatEnum(order.status)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<ShoppingBag className="h-8 w-8" aria-hidden />}
            title="No purchases yet"
            description="Vehicles you buy or win at auction will appear here."
            action={
              <Link href="/vehicles">
                <Button>Browse vehicles</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function PurchasesPage() {
  return (
    <RequireAuth>
      <Purchases />
    </RequireAuth>
  );
}
