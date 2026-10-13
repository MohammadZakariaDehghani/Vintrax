'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff, Flag, MessageSquareText, Star, Trash2, X } from 'lucide-react';
import {
  ADMIN_REVIEW_VIEWS,
  type AdminReviewRow,
  type AdminReviewView,
  type Paginated,
  type ReviewBulkAction,
  type ReviewBulkResult,
  type ReviewMetrics,
  type ReviewRejectionReason,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';
import { useHasPermission } from '@/store/auth-store';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Input,
  Pagination,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { StatTile } from '@/components/stat-tile';
import { Stars } from '@/components/reviews/stars';
import { RejectDialog, ReviewStatusBadge } from '@/components/reviews/review-admin';

const VIEW_LABELS: Record<AdminReviewView, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  HIDDEN: 'Hidden',
  REPORTED: 'Reported',
  DELETED: 'Deleted',
  ALL: 'All',
};
const VIEW_ORDER: AdminReviewView[] = [
  'PENDING',
  'REPORTED',
  'APPROVED',
  'REJECTED',
  'HIDDEN',
  'DELETED',
  'ALL',
];

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  return `?${search.toString()}`;
}

/**
 * The review moderation queue. Nothing reaches a vehicle page until it is
 * approved here. Pending reviews lead with Approve and Reject; reported ones
 * show their open reports. Rejecting and deleting ask first.
 */
