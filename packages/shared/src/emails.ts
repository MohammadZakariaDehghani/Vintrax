import { z } from 'zod';
import { MAX_PAGE_SIZE } from './schemas';

/**
 * Platform email administration (D-068): the delivery log the admin sees, its
 * statistics, and the one action — retrying a failed message unchanged.
 */

export const EMAIL_CATEGORIES = ['SECURITY', 'ACCOUNT', 'NOTIFICATION', 'ADMIN'] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/**
 * ACCEPTED means the provider took the message; DELIVERED means the
 * recipient's server did. They are different states, and only a delivery
 * event moves one to the other.
 */
export const EMAIL_MESSAGE_STATUSES = [
  'QUEUED',
  'SENDING',
  'ACCEPTED',
  'DELAYED',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'SUPPRESSED',
  'SKIPPED',
] as const;
export type EmailMessageStatus = (typeof EMAIL_MESSAGE_STATUSES)[number];

export const adminEmailListQuerySchema = z.object({
  status: z.enum(EMAIL_MESSAGE_STATUSES).optional(),
  category: z.enum(EMAIL_CATEGORIES).optional(),
  /** A recipient address, or part of one. */
  q: z.string().trim().max(254).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});
export type AdminEmailListQuery = z.infer<typeof adminEmailListQuerySchema>;

export interface AdminEmailRow {
  id: string;
  category: EmailCategory;
  templateKey: string;
  toEmail: string;
  subject: string;
  status: EmailMessageStatus;
  provider: string | null;
  attempts: number;
  lastErrorCode: string | null;
  /** Sanitised by the server: never a token, key or message body. */
  lastError: string | null;
  /** Whether an administrator may retry it (failed, and not carrying a single-use link). */
  retryable: boolean;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  failedAt: string | null;
}

export interface EmailStats {
  since: string;
  /** The active driver: resend, smtp, or log (nothing leaves the server). */
  driver: string;
  total: number;
  /** Messages that needed more than one attempt. */
  retried: number;
  byStatus: Partial<Record<EmailMessageStatus, number>>;
  byCategory: Partial<Record<EmailCategory, number>>;
}
