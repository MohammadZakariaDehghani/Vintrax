import { z } from 'zod';

/** Placeholder secrets shipped in .env.example — refused outside development. */
const PLACEHOLDER_SECRETS = [
  'dev-only-access-secret-change-me',
  'dev-only-refresh-secret-change-me',
];

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  /** Comma-separated allowlist of browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5 * 1024 * 1024),
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
