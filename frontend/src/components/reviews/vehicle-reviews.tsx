'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, MessageSquarePlus, PenLine, ShieldCheck } from 'lucide-react';
import {
  REVIEW_EMPTY_MESSAGE,
  REVIEW_EXISTS_MESSAGE,
  REVIEW_MAX_LENGTH,
  REVIEW_MIN_LENGTH,
  REVIEW_REPORT_REASONS,
  REVIEW_REPORT_REASON_LABELS,
  REVIEW_SORTS,
  REVIEW_SORT_LABELS,
  normalizeReviewText,
  reviewCreateSchema,
  type MyReview,
  type PublicReview,
  type PublicReviewPage,
  type ReviewReportReason,
  type ReviewSort,
  type ReviewSubmitted,
} from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { StarInput, Stars } from './stars';

const PAGE_SIZE = 5;

const MY_STATUS: Record<MyReview['status'], string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Published',
  REJECTED: 'Not published',
  HIDDEN: 'Not currently shown',
  DELETED: 'Withdrawn',
};

/**
 * "Reviews & Comments" on a vehicle page. The first page and the rating
 * summary arrive server-rendered (so search engines see the approved
 * reviews); sorting, "Load more", writing and reporting happen here. Only
 * approved reviews are ever returned to this component.
 */
