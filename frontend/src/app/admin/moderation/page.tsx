'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck, X } from 'lucide-react';
import type { Paginated, VehicleDetail, VehicleSummary } from '@atlas/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatKm, formatLocation, formatPrice, formatRelativeTime } from '@/lib/utils';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Field,
  Pagination,
  Spinner,
  Textarea,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';

/**
 * The moderation queue.
 *
 * Approving is what makes a listing `ACTIVE` — a seller cannot do it, by
 * design, so without this page the review queue had no exit. Rejecting sends
 * the listing back to the seller as a draft with the reason attached, which is
 * why the reason is required for a rejection and optional for an approval.
 */
function ModerationQueue() {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const queue = useQuery({
    queryKey: ['pending-review', page],
    queryFn: () =>
      api.get<Paginated<VehicleSummary>>(`/vehicles/pending-review?page=${page}&pageSize=20`),
  });

  const moderate = useMutation({
    mutationFn: ({
      id,
      approved,
      note,
    }: {
      id: string;
      approved: boolean;
      note?: string;
    }) =>
      api.patch<VehicleDetail>(`/vehicles/${id}/moderate`, {
        approved,
        ...(note ? { reason: note } : {}),
      }),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['pending-review'] });
      // The dashboard's "Awaiting review" tile is now one out of date.
      void queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  if (queue.isPending) return <Spinner label="Loading the moderation queue" />;

  const items = queue.data?.items ?? [];

  return (
    <div className="container py-8">
      <nav className="mb-4 text-sm" aria-label="Breadcrumb">
        <Link href="/admin/dashboard" className="text-muted-foreground hover:text-foreground">
          ← Platform overview
        </Link>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Moderation</h1>
        <p className="mt-1 text-muted-foreground">
          Listings sellers have submitted for review. Approving publishes a listing to the
          marketplace; rejecting returns it to the seller as a draft with your reason.
        </p>
      </div>

      <ErrorAlert error={queue.error ?? moderate.error} className="mb-5" />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="h-8 w-8" aria-hidden />}
            title="Nothing awaiting review"
            description="Listings appear here the moment a seller submits one."
            action={
              <Link href="/admin/dashboard">
                <Button>Back to the dashboard</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((vehicle) => (
              <li key={vehicle.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-start gap-4 pt-5">
                    <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
                      {vehicle.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={vehicle.primaryImageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-[220px] flex-1">
                      <Link
                        href={`/vehicles/${vehicle.slug}`}
                        className="font-semibold hover:text-primary"
                      >
                        {vehicle.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatPrice(vehicle.priceCad)} · {formatKm(vehicle.mileageKm)} ·{' '}
                        {formatEnum(vehicle.condition)}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {formatLocation(vehicle.city, vehicle.province)} · submitted{' '}
                        {formatRelativeTime(vehicle.createdAt)}
                      </p>

                      {rejecting === vehicle.id ? (
                        <div className="mt-3 max-w-xl">
                          <Field
                            label="Why is this being rejected?"
                            htmlFor={`reason-${vehicle.id}`}
                            hint="The seller sees this, so say what they need to change."
                          >
                            <Textarea
                              id={`reason-${vehicle.id}`}
                              rows={3}
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                            />
                          </Field>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={!reason.trim() || moderate.isPending}
                              onClick={() =>
                                moderate.mutate({
                                  id: vehicle.id,
                                  approved: false,
                                  note: reason.trim(),
                                })
                              }
                            >
                              Send it back
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRejecting(null);
                                setReason('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            loading={moderate.isPending}
                            onClick={() => moderate.mutate({ id: vehicle.id, approved: true })}
                          >
                            <Check className="mr-1.5 h-4 w-4" aria-hidden />
                            Approve and publish
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRejecting(vehicle.id);
                              setReason('');
                            }}
                          >
                            <X className="mr-1.5 h-4 w-4" aria-hidden />
                            Reject
                          </Button>
                          <Link href={`/vehicles/${vehicle.slug}`}>
                            <Button variant="ghost" size="sm">
                              Preview
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={queue.data!.page}
            totalPages={queue.data!.totalPages}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

export default function ModerationPage() {
  return (
    <RequireAuth adminOnly>
      <ModerationQueue />
    </RequireAuth>
  );
}
