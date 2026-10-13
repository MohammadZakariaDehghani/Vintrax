import { z } from 'zod';

/**
 * Placeholder secrets shipped in the example env files — refused in production.
 * `.env.production.example` and the Kubernetes example use CHANGE_ME…, the
 * development `.env.example` the dev-only values.
 */
const PLACEHOLDER_SECRETS = [
  'dev-only-access-secret-change-me',
  'dev-only-refresh-secret-change-me',
];
export function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_SECRETS.includes(value) || /^change[_-]?me/i.test(value.trim());
}

/** "true"/"false" from the environment, as a boolean. */
function booleanFlag(fallback: 'true' | 'false') {
  return z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');
}

function optionalEmail(name: string) {
  return z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine(
      (value) => !value || z.string().email().safeParse(value).success,
      `${name} must be an email address`,
    );
}

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Public URL of the frontend, used to build links in emails. */
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // --- Auth ---
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  /** Comma-separated allowlist of browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // --- Redis, cache and queues ---
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  /**
   * `redis` runs jobs through BullMQ. `inline` executes them in-process, which
   * keeps development and CI working without a broker.
   */
  QUEUE_DRIVER: z.enum(['redis', 'inline']).default('redis'),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(60),

  // --- Storage ---
  /** `local` writes to disk; `s3` targets any S3-compatible object store. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(10 * 1024 * 1024),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ca-central-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public base URL objects are served from, e.g. a CDN in front of the bucket. */
  S3_PUBLIC_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // --- Vehicle photo pipeline (see documentation/images.md) ---
  /** Largest vehicle photo accepted, before any processing. */
  IMAGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(15 * 1024 * 1024),
  /** Longest edge an upload may have. Anything larger is refused, not shrunk. */
  IMAGE_MAX_INPUT_DIMENSION: z.coerce.number().int().min(100).default(12_000),
  /**
   * Decoded pixel budget per upload — the decompression-bomb guard. A small
   * file can declare a huge canvas; this refuses it before it is decoded.
   * 60 MP clears every current phone and most full-frame cameras.
   */
  IMAGE_MAX_INPUT_PIXELS: z.coerce.number().int().min(10_000).default(60_000_000),
  /** The largest variant is fitted inside this box; nothing is ever upscaled. */
  IMAGE_MAX_WIDTH: z.coerce.number().int().min(320).default(1920),
  IMAGE_MAX_HEIGHT: z.coerce.number().int().min(320).default(1920),
  /** Comma-separated widths each photo is rendered at. */
  IMAGE_VARIANT_WIDTHS: z
    .string()
    .default('320,640,960,1440,1920')
    .transform((value, ctx) => {
      const widths = [
        ...new Set(value.split(',').map((part) => Number.parseInt(part.trim(), 10))),
      ].sort((a, b) => a - b);
      if (widths.length === 0 || widths.some((width) => !Number.isInteger(width) || width < 16)) {
        ctx.addIssue({ code: 'custom', message: 'must be a list of widths, e.g. 320,640,960' });
        return z.NEVER;
      }
      return widths;
    }),
  /**
   * The variant stored as a photo's plain `url`, for anything that draws a
   * single `src` rather than a `srcset` (older clients, emails, admin tables).
   */
  IMAGE_FALLBACK_WIDTH: z.coerce.number().int().min(16).default(960),
  IMAGE_WEBP_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
  /**
   * Off by default: the bundled encoder handles AVIF fine, but at the effort
   * that makes it worth having it multiplies processing time roughly 25×
   * (documentation/images.md has the measurements). `z.coerce.boolean()`
   * would read the string "false" as true, hence the enum.
   */
  IMAGE_AVIF_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  IMAGE_AVIF_QUALITY: z.coerce.number().int().min(1).max(100).default(60),
  /** Photos processed at once, per API process. Further uploads wait their turn. */
  IMAGE_PROCESSING_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),

  // --- Search ---
  /**
   * `postgres` uses native full-text search and needs no extra infrastructure.
   * `opensearch` delegates to an OpenSearch/Elasticsearch cluster.
   */
  SEARCH_PROVIDER: z.enum(['postgres', 'opensearch']).default('postgres'),
  OPENSEARCH_NODE: z.string().optional(),
  OPENSEARCH_USERNAME: z.string().optional(),
  OPENSEARCH_PASSWORD: z.string().optional(),
  OPENSEARCH_INDEX: z.string().default('vintrax-vehicles'),

  // --- Email ---
  /**
   * `log` prints messages to the server log, which is what development uses;
   * `resend` sends through the Resend API (D-068); `smtp` through any SMTP
   * server. Exactly one sends — there is no fan-out to a second provider.
   */
  MAIL_DRIVER: z.enum(['log', 'smtp', 'resend']).default('log'),
  /** "Name <address>". With Resend the address must be on a verified domain. */
  MAIL_FROM: z
    .string()
    .default('Vintrax <no-reply@vintrax.local>')
    // Deliberately loose here (an existing deployment may still run with a
    // placeholder such as no-reply@localhost); the Resend rule below is strict.
    .refine(
      (value) => /^[^\s@<>]+@[^\s@<>]+$/.test(/<([^>]+)>\s*$/.exec(value)?.[1] ?? value.trim()),
      'MAIL_FROM must be an email address, optionally as "Name <address>"',
    ),
  /** Where replies to platform email go (a monitored support inbox). Unset: MAIL_FROM. */
  MAIL_REPLY_TO: optionalEmail('MAIL_REPLY_TO'),
  /** Administrators who receive operational alerts, comma-separated. Unset: no alert email. */
  MAIL_ADMIN_TO: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine(
      (list) => list.every((address) => z.string().email().safeParse(address).success),
      'MAIL_ADMIN_TO must be a comma-separated list of email addresses',
    ),
  /**
   * Notification email (outbid, finance applications, in-app notifications
   * mirrored to email, admin alerts). Security and account email — verification,
   * password reset, password and address changes — is never switched off.
   */
  MAIL_NOTIFICATIONS_ENABLED: booleanFlag('true'),
  /**
   * Marketing email from the CRM (campaigns, nurture automations). Off holds
   * them as suppressed rather than sending; transactional CRM email still goes.
   */
  MAIL_MARKETING_ENABLED: booleanFlag('true'),
  /** Delivery attempts for a platform email before it is marked failed. */
  MAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  /** Failed platform emails in an hour that send the administrators one alert. */
  MAIL_ALERT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(10_000).default(10),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Resend API key (re_…). Server-side only; required when MAIL_DRIVER=resend. */
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  /**
   * The signing secret (whsec_…) of the webhook created in the Resend
   * dashboard, for POST /api/webhooks/resend. Unset: the endpoint answers 404.
   */
  RESEND_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine(
      (value) => !value || value.startsWith('whsec_'),
      'RESEND_WEBHOOK_SECRET must be the whsec_… signing secret from the Resend dashboard',
    ),
  /** Requests per second to the Resend API; Resend rate-limits each team. */
  RESEND_MAX_REQUESTS_PER_SECOND: z.coerce.number().min(0.1).max(100).default(2),

  // --- Dealer help assistant ---
  // Without a provider the assistant still answers, from the help articles
  // themselves; a provider lets a language model phrase the answer from those
  // same articles. The key is read here, on the server, and nowhere else.
  // `gemini` and `groq` have free tiers and speak the OpenAI protocol;
  // `openai-compatible` is any other such endpoint, named in AI_BASE_URL.
  AI_PROVIDER: z.enum(['none', 'anthropic', 'gemini', 'groq', 'openai-compatible']).default('none'),
  AI_API_KEY: z.string().optional(),
  /** Empty means the provider's default model (common/ai/model-factory.ts). */
  AI_MODEL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  AI_BASE_URL: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine((value) => !value || /^https?:\/\//.test(value), 'AI_BASE_URL must be an http(s) URL'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

  // --- Video ---
  // The ffmpeg binary that optimises uploaded promo tile videos. The API image
  // installs it on PATH; a machine without it refuses video uploads with a
  // clear message rather than storing an unoptimised original.
  FFMPEG_PATH: z.string().default('ffmpeg'),

  // --- CRM (documentation/crm.md) ---
  /**
   * Runs the CRM scheduler in this process: the email outbox, automation
   * steps, reminders and time-based triggers. Every API instance may run it;
   * rows are claimed with row locks, so two instances never take the same one.
   */
  CRM_SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  CRM_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).max(600_000).default(15_000),
  /** Attempts before a CRM email is marked failed (exponential backoff between). */
  CRM_EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  /**
   * Open (pixel) and click (redirect) tracking in CRM email. Opens are
   * approximate: mail apps that block or pre-load images skew them.
   */
  CRM_EMAIL_TRACKING: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * Shared secret for an email provider's delivery webhook (bounces,
   * deliveries, complaints) at POST /api/crm/webhooks/email. Unset disables it.
   */
  CRM_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine(
      (value) => !value || value.length >= 16,
      'CRM_WEBHOOK_SECRET must be at least 16 characters',
    ),
  /** Reply-To for support emails; MAIL_FROM when unset. */
  SUPPORT_REPLY_TO: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine(
      (value) => !value || z.string().email().safeParse(value).success,
      'SUPPORT_REPLY_TO must be an email address',
    ),

  // --- Vehicle reviews (D-067) ---
  /** Reviews one network address may send in an hour, signed in or not. */
  REVIEW_MAX_PER_IP_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(5),
  /** Reviews from one address that may wait for moderation at once. */
  REVIEW_MAX_PENDING_PER_IP: z.coerce.number().int().min(1).max(1000).default(3),
  /** Reports one network address may send in an hour. */
  REVIEW_MAX_REPORTS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(10),
  /** The same text on the same vehicle within this many hours is a duplicate. */
  REVIEW_DUPLICATE_WINDOW_HOURS: z.coerce.number().int().min(1).max(8760).default(72),
  /** Open reports that flag an approved review for another look. */
  REVIEW_AUTO_FLAG_REPORT_THRESHOLD: z.coerce.number().int().min(1).max(1000).default(3),
  /** Tell a signed-in author, in the app, when their review is approved or rejected. */
  REVIEW_NOTIFY_AUTHOR: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // --- Rate limiting ---
  RATE_LIMIT_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
});

