// Environment schema + parsing.
//
// Defines every environment variable the app reads, with types, coercion and
// defaults, via Zod. `parseEnv` validates a raw source (usually `process.env`)
// and returns a fully-typed, immutable config object — or throws a readable
// aggregated error listing every offending variable. No secrets are hardcoded:
// secrets are required from the environment (CLAUDE.md security rules).

import { z } from 'zod';

/** Accepts the JWT-style duration strings the auth layer will hand to its token lib (e.g. `15m`, `7d`, `3600`). */
const duration = z
  .string()
  .regex(/^\d+(ms|s|m|h|d|w|y)?$/, 'must be a duration like "15m", "7d", or a number of seconds');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // --- HTTP server ---
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // --- Logging ---
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

    // --- Database ---
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
        'DATABASE_URL must be a PostgreSQL connection string',
      ),

    // --- Auth / JWT --- (secrets required; no defaults, never committed)
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: duration.default('15m'),
    JWT_REFRESH_TTL: duration.default('7d'),

  // --- CORS --- (comma-separated origins, or `*`; configured per environment)
  CORS_ORIGIN: z.string().min(1).default('*'),

  // --- Public URL --- (used to build absolute links in emails, e.g. invite magic-links)
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  // --- Storage --- (attachments). `local` writes to disk (dev/test); `s3`
  // targets an S3-compatible object store. LOCAL_STORAGE_DIR must always be set
  // (it has a default) because the local driver resolves it at construction.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().min(1).default('./storage'),
  STORAGE_PRESIGN_TTL: z.coerce.number().int().positive().default(900),
  // Max attachment size accepted by the upload endpoints (bytes). Default 10 MiB.
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  // --- SMTP / email --- (all optional; when host is set, real emails are sent
  // via nodemailer, otherwise dev/test log to the console and production throws)
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  // Coerce the usual truthy string forms; anything else (incl. unset) is false.
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse + validate a raw environment source into a typed `Env`.
 * Throws an `Error` whose message aggregates every validation failure.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return Object.freeze(result.data);
}