function ReviewModeration() {
  const client = useQueryClient();
  // Arriving from a review's page: that vehicle's reviews, in every state.
  const vehicleId = useSearchParams()?.get('vehicleId') ?? '';
  const canModerate = useHasPermission('review:moderate');
  const canDelete = useHasPermission('review:delete');
  const [view, setView] = useState<AdminReviewView>(vehicleId ? 'ALL' : 'PENDING');
  const [q, setQ] = useState('');
  const [rating, setRating] = useState('');
  const [author, setAuthor] = useState<'ANY' | 'ANONYMOUS' | 'AUTHENTICATED'>('ANY');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'NEWEST' | 'OLDEST'>('NEWEST');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [bulkResult, setBulkResult] = useState<ReviewBulkResult | null>(null);

  const query = qs({
    view,
    q: q.trim(),
    rating,
    author,
    vehicleId,
    from,
    to,
    sort,
    page,
    pageSize: 20,
  });
  const list = useQuery({
    queryKey: ['admin-reviews', query],
    queryFn: ({ signal }) => api.get<Paginated<AdminReviewRow>>(`/admin/reviews${query}`, signal),
    placeholderData: (previous) => previous,
  });
  const metrics = useQuery({
    queryKey: ['admin-reviews-metrics'],
    queryFn: ({ signal }) => api.get<ReviewMetrics>('/admin/reviews/metrics', signal),
  });

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  useEffect(() => {
    setSelected(new Set());
    setBulkResult(null);
  }, [query]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admin-reviews'] });
    void client.invalidateQueries({ queryKey: ['admin-reviews-metrics'] });
  };

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'hide' | 'restore' }) =>
      api.post(`/admin/reviews/${id}/${action}`, {}),
    onSuccess: refresh,
  });
  const bulk = useMutation({
    mutationFn: (input: {
      ids: string[];
      action: ReviewBulkAction;
      reason?: ReviewRejectionReason;
      note?: string | null;
    }) => api.post<ReviewBulkResult>('/admin/reviews/bulk', input),
    onSuccess: (result) => {
      setBulkResult(result);
      setSelected(new Set());
      setRejecting(null);
      refresh();
    },
  });
  const rejectOne = useMutation({
    mutationFn: ({
      id,
      reason,
      note,
    }: {
      id: string;
      reason: ReviewRejectionReason;
      note: string | null;
    }) => api.post(`/admin/reviews/${id}/reject`, { reason, note }),
    onSuccess: () => {
      setRejecting(null);
      refresh();
    },
  });

  const selectedIds = items.filter((item) => selected.has(item.id)).map((item) => item.id);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const someSelected = items.some((item) => selected.has(item.id));

  function runBulk(action: ReviewBulkAction) {
    if (action === 'REJECT') return setRejecting(selectedIds);
    if (
      action === 'DELETE' &&
      !window.confirm(
        `Delete ${selectedIds.length} review(s)? They are kept, with their history, under Deleted.`,
      )
    )
      return;
    bulk.mutate({ ids: selectedIds, action });
  }

  return (
    <div className="container py-8">
      <AdminNav />
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Reviews</h1>
        <p className="mt-1 text-muted-foreground">
          Reviews and comments on vehicle pages. Nothing is public until it is approved here; only
          approved reviews count towards a vehicle&apos;s rating.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatTile
          label="Pending"
          value={metrics.data?.pending ?? 0}
          hint="Waiting for approval"
          icon={MessageSquareText}
        />
        <StatTile
          label="Reported"
          value={metrics.data?.reported ?? 0}
          hint="With open reports"
          icon={Flag}
        />
        <StatTile label="Approved" value={metrics.data?.approved ?? 0} hint="Public" icon={Check} />
        <StatTile
          label="Total"
          value={metrics.data?.total ?? 0}
          hint="Not deleted"
          icon={MessageSquareText}
        />
        <StatTile
          label="Average rating"
          value={metrics.data?.averageRating?.toFixed(1) ?? '—'}
          hint="Approved reviews"
          icon={Star}
        />
        <StatTile
          label="Last 7 days"
          value={metrics.data?.last7Days ?? 0}
          hint="New reviews"
          icon={MessageSquareText}
        />
        <StatTile
          label="Last 30 days"
          value={metrics.data?.last30Days ?? 0}
          hint="New reviews"
          icon={MessageSquareText}
        />
      </div>

      <div
        role="tablist"
        aria-label="Review views"
        className="relative mb-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        {VIEW_ORDER.filter((value) => ADMIN_REVIEW_VIEWS.includes(value)).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => {
              setView(value);
              setPage(1);
            }}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              view === value
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {VIEW_LABELS[value]}
          </button>
        ))}
      </div>

      {vehicleId ? (
        <p className="mb-3 text-sm">
          Showing one vehicle&apos;s reviews.{' '}
          <Link href="/admin/reviews" className="text-primary hover:underline">
            Show all vehicles
          </Link>
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Input
          type="search"
          aria-label="Search reviews"
          placeholder="Vehicle, VIN, stock # or review text"
          className="w-full sm:w-72"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Rating"
          className="w-32"
          value={rating}
          onChange={(event) => {
            setRating(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Any rating</option>
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value} star{value > 1 ? 's' : ''}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Author"
          className="w-40"
          value={author}
          onChange={(event) => {
            setAuthor(event.target.value as typeof author);
            setPage(1);
          }}
        >
          <option value="ANY">Any author</option>
          <option value="ANONYMOUS">Anonymous</option>
          <option value="AUTHENTICATED">Signed in</option>
        </Select>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            className="w-40"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <Select
          aria-label="Order"
          className="w-36"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="NEWEST">Newest first</option>
          <option value="OLDEST">Oldest first</option>
        </Select>
      </div>

      <ErrorAlert error={list.error ?? act.error ?? bulk.error ?? metrics.error} className="mb-4" />

      {canModerate && items.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={allSelected}
              ref={(node) => {
                if (node) node.indeterminate = someSelected && !allSelected;
              }}
              onChange={(event) =>
                setSelected(
                  event.target.checked ? new Set(items.map((item) => item.id)) : new Set(),
                )
              }
            />
            Select all on this page
          </label>
          {selectedIds.length > 0 ? (
            <>
              <span className="text-sm font-medium">{selectedIds.length} selected</span>
              <Button
                size="sm"
                loading={bulk.isPending && bulk.variables?.action === 'APPROVE'}
                onClick={() => runBulk('APPROVE')}
              >
                <Check className="h-4 w-4" aria-hidden /> Approve selected
              </Button>
              <Button size="sm" variant="outline" onClick={() => runBulk('REJECT')}>
                <X className="h-4 w-4" aria-hidden /> Reject selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={bulk.isPending && bulk.variables?.action === 'HIDE'}
                onClick={() => runBulk('HIDE')}
              >
                <EyeOff className="h-4 w-4" aria-hidden /> Hide selected
              </Button>
              {canDelete ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={bulk.isPending && bulk.variables?.action === 'DELETE'}
                  onClick={() => runBulk('DELETE')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Delete selected
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {bulkResult ? (
        <Card className="mb-4">
          <CardContent className="pt-4 text-sm">
            <p>
              <strong>{bulkResult.succeeded}</strong> done
              {bulkResult.failed ? `, ${bulkResult.failed} not changed` : ''}.
            </p>
            {bulkResult.failed ? (
              <ul className="mt-1 text-muted-foreground">
                {bulkResult.outcomes
                  .filter((outcome) => !outcome.ok)
                  .map((outcome) => (
                    <li key={outcome.id}>{outcome.error}</li>
                  ))}
              </ul>
            ) : null}
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setBulkResult(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {list.isPending ? <Spinner label="Loading reviews" /> : null}
      {!list.isPending && items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquareText className="h-8 w-8" aria-hidden />}
            title={view === 'PENDING' ? 'Nothing waiting for approval' : 'No reviews here'}
            description="New reviews appear under Pending as soon as they are submitted."
          />
        </Card>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((review) => (
            <li key={review.id}>
              <Card className={selected.has(review.id) ? 'border-primary' : undefined}>
                <CardContent className="flex gap-3 pt-4">
                  {canModerate ? (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-primary"
                      aria-label={`Select review of ${review.vehicle.title}`}
                      checked={selected.has(review.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(review.id);
                          else next.delete(review.id);
                          return next;
                        })
                      }
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <Link
                        href={`/vehicles/${review.vehicle.slug}`}
                        className="font-semibold hover:text-primary"
                      >
                        {review.vehicle.title}
                      </Link>
                      <Stars rating={review.rating} />
                      <ReviewStatusBadge status={review.status} />
                      {review.openReportCount ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                          <Flag className="h-3 w-3" aria-hidden /> {review.openReportCount} open
                          report{review.openReportCount > 1 ? 's' : ''}
                        </span>
                      ) : null}
                      {review.flags.length ? (
                        <span className="text-xs text-warning">Flagged: {review.flags.length}</span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-line break-words text-sm">
                      {review.content}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Signed “{review.displayName}” ·{' '}
                      {review.anonymous
                        ? 'not signed in'
                        : (review.user?.email ?? 'signed-in user')}
                      {review.verifiedPurchase ? ' · Verified purchase' : ''} ·{' '}
                      {formatRelativeTime(review.createdAt)}
                      {review.reportCount
                        ? ` · ${review.reportCount} report${review.reportCount > 1 ? 's' : ''} in total`
                        : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canModerate &&
                      (review.status === 'PENDING' || review.status === 'REJECTED') ? (
                        <Button
                          size="sm"
                          loading={act.isPending && act.variables?.id === review.id}
                          onClick={() => act.mutate({ id: review.id, action: 'approve' })}
                        >
                          <Check className="h-4 w-4" aria-hidden /> Approve
                        </Button>
                      ) : null}
                      {canModerate && review.status === 'PENDING' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRejecting([review.id])}
                        >
                          <X className="h-4 w-4" aria-hidden /> Reject
                        </Button>
                      ) : null}
                      {canModerate && review.status === 'APPROVED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => act.mutate({ id: review.id, action: 'hide' })}
                        >
                          <EyeOff className="h-4 w-4" aria-hidden /> Hide
                        </Button>
                      ) : null}
                      {canModerate &&
                      (review.status === 'HIDDEN' || review.status === 'DELETED') ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => act.mutate({ id: review.id, action: 'restore' })}
                        >
                          Restore
                        </Button>
                      ) : null}
                      <Link href={`/admin/reviews/${review.id}`}>
                        <Button size="sm" variant="ghost">
                          View details &amp; history
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      <Pagination
        page={list.data?.page ?? 1}
        totalPages={list.data?.totalPages ?? 1}
        onChange={setPage}
      />

      <RejectDialog
        open={!!rejecting}
        count={rejecting?.length ?? 1}
        pending={rejectOne.isPending || bulk.isPending}
        error={rejectOne.error ?? bulk.error}
        onClose={() => setRejecting(null)}
        onReject={({ reason, note }) => {
          if (!rejecting) return;
          if (rejecting.length === 1) rejectOne.mutate({ id: rejecting[0]!, reason, note });
          else bulk.mutate({ ids: rejecting, action: 'REJECT', reason, note });
        }}
      />
    </div>
  );
}

export default function AdminReviewsPage() {
  return (
    <RequireAuth adminOnly>
      <Suspense>
        <ReviewModeration />
      </Suspense>
    </RequireAuth>
  );
}