export const envSchema = baseEnvSchema
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !isPlaceholderSecret(env.JWT_ACCESS_SECRET), {
    message: 'Refusing to start in production with the example JWT_ACCESS_SECRET',
    path: ['JWT_ACCESS_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !isPlaceholderSecret(env.JWT_REFRESH_SECRET), {
    message: 'Refusing to start in production with the example JWT_REFRESH_SECRET',
    path: ['JWT_REFRESH_SECRET'],
  })
  // A misconfigured object store silently falling back to local disk would lose
  // uploads on the next container restart, so fail fast instead.
  .refine((env) => env.STORAGE_DRIVER !== 's3' || (!!env.S3_BUCKET && !!env.S3_ACCESS_KEY_ID), {
    message: 'STORAGE_DRIVER=s3 requires S3_BUCKET and S3_ACCESS_KEY_ID',
    path: ['S3_BUCKET'],
  })
  .refine((env) => env.SEARCH_PROVIDER !== 'opensearch' || !!env.OPENSEARCH_NODE, {
    message: 'SEARCH_PROVIDER=opensearch requires OPENSEARCH_NODE',
    path: ['OPENSEARCH_NODE'],
  })
  .refine((env) => env.MAIL_DRIVER !== 'smtp' || (!!env.SMTP_HOST && !!env.SMTP_PORT), {
    message: 'MAIL_DRIVER=smtp requires SMTP_HOST and SMTP_PORT',
    path: ['SMTP_HOST'],
  })
  .refine((env) => env.MAIL_DRIVER !== 'resend' || !!env.RESEND_API_KEY?.startsWith('re_'), {
    message: 'MAIL_DRIVER=resend requires RESEND_API_KEY (re_…)',
    path: ['RESEND_API_KEY'],
  })
  // Tests never send real email, whatever the environment around them says.
  .refine((env) => env.NODE_ENV !== 'test' || env.MAIL_DRIVER === 'log', {
    message: 'NODE_ENV=test only allows MAIL_DRIVER=log',
    path: ['MAIL_DRIVER'],
  })
  // Resend only sends from a verified domain; say so at boot rather than as a
  // stream of rejected messages. (Other drivers keep their old behaviour.)
  .refine(
    (env) =>
      env.MAIL_DRIVER !== 'resend' ||
      z.string().email().safeParse(/<([^>]+)>\s*$/.exec(env.MAIL_FROM)?.[1] ?? env.MAIL_FROM.trim())
        .success &&
        !/@[^>]*\.(local|test|example|invalid)>?\s*$/i.test(env.MAIL_FROM),
    {
      message: 'MAIL_DRIVER=resend needs MAIL_FROM on a real, verified sending domain',
      path: ['MAIL_FROM'],
    },
  )
  .refine((env) => env.AI_PROVIDER === 'none' || !!env.AI_API_KEY?.trim(), {
    message: 'AI_PROVIDER requires AI_API_KEY',
    path: ['AI_API_KEY'],
  })
  .refine(
    (env) => env.AI_PROVIDER !== 'openai-compatible' || (!!env.AI_BASE_URL && !!env.AI_MODEL),
    {
      message: 'AI_PROVIDER=openai-compatible requires AI_BASE_URL and AI_MODEL',
      path: ['AI_BASE_URL'],
    },
  );

export type Env = z.infer<typeof envSchema>;

/**
 * Fails fast with a readable report rather than letting the app boot
 * half-configured and surface the problem as a runtime 500 later.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
