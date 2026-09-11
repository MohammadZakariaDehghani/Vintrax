'use client';

import { useRouter } from 'next/navigation';
import { useOrders } from '@/lib/queries';
import { formatDate, formatEnum, formatPrice } from '@/lib/format';
import { Badge, Button, Card, Skeleton, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState } from '@/components/error-state';

export default function OrdersPage() {
  return (
    <>
      <AppBar title="Purchases" back />
      <RequireAuth>
        <OrderList />
      </RequireAuth>
    </>
  );
}

function OrderList() {
  const router = useRouter();
  const orders = useOrders();
  const items = orders.data?.items ?? [];

  if (orders.isPending) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (orders.isError)
    return <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />;

  if (items.length === 0) {
    return (
      <StateMessage
        title="No purchases yet"
        description="Completed sales and their receipts appear here."
        action={<Button onClick={() => router.push('/browse')}>Browse inventory</Button>}
      />
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {items.map((order) => (
        <li key={order.id}>
          <Card className="space-y-2 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {order.vehicle?.title ?? order.reference}
                </p>
                <p className="text-xs text-muted-foreground">
                  {order.reference} · {formatDate(order.createdAt)}
                </p>
              </div>
              <Badge tone={order.status === 'COMPLETED' ? 'success' : 'neutral'}>
                {formatEnum(order.status)}
              </Badge>
            </div>

            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Sale price</dt>
                <dd className="tabular-nums">{formatPrice(order.salePriceCad)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Platform fee</dt>
                <dd className="tabular-nums">{formatPrice(order.platformFeeCad)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPrice(order.totalCad)}</dd>
              </div>
            </dl>
          </Card>
        </li>
      ))}
    </ul>
  );
}
