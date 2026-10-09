'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff, ExternalLink, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  REVIEW_FLAG_LABELS,
  REVIEW_REJECTION_REASON_LABELS,
  REVIEW_REPORT_REASON_LABELS,
  type AdminReviewDetail,
  type ReviewHistoryEntry,
  type ReviewRejectionReason,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';
import { useHasPermission } from '@/store/auth-store';
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
import { AdminNav } from '@/components/admin-nav';
import { Stars } from '@/components/reviews/stars';
import { RejectDialog, ReviewStatusBadge } from '@/components/reviews/review-admin';

const ACTION_LABELS: Record<ReviewHistoryEntry['action'], string> = {
  SUBMITTED: 'Submitted',
  EDITED: 'Edited by the author',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  HIDDEN: 'Hidden',
  RESTORED: 'Restored',
  DELETED: 'Deleted',
  REPORTS_RESOLVED: 'Reports marked as reviewed',
};

function dateTime(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
}

/** One review: its text, author, reports, every action available on it, and its history. */
function ReviewDetail() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const canModerate = useHasPermission('review:moderate');
  const canDelete = useHasPermission('review:delete');
  const [rejecting, setRejecting] = useState(false);

  const review = useQuery({
    queryKey: ['admin-review', id],
    queryFn: ({ signal }) => api.get<AdminReviewDetail>(`/admin/reviews/${id}`, signal),
  });
  const history = useQuery({
    queryKey: ['admin-review', id, 'history'],
    queryFn: ({ signal }) => api.get<ReviewHistoryEntry[]>(`/admin/reviews/${id}/history`, signal),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admin-review', id] });
    void client.invalidateQueries({ queryKey: ['admin-reviews'] });
    void client.invalidateQueries({ queryKey: ['admin-reviews-metrics'] });
  };
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: Record<string, unknown> }) =>
      action === 'delete'
        ? api.delete(`/admin/reviews/${id}`)
        : api.post(`/admin/reviews/${id}/${action}`, body ?? {}),
    onSuccess: () => {
      setRejecting(false);
      refresh();
    },
  });

  if (review.isPending) return <Spinner label="Loading the review" />;
  const data = review.data;

  return (
    <div className="container py-8">
      <AdminNav />
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/admin/reviews" className="hover:underline">
          Reviews
        </Link>
      </p>
      <ErrorAlert error={review.error ?? act.error} className="mb-4" />
      {data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={data.rating} size="md" />
                  <ReviewStatusBadge status={data.status} />
                  {data.verifiedPurchase ? (
                    <Badge variant="success">
                      <ShieldCheck className="h-3 w-3" aria-hidden /> Verified purchase
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-3 whitespace-pre-line break-words">{data.content}</p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Signed “{data.displayName}” · submitted {dateTime(data.createdAt)}
                  {data.editedAt ? ` · edited ${dateTime(data.editedAt)}` : ''}
                </p>
                {data.status === 'REJECTED' && data.rejectionReason ? (
                  <p className="mt-2 text-sm">
                    Rejected:{' '}
                    <strong>{REVIEW_REJECTION_REASON_LABELS[data.rejectionReason]}</strong>
                    {data.rejectionNote ? ` — ${data.rejectionNote}` : ''}
                  </p>
                ) : null}

                {canModerate ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                    {data.status === 'PENDING' || data.status === 'REJECTED' ? (
                      <Button
                        loading={act.isPending && act.variables?.action === 'approve'}
                        onClick={() => act.mutate({ action: 'approve' })}
                      >
                        <Check className="h-4 w-4" aria-hidden /> Approve
                      </Button>
                    ) : null}
                    {data.status === 'PENDING' ? (
                      <Button variant="outline" onClick={() => setRejecting(true)}>
                        <X className="h-4 w-4" aria-hidden /> Reject
                      </Button>
                    ) : null}
                    {data.status === 'APPROVED' ? (
                      <Button
                        variant="outline"
                        loading={act.isPending && act.variables?.action === 'hide'}
                        onClick={() => act.mutate({ action: 'hide' })}
                      >
                        <EyeOff className="h-4 w-4" aria-hidden /> Hide
                      </Button>
                    ) : null}
                    {data.status === 'HIDDEN' || data.status === 'DELETED' ? (
                      <Button
                        variant="outline"
                        loading={act.isPending && act.variables?.action === 'restore'}
                        onClick={() => act.mutate({ action: 'restore' })}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden /> Restore
                      </Button>
                    ) : null}
                    {data.openReportCount > 0 ? (
                      <Button
                        variant="outline"
                        loading={act.isPending && act.variables?.action === 'resolve-reports'}
                        onClick={() => act.mutate({ action: 'resolve-reports' })}
                      >
                        Mark reports as reviewed
                      </Button>
                    ) : null}
                    {canDelete && data.status !== 'DELETED' ? (
                      <Button
                        variant="ghost"
                        loading={act.isPending && act.variables?.action === 'delete'}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Delete this review? It is kept, with its history, under Deleted.',
                            )
                          )
                            act.mutate({ action: 'delete' });
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden /> Delete
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reports ({data.reportCount})</CardTitle>
              </CardHeader>
              <CardContent>
                {data.reports.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one has reported this review.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {data.reports.map((report) => (
                      <li key={report.id} className="py-2">
                        <p>
                          <strong>{REVIEW_REPORT_REASON_LABELS[report.reason]}</strong>
                          {' · '}
                          {report.anonymous ? 'Anonymous visitor' : 'Signed-in user'} ·{' '}
                          {formatRelativeTime(report.createdAt)}
                          {report.resolvedAt ? ' · reviewed' : ' · open'}
                        </p>
                        {report.details ? (
                          <p className="mt-1 whitespace-pre-line text-muted-foreground">
                            {report.details}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Moderation history</CardTitle>
              </CardHeader>
              <CardContent>
                <ErrorAlert error={history.error} />
                <ol className="flex flex-col gap-3 text-sm">
                  {(history.data ?? []).map((entry) => (
                    <li key={entry.id} className="border-l-2 border-border pl-3">
                      <p className="font-medium">
                        {ACTION_LABELS[entry.action]}
                        {entry.previousStatus && entry.previousStatus !== entry.newStatus
                          ? ` (${entry.previousStatus.toLowerCase()} → ${entry.newStatus.toLowerCase()})`
                          : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dateTime(entry.createdAt)} ·{' '}
                        {entry.actor
                          ? `${entry.actor.name} (${entry.actor.email})`
                          : 'Anonymous author'}
                      </p>
                      {entry.reason ? (
                        <p className="mt-0.5 text-muted-foreground">{entry.reason}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="space-y-2 pt-5 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</p>
                <Link
                  href={`/vehicles/${data.vehicle.slug}#reviews`}
                  className="inline-flex items-center gap-1 font-semibold hover:text-primary"
                >
                  {data.vehicle.title} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <p>
                  <Link
                    href={`/admin/reviews?vehicleId=${data.vehicle.id}`}
                    className="text-primary hover:underline"
                  >
                    Other reviews of this vehicle
                  </Link>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1.5 pt-5 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Author</p>
                {data.user ? (
                  <p>
                    {data.user.firstName} {data.user.lastName}
                    <span className="block text-muted-foreground">{data.user.email}</span>
                  </p>
                ) : (
                  <p>Anonymous visitor</p>
                )}
                <p className="text-muted-foreground">
                  {data.sameSourceCount
                    ? `${data.sameSourceCount} other review${data.sameSourceCount > 1 ? 's' : ''} from the same network address in the last 30 days.`
                    : 'No other reviews from this network address in the last 30 days.'}
                </p>
              </CardContent>
            </Card>
            {data.flags.length ? (
              <Card>
                <CardContent className="space-y-1 pt-5 text-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Automatic flags
                  </p>
                  <ul className="list-disc pl-4">
                    {data.flags.map((flag) => (
                      <li key={flag}>{REVIEW_FLAG_LABELS[flag]}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Hints for you to check. They never approve or reject anything.
                  </p>
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardContent className="space-y-1 pt-5 text-sm text-muted-foreground">
                <p>Approved: {dateTime(data.approvedAt)}</p>
                <p>Rejected: {dateTime(data.rejectedAt)}</p>
                <p>Hidden: {dateTime(data.hiddenAt)}</p>
                <p>Deleted: {dateTime(data.deletedAt)}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <RejectDialog
        open={rejecting}
        pending={act.isPending && act.variables?.action === 'reject'}
        error={act.error}
        onClose={() => setRejecting(false)}
        onReject={(input: { reason: ReviewRejectionReason; note: string | null }) =>
          act.mutate({ action: 'reject', body: input })
        }
      />
    </div>
  );
}

export default function AdminReviewPage() {
  return (
    <RequireAuth adminOnly>
      <ReviewDetail />
    </RequireAuth>
  );
}
