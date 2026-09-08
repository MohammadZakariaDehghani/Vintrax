'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { TransactionSummary } from '@atlas/shared';
import { api } from '@/lib/api-client';
import { formatDate, formatEnum, formatPrice, formatRelativeTime } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';

function Order({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<TransactionSummary>(`/orders/${id}`),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['order', id] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  }

  const cancel = useMutation({
    mutationFn: () => api.post<TransactionSummary>(`/orders/${id}/cancel`),
    onSuccess: () => {
      setConfirmingCancel(false);
      refresh();
    },
  });

  if (order.isPending) return <Spinner label="Loading order" />;

  if (order.isError) {
    return (
      <div className="container py-8">
        <BackLink />
        <ErrorAlert error={order.error} className="mt-4" />
      </div>
    );
  }

  const record = order.data;
  // The API allows either participant to cancel an unpaid order, and refuses
  // once payment is recorded, so the button follows the same rule rather than
  // trying to work out from names which side the reader is on.
  const cancellable = record.status === 'INITIATED' || record.status === 'AWAITING_PAYMENT';

  const lines: Array<[string, string]> = [
    ['Reference', record.reference],
    ['Placed', formatDate(record.createdAt)],
    ['Seller', record.sellerName],
    ['Buyer', record.buyerName],
    ['Sale price', formatPrice(record.salePriceCad)],
    ['Platform fee', formatPrice(record.platformFeeCad)],
    ...(record.completedAt
      ? ([['Completed', formatDate(record.completedAt)]] as Array<[string, string]>)
      : []),
  ];

  return (
    <div className="container max-w-3xl py-8">
      <BackLink />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {record.vehicle?.title ?? 'Order'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Order {record.reference} · {formatRelativeTime(record.createdAt)}
          </p>
        </div>
        <Badge variant="outline">{formatEnum(record.status)}</Badge>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Order</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {lines.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 sm:block">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-sm font-medium sm:mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex items-baseline justify-between border-t border-border pt-4">
            <span className="font-semibold">Total</span>
            <span className="tabular text-xl font-bold">{formatPrice(record.totalCad)}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent>
          {record.payment ? (
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-sm text-muted-foreground">Method</dt>
                <dd className="text-sm font-medium sm:mt-0.5">
                  {formatEnum(record.payment.method)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-sm text-muted-foreground">Status</dt>
                <dd className="text-sm font-medium sm:mt-0.5">
                  {formatEnum(record.payment.status)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-sm text-muted-foreground">Paid</dt>
                <dd className="text-sm font-medium sm:mt-0.5">
                  {record.payment.paidAt ? formatDate(record.payment.paidAt) : 'Not yet'}
                </dd>
              </div>
              {record.payment.providerReference ? (
                <div className="flex justify-between gap-4 sm:block">
                  <dt className="text-sm text-muted-foreground">Provider reference</dt>
                  <dd className="text-sm font-medium sm:mt-0.5">
                    {record.payment.providerReference}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No payment record yet.</p>
          )}

          <p className="mt-4 text-sm text-muted-foreground">
            Atlas records payments; it does not process them. Arrange payment with the seller
            directly — the seller marks the order paid once the funds arrive.
          </p>
        </CardContent>
      </Card>

      {record.vehicle ? (
        <Link
          href={`/vehicles/${record.vehicle.slug}`}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          View the listing
        </Link>
      ) : null}

      <ErrorAlert error={cancel.error} className="mt-6" />

      {cancellable ? (
        <div className="mt-6">
          {confirmingCancel ? (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm">
                  Cancelling releases the vehicle back to the marketplace and cannot be undone.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                  >
                    {cancel.isPending ? 'Cancelling…' : 'Yes, cancel this order'}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
                    Keep the order
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button variant="outline" onClick={() => setConfirmingCancel(true)}>
              Cancel this order
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/purchases"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      All purchases
    </Link>
  );
}

export default function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <Order id={id} />
    </RequireAuth>
  );
}
