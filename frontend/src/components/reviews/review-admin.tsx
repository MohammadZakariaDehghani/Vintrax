'use client';

import { useEffect, useState } from 'react';
import {
  REVIEW_REJECTION_REASONS,
  REVIEW_REJECTION_REASON_LABELS,
  type ReviewRejectionReason,
  type ReviewStatus,
} from '@vintrax/shared';
import { Badge, Button, Dialog, ErrorAlert, Field, Select, Textarea } from '@/components/ui';

const STATUS: Record<
  ReviewStatus,
  { label: string; variant: 'warning' | 'success' | 'destructive' | 'default' | 'outline' }
> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  HIDDEN: { label: 'Hidden', variant: 'default' },
  DELETED: { label: 'Deleted', variant: 'outline' },
};

/** A review's state in words, with a colour as a second cue rather than the only one. */
export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const { label, variant } = STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}

/** Choosing a rejection reason (and an optional note), for one review or several. */
export function RejectDialog({
  open,
  count = 1,
  pending,
  error,
  onClose,
  onReject,
}: {
  open: boolean;
  count?: number;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onReject: (input: { reason: ReviewRejectionReason; note: string | null }) => void;
}) {
  const [reason, setReason] = useState<ReviewRejectionReason | ''>('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={count > 1 ? `Reject ${count} reviews` : 'Reject review'}
      description="The reason stays in the moderation history. It is never shown publicly."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason}
            loading={pending}
            onClick={() => reason && onReject({ reason, note: note.trim() || null })}
          >
            {count > 1 ? `Reject ${count}` : 'Reject review'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" htmlFor="reject-reason">
          <Select
            id="reject-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as ReviewRejectionReason)}
          >
            <option value="">Choose a reason</option>
            {REVIEW_REJECTION_REASONS.map((value) => (
              <option key={value} value={value}>
                {REVIEW_REJECTION_REASON_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note for the history (optional)" htmlFor="reject-note">
          <Textarea
            id="reject-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <ErrorAlert error={error} />
      </div>
    </Dialog>
  );
}