export function VehicleReviews({
  vehicleId,
  vehicleTitle,
  initial,
}: {
  vehicleId: string;
  vehicleTitle: string;
  initial: PublicReviewPage | null;
}) {
  const user = useUser();
  const client = useQueryClient();
  const headingId = useId();
  const [sort, setSort] = useState<ReviewSort>('RECENT');
  const [writing, setWriting] = useState(false);
  const [reporting, setReporting] = useState<PublicReview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reviews = useInfiniteQuery({
    queryKey: ['reviews', vehicleId, sort],
    queryFn: ({ pageParam, signal }) =>
      api.get<PublicReviewPage>(
        `/vehicles/${vehicleId}/reviews?sort=${sort}&limit=${PAGE_SIZE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
    initialData: sort === 'RECENT' && initial ? { pages: [initial], pageParams: [''] } : undefined,
  });

  const mine = useQuery({
    queryKey: ['reviews', vehicleId, 'mine', user?.id],
    queryFn: ({ signal }) =>
      api.get<MyReview | null>(`/vehicles/${vehicleId}/reviews/mine`, signal),
    enabled: !!user,
  });

  const pages = reviews.data?.pages ?? [];
  const summary = pages[0]?.summary ?? initial?.summary;
  const items = pages.flatMap((page) => page.reviews);
  const existing = mine.data && mine.data.status !== 'DELETED' ? mine.data : null;

  const withdraw = useMutation({
    mutationFn: (id: string) => api.delete(`/vehicles/${vehicleId}/reviews/${id}`),
    onSuccess: () => {
      setNotice('Your review has been withdrawn.');
      void client.invalidateQueries({ queryKey: ['reviews', vehicleId] });
    },
  });

  return (
    <section id="reviews" aria-labelledby={headingId} className="scroll-mt-24">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id={headingId} className="text-xl font-semibold tracking-tight">
                Reviews &amp; Comments
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">About the {vehicleTitle}</p>
            </div>
            {existing ? null : (
              <Button onClick={() => setWriting(true)}>
                <MessageSquarePlus className="h-4 w-4" aria-hidden />
                Write a review
              </Button>
            )}
          </div>

          {summary ? <Summary summary={summary} /> : null}

          {/* Announced to screen readers when it changes. */}
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'text-sm',
              notice ? 'mt-4 rounded-md bg-success/10 p-3 text-success' : 'sr-only',
            )}
          >
            {notice ?? ''}
          </p>

          {existing ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 p-3 text-sm">
              <div>
                <p className="font-medium">{REVIEW_EXISTS_MESSAGE}</p>
                <p className="text-muted-foreground">
                  Your review ({existing.rating} out of 5):{' '}
                  <strong>{MY_STATUS[existing.status]}</strong>
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setWriting(true)}>
                  <PenLine className="h-4 w-4" aria-hidden />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={withdraw.isPending}
                  onClick={() => {
                    if (
                      window.confirm('Withdraw your review? It will be removed from this listing.')
                    )
                      withdraw.mutate(existing.id);
                  }}
                >
                  Withdraw
                </Button>
              </div>
            </div>
          ) : null}
          <ErrorAlert error={withdraw.error} className="mt-3" />

          {items.length > 0 || reviews.isFetching ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {items.length} of {summary?.total ?? items.length}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Sort by</span>
                <Select
                  aria-label="Sort reviews"
                  className="h-9 w-44"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as ReviewSort)}
                >
                  {REVIEW_SORTS.map((value) => (
                    <option key={value} value={value}>
                      {REVIEW_SORT_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          ) : null}

          <ErrorAlert error={reviews.error} className="mt-4" />
          {reviews.isPending && !initial ? <Spinner label="Loading reviews" /> : null}

          {!reviews.isPending && !reviews.error && items.length === 0 ? (
            <p className="mt-6 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {REVIEW_EMPTY_MESSAGE}
            </p>
          ) : null}

          {items.length > 0 ? (
            <ul className="mt-2 divide-y divide-border" aria-label="Reviews">
              {items.map((review) => (
                <ReviewItem key={review.id} review={review} onReport={() => setReporting(review)} />
              ))}
            </ul>
          ) : null}

          {reviews.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                loading={reviews.isFetchingNextPage}
                onClick={() => void reviews.fetchNextPage()}
              >
                Load more reviews
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ReviewFormDialog
        open={writing}
        vehicleId={vehicleId}
        vehicleTitle={vehicleTitle}
        existing={existing}
        signedIn={!!user}
        onClose={() => setWriting(false)}
        onSubmitted={(message) => {
          setWriting(false);
          setNotice(message);
          void client.invalidateQueries({ queryKey: ['reviews', vehicleId, 'mine'] });
        }}
      />
      <ReportDialog
        vehicleId={vehicleId}
        review={reporting}
        onClose={() => setReporting(null)}
        onReported={(message) => {
          setReporting(null);
          setNotice(message);
        }}
      />
    </section>
  );
}

function Summary({ summary }: { summary: NonNullable<PublicReviewPage['summary']> }) {
  if (!summary.total) return null;
  const max = Math.max(1, ...Object.values(summary.distribution));
  return (
    <div className="mt-5 grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
      <div className="flex flex-col items-start gap-1 sm:items-center sm:px-4">
        <p className="text-4xl font-bold tabular-nums">{summary.average?.toFixed(1)}</p>
        <Stars rating={summary.average ?? 0} size="md" />
        <p className="text-sm text-muted-foreground">
          Based on {summary.total} review{summary.total === 1 ? '' : 's'}
        </p>
      </div>
      <dl className="flex flex-col gap-1.5" aria-label="Rating distribution">
        {([5, 4, 3, 2, 1] as const).map((stars) => {
          const count = summary.distribution[stars];
          return (
            <div
              key={stars}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-sm"
            >
              <dt className="text-muted-foreground">
                {stars} star{stars === 1 ? '' : 's'}
              </dt>
              <dd className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
                <div
                  className="h-full rounded-full bg-warning"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </dd>
              <dd className="text-right tabular-nums">{count}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function ReviewItem({ review, onReport }: { review: PublicReview; onReport: () => void }) {
  return (
    <li className="py-4">
      <article aria-label={`Review by ${review.displayName}, ${review.rating} out of 5 stars`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Stars rating={review.rating} />
          {review.verifiedPurchase ? (
            <Badge variant="success">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Verified purchase
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed">
          {review.content}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{review.displayName}</span>
            {' · '}
            <time dateTime={review.createdAt}>{formatRelativeTime(review.createdAt)}</time>
            {review.edited ? ' · edited' : ''}
          </p>
          <button
            type="button"
            onClick={onReport}
            className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Flag className="h-3.5 w-3.5" aria-hidden />
            Report<span className="sr-only"> review by {review.displayName}</span>
          </button>
        </div>
      </article>
    </li>
  );
}

function ReviewFormDialog({
  open,
  vehicleId,
  vehicleTitle,
  existing,
  signedIn,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  vehicleId: string;
  vehicleTitle: string;
  existing: MyReview | null;
  signedIn: boolean;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setRating(existing?.rating ?? 0);
    setContent(existing?.content ?? '');
    setDisplayName(existing?.displayName ?? '');
    setWebsite('');
    setErrors({});
  }, [open, existing]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      existing
        ? api.patch<ReviewSubmitted>(`/vehicles/${vehicleId}/reviews/${existing.id}`, body)
        : api.post<ReviewSubmitted>(`/vehicles/${vehicleId}/reviews`, body),
    onSuccess: (result) => onSubmitted(result.message),
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(
          Object.fromEntries(
            Object.entries(error.details).map(([key, messages]) => [key, messages[0] ?? '']),
          ),
        );
      }
    },
  });

  const length = normalizeReviewText(content).length;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = reviewCreateSchema.safeParse({
      rating,
      content,
      displayName,
      website: website || undefined,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    const body: Record<string, unknown> = { rating, content, displayName: displayName || null };
    if (!existing && website) body['website'] = website;
    save.mutate(body);
  }

  const contentError = errors['content'];
  const ratingError = errors['rating'];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit your review' : 'Write a review'}
      description={
        existing
          ? 'Your edited review is checked again before it appears.'
          : `Share your experience with the ${vehicleTitle}. Every review is checked before it appears.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="review-form" loading={save.isPending}>
            {existing ? 'Save changes' : 'Submit review'}
          </Button>
        </>
      }
    >
      <form
        id="review-form"
        noValidate
        onSubmit={submit}
        className="relative flex flex-col gap-4 overflow-hidden"
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id="review-rating-label">
            Your rating
          </span>
          <StarInput
            id="review-rating"
            value={rating}
            onChange={(value) => {
              setRating(value);
              setErrors((current) => ({ ...current, rating: '' }));
            }}
            invalid={!!ratingError}
            describedBy={ratingError ? 'review-rating-error' : undefined}
          />
          {ratingError ? (
            <p
              id="review-rating-error"
              role="alert"
              className="text-xs font-medium text-destructive"
            >
              {ratingError}
            </p>
          ) : null}
        </div>
        <Field label="Your review" htmlFor="review-content" error={contentError}>
          <Textarea
            id="review-content"
            rows={6}
            maxLength={REVIEW_MAX_LENGTH * 2}
            value={content}
            aria-invalid={!!contentError}
            aria-describedby="review-content-count"
            onChange={(event) => setContent(event.target.value)}
            placeholder="What was the vehicle like? Was the listing accurate? How was the seller?"
          />
        </Field>
        <p
          id="review-content-count"
          className={cn(
            '-mt-3 text-xs',
            length > REVIEW_MAX_LENGTH ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {length < REVIEW_MIN_LENGTH ? `At least ${REVIEW_MIN_LENGTH} characters · ` : ''}
          {length} / {REVIEW_MAX_LENGTH}
        </p>
        <Field
          label="Display name (optional)"
          htmlFor="review-name"
          error={errors['displayName']}
          hint="Leave it empty to post as Anonymous. Your email and account are never shown."
        >
          <Input
            id="review-name"
            maxLength={40}
            autoComplete="nickname"
            placeholder="Anonymous"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        {!existing ? (
          <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor="review-website">Website</label>
            <input
              id="review-website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>
        ) : null}
        {!signedIn ? (
          <p className="text-xs text-muted-foreground">
            You are posting anonymously.{' '}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>{' '}
            to edit your review later.
          </p>
        ) : null}
        {save.error &&
        !(save.error instanceof ApiError && Object.keys(save.error.details).length) ? (
          <ErrorAlert error={save.error} />
        ) : null}
      </form>
    </Dialog>
  );
}

function ReportDialog({
  vehicleId,
  review,
  onClose,
  onReported,
}: {
  vehicleId: string;
  review: PublicReview | null;
  onClose: () => void;
  onReported: (message: string) => void;
}) {
  const [reason, setReason] = useState<ReviewReportReason | ''>('');
  const [details, setDetails] = useState('');
  useEffect(() => {
    if (review) {
      setReason('');
      setDetails('');
    }
  }, [review]);
  const report = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>(`/vehicles/${vehicleId}/reviews/${review!.id}/report`, {
        reason,
        details: details.trim() || null,
      }),
    onSuccess: (result) => onReported(result.message),
  });
  return (
    <Dialog
      open={!!review}
      onClose={onClose}
      size="sm"
      title="Report this review"
      description="Tell us what is wrong. The review stays up until our team has looked at it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reason} loading={report.isPending} onClick={() => report.mutate()}>
            Send report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Reason</legend>
          {REVIEW_REPORT_REASONS.map((value) => (
            <label key={value} className="flex min-h-8 items-center gap-2 text-sm">
              <input
                type="radio"
                name="report-reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
                className="h-4 w-4 accent-primary"
              />
              {REVIEW_REPORT_REASON_LABELS[value]}
            </label>
          ))}
        </fieldset>
        <Field label="Details (optional)" htmlFor="report-details">
          <Textarea
            id="report-details"
            rows={3}
            maxLength={500}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
          />
        </Field>
        <ErrorAlert error={report.error} />
      </div>
    </Dialog>
  );
}
