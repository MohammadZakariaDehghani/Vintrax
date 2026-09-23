'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck, X } from 'lucide-react';
import type { BulkVehicleResult, Paginated, VehicleDetail, VehicleSummary } from '@vintrax/shared';
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
import { AdminNav } from '@/components/admin-nav';
import { IMAGE_SIZES, OptimizedImage } from '@/components/optimized-image';

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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<BulkVehicleResult | null>(null);

  const queue = useQuery({
    queryKey: ['pending-review', page],
    queryFn: () =>
      api.get<Paginated<VehicleSummary>>(`/vehicles/pending-review?page=${page}&pageSize=20`),
  });

  const queueItems = useMemo(() => queue.data?.items ?? [], [queue.data]);

  // A selection means the rows on screen. Carrying ids across a page change
  // would mean publishing listings the reviewer can no longer see.
  useEffect(() => {
    setSelected(new Set());
    setBulkResult(null);
  }, [page]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['pending-review'] });
    // The dashboard's "Awaiting review" tile is now out of date.
    void queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };

  /**
   * Approving several at once.
   *
   * Only approval, deliberately. A rejection carries a reason the seller reads
   * and acts on, and one reason pasted across twenty different listings is not
   * feedback — it is a form letter. Rejection stays one at a time.
   */
  const publishMany = useMutation({
    mutationFn: (ids: string[]) =>
      api.patch<BulkVehicleResult>('/vehicles/bulk-moderate', { ids, approved: true }),
    onSuccess: (result) => {
      setBulkResult(result);
      setSelected(new Set());
      invalidate();
    },
  });

  function toggle(id: string, next: boolean) {
    setSelected((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  }

  const allSelected = queueItems.length > 0 && queueItems.every((item) => selected.has(item.id));
  const someSelected = queueItems.some((item) => selected.has(item.id));
  const selectedIds = queueItems.filter((item) => selected.has(item.id)).map((item) => item.id);

  const moderate = useMutation({
    mutationFn: ({ id, approved, note }: { id: string; approved: boolean; note?: string }) =>
      api.patch<VehicleDetail>(`/vehicles/${id}/moderate`, {
        approved,
        ...(note ? { reason: note } : {}),
      }),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      invalidate();
    },
  });

  if (queue.isPending) return <Spinner label="Loading the moderation queue" />;

  const items = queueItems;

  return (
    <div className="container py-8">
      <AdminNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Moderation</h1>
        <p className="mt-1 text-muted-foreground">
          Listings sellers have submitted for review. Approving publishes a listing to the
          marketplace; rejecting returns it to the seller as a draft with your reason.
        </p>
      </div>

      <ErrorAlert error={queue.error ?? moderate.error ?? publishMany.error} className="mb-5" />

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
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={allSelected}
                // Some but not all: neither ticked nor empty, because clearing
                // a partial selection and extending it are different acts.
                ref={(node) => {
                  if (node) node.indeterminate = someSelected && !allSelected;
                }}
                onChange={(event) =>
                  setSelected(event.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                }
              />
              Select all on this page
            </label>

            {selectedIds.length > 0 ? (
              <>
                <span className="text-sm font-medium">{selectedIds.length} selected</span>
                <Button
                  size="sm"
                  loading={publishMany.isPending}
                  onClick={() => publishMany.mutate(selectedIds)}
                >
                  <Check className="mr-1.5 h-4 w-4" aria-hidden />
                  Approve and publish {selectedIds.length}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                {/* Rejection is not offered in bulk: it carries a reason the
                    seller acts on, and one reason across twenty listings is a
                    form letter rather than feedback. */}
                <span className="text-sm text-muted-foreground">
                  Rejections stay one at a time, so each seller gets a reason that fits.
                </span>
              </>
            ) : null}
          </div>

          {bulkResult ? (
            <Card className="mb-4">
              <CardContent className="pt-4">
                <p className="text-sm">
                  <strong>{bulkResult.succeeded}</strong> published
                  {bulkResult.failed > 0 ? `, ${bulkResult.failed} left in the queue` : ''}.
                </p>
                {bulkResult.failed > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                    {bulkResult.outcomes
                      .filter((outcome) => !outcome.ok)
                      .map((outcome) => (
                        <li key={outcome.id}>
                          {outcome.title ?? outcome.id}: {outcome.error}
                        </li>
                      ))}
                  </ul>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setBulkResult(null)}
                >
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <ul className="flex flex-col gap-3">
            {items.map((vehicle) => (
              <li key={vehicle.id}>
                <Card className={selected.has(vehicle.id) ? 'border-primary' : undefined}>
                  <CardContent className="flex flex-wrap items-start gap-4 pt-5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-primary"
                      checked={selected.has(vehicle.id)}
                      onChange={(event) => toggle(vehicle.id, event.target.checked)}
                      aria-label={`Select ${vehicle.title}`}
                    />

                    <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
                      {vehicle.primaryImageUrl ? (
                        <OptimizedImage
                          image={vehicle.primaryImage}
                          src={vehicle.primaryImageUrl}
                          alt=""
                          sizes={IMAGE_SIZES.thumb}
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
