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

// --- Provider settings (Admin → Settings → Email, D-069) ---------------------

export const EMAIL_PROVIDERS = ['resend'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/** A Resend API key: `re_` and its token. Only ever sent to the API, never back. */
export const RESEND_API_KEY_PATTERN = /^re_[A-Za-z0-9_-]{8,200}$/;

const senderName = z
  .string()
  .trim()
  .min(1, 'Enter a sender name')
  .max(100)
  .regex(/^[^\r\n"<>\\]+$/, 'No quotes, angle brackets, backslashes or line breaks');

const address = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

const apiKey = z.string().trim().regex(RESEND_API_KEY_PATTERN, 'A Resend API key starts with re_');

export const emailSettingsUpdateSchema = z
  .object({
    provider: z.enum(EMAIL_PROVIDERS),
    /** Send through these settings instead of the server environment's. */
    enabled: z.boolean(),
    fromName: senderName,
    fromEmail: address,
    replyTo: address.nullish(),
    /** A new key replaces the stored one; leave it out to keep the stored one. */
    apiKey: apiKey.optional(),
    /** Removes the stored key (and so turns the settings off). */
    clearApiKey: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !(value.apiKey && value.clearApiKey), {
    message: 'Either replace the key or remove it, not both',
    path: ['apiKey'],
  });
export type EmailSettingsUpdateInput = z.infer<typeof emailSettingsUpdateSchema>;

/** Test the stored key, or a key typed into the form before it is saved. */
export const emailConnectionTestSchema = z
  .object({ apiKey: apiKey.optional(), fromEmail: address.optional() })
  .strict();
export type EmailConnectionTestInput = z.infer<typeof emailConnectionTestSchema>;

export interface EmailSettingsView {
  provider: EmailProvider;
  enabled: boolean;
  fromName: string;
  fromEmail: string | null;
  replyTo: string | null;
  /** Never the key itself: whether one is stored, its last four characters, when. */
  apiKey: {
    set: boolean;
    last4: string | null;
    updatedAt: string | null;
    /** False when SETTINGS_ENCRYPTION_KEY is missing or not the one it was saved with. */
    decryptable: boolean;
  };
  /** Whether the server can store secrets at all (SETTINGS_ENCRYPTION_KEY is set). */
  encryptionConfigured: boolean;
  /** What is sending right now. */
  active: {
    source: 'database' | 'environment';
    driver: 'resend' | 'smtp' | 'log';
    from: string;
  };
  updatedAt: string | null;
}

export interface EmailConnectionTestResult {
  ok: boolean;
  /** The key was accepted by Resend. */
  keyValid: boolean;
  /** A sending-only key cannot list domains; it is valid but the domain is not checked. */
  restricted: boolean;
  domain: { name: string; status: string; verified: boolean } | null;
  message: string;
}

export interface EmailTestSendResult {
  ok: boolean;
  to: string;
  providerMessageId: string | null;
  message: string;
}
