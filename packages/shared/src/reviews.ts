import { z } from 'zod';
import { MAX_PAGE_SIZE } from './schemas';

/**
 * Vehicle reviews and comments: what the public and the moderators send and
 * receive. Every review is moderated; nothing a visitor writes is public until
 * an administrator approves it.
 */

export const REVIEW_MIN_LENGTH = 10;
export const REVIEW_MAX_LENGTH = 2000;
export const REVIEW_DISPLAY_NAME_MAX = 40;
export const REVIEW_REPORT_DETAILS_MAX = 500;
export const REVIEW_REJECTION_NOTE_MAX = 500;
/** What an anonymous review is signed with. */
export const ANONYMOUS_REVIEWER = 'Anonymous';

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN', 'DELETED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_REPORT_REASONS = [
  'SPAM',
  'OFFENSIVE',
  'HARASSMENT',
  'FAKE_REVIEW',
  'INCORRECT_INFORMATION',
  'PERSONAL_INFORMATION',
  'OTHER',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

export const REVIEW_REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  SPAM: 'Spam',
  OFFENSIVE: 'Offensive',
  HARASSMENT: 'Harassment',
  FAKE_REVIEW: 'Fake review',
  INCORRECT_INFORMATION: 'Incorrect information',
  PERSONAL_INFORMATION: 'Personal information',
  OTHER: 'Other',
};

export const REVIEW_REJECTION_REASONS = [
  'SPAM',
  'INAPPROPRIATE',
  'IRRELEVANT',
  'DUPLICATE',
  'PERSONAL_INFORMATION',
  'OTHER',
] as const;
export type ReviewRejectionReason = (typeof REVIEW_REJECTION_REASONS)[number];

export const REVIEW_REJECTION_REASON_LABELS: Record<ReviewRejectionReason, string> = {
  SPAM: 'Spam',
  INAPPROPRIATE: 'Inappropriate content',
  IRRELEVANT: 'Irrelevant',
  DUPLICATE: 'Duplicate',
  PERSONAL_INFORMATION: 'Contains personal information',
  OTHER: 'Other',
};

export const REVIEW_MODERATION_ACTIONS = [
  'SUBMITTED',
  'EDITED',
  'APPROVED',
  'REJECTED',
  'HIDDEN',
  'RESTORED',
  'DELETED',
  'REPORTS_RESOLVED',
] as const;
export type ReviewModerationAction = (typeof REVIEW_MODERATION_ACTIONS)[number];

