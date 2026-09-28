import { z } from 'zod';

/** Placeholder secrets shipped in .env.example — refused outside development. */
const PLACEHOLDER_SECRETS = [
  'dev-only-access-secret-change-me',
  'dev-only-refresh-secret-change-me',
];

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
  /** `log` prints messages to the server log, which is what development uses. */
  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  MAIL_FROM: z.string().default('Vintrax <no-reply@vintrax.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // --- Dealer help assistant ---
  // Without a provider the assistant still answers, from the help articles
  // themselves; a provider lets a language model phrase the answer from those
  // same articles. The key is read here, on the server, and nowhere else.
  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

  // --- Rate limiting ---
  RATE_LIMIT_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
});

export const envSchema = baseEnvSchema
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine(
    (env) => env.NODE_ENV !== 'production' || !PLACEHOLDER_SECRETS.includes(env.JWT_ACCESS_SECRET),
    {
      message: 'Refusing to start in production with the example JWT_ACCESS_SECRET',
      path: ['JWT_ACCESS_SECRET'],
    },
  )
  .refine(
    (env) => env.NODE_ENV !== 'production' || !PLACEHOLDER_SECRETS.includes(env.JWT_REFRESH_SECRET),
    {
      message: 'Refusing to start in production with the example JWT_REFRESH_SECRET',
      path: ['JWT_REFRESH_SECRET'],
    },
  )
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
  .refine((env) => env.AI_PROVIDER === 'none' || !!env.AI_API_KEY?.trim(), {
    message: 'AI_PROVIDER requires AI_API_KEY',
    path: ['AI_API_KEY'],
  });

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