export const REVIEW_SORTS = ['RECENT', 'HIGHEST', 'LOWEST'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export const REVIEW_SORT_LABELS: Record<ReviewSort, string> = {
  RECENT: 'Most recent',
  HIGHEST: 'Highest rated',
  LOWEST: 'Lowest rated',
};

/** Signals a moderator should look at; they never publish or reject on their own. */
export const REVIEW_FLAGS = [
  'LINKS',
  'CONTACT_DETAILS',
  'SHOUTING',
  'REPEATED_CHARACTERS',
  'REPEATED_SOURCE',
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export const REVIEW_FLAG_LABELS: Record<ReviewFlag, string> = {
  LINKS: 'Contains links',
  CONTACT_DETAILS: 'Contains an email address or phone number',
  SHOUTING: 'Mostly capital letters',
  REPEATED_CHARACTERS: 'Long runs of one character',
  REPEATED_SOURCE: 'Several recent reviews from the same source',
};

/**
 * Review text as it is stored and counted: tags removed (the text is shown as
 * text, never as HTML), control characters dropped, runs of spaces collapsed,
 * at most one blank line between paragraphs, ends trimmed. The browser and the
 * server run the same function, so the counter the visitor sees is the length
 * the server checks.
 */
export function normalizeReviewText(value: string): string {
  return (
    value
      .replace(/\r\n?/g, '\n')
      .replace(/<\/?[a-z][^<>]*>/gi, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‍⁠﻿]/g, '')
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** A nickname: letters, numbers, spaces and . ' - only, so it cannot carry a link or an address. */
function normalizeDisplayName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const displayNameSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value ? normalizeDisplayName(value) : ''))
  .refine((value) => value.length <= REVIEW_DISPLAY_NAME_MAX, {
    message: `Keep the name under ${REVIEW_DISPLAY_NAME_MAX} characters`,
  })
  .refine((value) => value === '' || value.length >= 2, { message: 'Use at least 2 characters' })
  .refine((value) => value === '' || /^[\p{L}\p{N} .'’-]+$/u.test(value), {
    message: "Use letters, numbers, spaces and . ' - only",
  })
  .transform((value) => value || null);

const reviewTextSchema = z
  .string({ required_error: 'Write a few words about the vehicle' })
  .max(REVIEW_MAX_LENGTH * 2, `Keep it under ${REVIEW_MAX_LENGTH} characters`)
  .transform(normalizeReviewText)
  .refine((value) => value.length >= REVIEW_MIN_LENGTH, {
    message: `Write at least ${REVIEW_MIN_LENGTH} characters`,
  })
  .refine((value) => value.length <= REVIEW_MAX_LENGTH, {
    message: `Keep it under ${REVIEW_MAX_LENGTH} characters`,
  });

const ratingSchema = z.coerce
  .number({ invalid_type_error: 'Choose a rating from 1 to 5 stars' })
  .int('Choose a rating from 1 to 5 stars')
  .min(1, 'Choose a rating from 1 to 5 stars')
  .max(5, 'Choose a rating from 1 to 5 stars');

/**
 * A new review. `website` is a honeypot the form hides from people; anything
 * in it marks the sender as a bot. Nothing else a client sends — vehicle,
 * author, status — is taken from the body.
 */
export const reviewCreateSchema = z
  .object({
    rating: ratingSchema,
    content: reviewTextSchema,
    displayName: displayNameSchema,
    website: z.string().max(200).optional(),
  })
  .strict();
export type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;

/** An author's edit of their own review; it goes back to moderation. */
export const reviewUpdateSchema = z
  .object({
    rating: ratingSchema,
    content: reviewTextSchema,
    displayName: displayNameSchema,
  })
  .strict();
export type ReviewUpdateInput = z.infer<typeof reviewUpdateSchema>;

export const reviewListQuerySchema = z.object({
  sort: z.enum(REVIEW_SORTS).default('RECENT'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().max(300).optional(),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

export const reviewReportSchema = z
  .object({
    reason: z.enum(REVIEW_REPORT_REASONS, { errorMap: () => ({ message: 'Choose a reason' }) }),
    details: z
      .string()
      .max(REVIEW_REPORT_DETAILS_MAX, `Keep it under ${REVIEW_REPORT_DETAILS_MAX} characters`)
      .optional()
      .nullable()
      .transform((value) => (value ? normalizeReviewText(value) || null : null)),
  })
  .strict();
export type ReviewReportInput = z.infer<typeof reviewReportSchema>;

// --- Admin ----------------------------------------------------------------------------

export const ADMIN_REVIEW_VIEWS = [
  'ALL',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'HIDDEN',
  'DELETED',
  'REPORTED',
] as const;
export type AdminReviewView = (typeof ADMIN_REVIEW_VIEWS)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional();

export const adminReviewListQuerySchema = z.object({
  view: z.enum(ADMIN_REVIEW_VIEWS).default('PENDING'),
  q: z.string().trim().max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  author: z.enum(['ANY', 'ANONYMOUS', 'AUTHENTICATED']).default('ANY'),
  vehicleId: z.string().uuid().optional(),
  from: isoDate,
  to: isoDate,
  sort: z.enum(['NEWEST', 'OLDEST']).default('NEWEST'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>;

export const reviewRejectSchema = z
  .object({
    reason: z.enum(REVIEW_REJECTION_REASONS, { errorMap: () => ({ message: 'Choose a reason' }) }),
    note: z
      .string()
      .trim()
      .max(REVIEW_REJECTION_NOTE_MAX)
      .optional()
      .nullable()
      .transform((value) => value || null),
  })
  .strict();
export type ReviewRejectInput = z.infer<typeof reviewRejectSchema>;

/** A reason for hiding, deleting or restoring, kept in the moderation history. */
export const reviewModerationNoteSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(REVIEW_REJECTION_NOTE_MAX)
      .optional()
      .nullable()
      .transform((value) => value || null),
  })
  .strict()
  // An action with nothing to say sends no body at all.
  .default({});
export type ReviewModerationNoteInput = z.infer<typeof reviewModerationNoteSchema>;

export const REVIEW_BULK_ACTIONS = ['APPROVE', 'REJECT', 'HIDE', 'DELETE'] as const;
export type ReviewBulkAction = (typeof REVIEW_BULK_ACTIONS)[number];

export const reviewBulkSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    action: z.enum(REVIEW_BULK_ACTIONS),
    reason: z.enum(REVIEW_REJECTION_REASONS).optional(),
    note: z.string().trim().max(REVIEW_REJECTION_NOTE_MAX).optional().nullable(),
  })
  .strict()
  .refine((value) => value.action !== 'REJECT' || !!value.reason, {
    message: 'Choose a reason for the rejection',
    path: ['reason'],
  });
export type ReviewBulkInput = z.infer<typeof reviewBulkSchema>;

// --- Contracts -----------------------------------------------------------------------

export interface ReviewRatingSummary {
  /** Mean of approved ratings, one decimal; null with no approved reviews. */
  average: number | null;
  total: number;
  /** Approved reviews per star, 1 to 5. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** A review as the public sees it: no author account, address or moderation detail. */
export interface PublicReview {
  id: string;
  rating: number;
  content: string;
  displayName: string;
  verifiedPurchase: boolean;
  createdAt: string;
  edited: boolean;
}

export interface PublicReviewPage {
  reviews: PublicReview[];
  pagination: { hasMore: boolean; nextCursor: string | null };
  /** Only on the first page. */
  summary?: ReviewRatingSummary;
}

/** The signed-in author's own review of a vehicle, whatever its state. */
export interface MyReview {
  id: string;
  rating: number;
  content: string;
  displayName: string | null;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSubmitted {
  id: string | null;
  status: 'PENDING';
  message: string;
}

export const REVIEW_SUBMITTED_MESSAGE =
  'Thanks for sharing your experience. Your review has been submitted and is awaiting approval.';
export const REVIEW_EXISTS_MESSAGE = "You've already submitted a review for this vehicle.";
export const REVIEW_REPORTED_MESSAGE = "Thanks. We've received your report and will review it.";
export const REVIEW_EMPTY_MESSAGE = 'No reviews yet. Be the first to share your experience.';

export interface AdminReviewRow {
  id: string;
  rating: number;
  content: string;
  displayName: string;
  status: ReviewStatus;
  anonymous: boolean;
  verifiedPurchase: boolean;
  reportCount: number;
  openReportCount: number;
  flags: ReviewFlag[];
  createdAt: string;
  updatedAt: string;
  vehicle: { id: string; slug: string; title: string };
  user: { id: string; email: string; firstName: string; lastName: string } | null;
}

export interface AdminReviewDetail extends AdminReviewRow {
  rejectionReason: ReviewRejectionReason | null;
  rejectionNote: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  hiddenAt: string | null;
  deletedAt: string | null;
  editedAt: string | null;
  /** Other reviews sent from the same network address in the last 30 days. */
  sameSourceCount: number;
  reports: Array<{
    id: string;
    reason: ReviewReportReason;
    details: string | null;
    anonymous: boolean;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

export interface ReviewHistoryEntry {
  id: string;
  action: ReviewModerationAction;
  previousStatus: ReviewStatus | null;
  newStatus: ReviewStatus;
  reason: string | null;
  actor: { id: string; name: string; email: string } | null;
  createdAt: string;
}

export interface ReviewBulkResult {
  succeeded: number;
  failed: number;
  outcomes: Array<{ id: string; ok: boolean; error?: string }>;
}

export interface ReviewMetrics {
  total: number;
  pending: number;
  approved: number;
  reported: number;
  averageRating: number | null;
  last7Days: number;
  last30Days: number;
}
