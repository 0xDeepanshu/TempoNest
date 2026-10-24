import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .transform((value) => ['true', '1', 'yes', 'on'].includes(value));

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const SUPPORTED_SCREENSHOT_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    DATABASE_URL: optionalString,
    TEST_DATABASE_URL: optionalString,
    DB_SSL: booleanFromEnv.default('false'),
    DB_HOST: z.string().min(1).default('localhost'),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().min(1).default('temponest_dev'),
    DB_USER: z.string().min(1).default('postgres'),
    DB_PASSWORD: z.string().default(''),

    TOKEN_PEPPER: z.string().min(32).optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(2_592_000),
    INVITATION_TTL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(604_800),
    MAX_ACTIVE_SESSIONS_PER_USER: z.coerce.number().int().min(1).max(100).default(10),

    HEARTBEAT_STALE_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
    SESSION_STALE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
    OFFLINE_MAX_BACKFILL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(604_800),
    OFFLINE_FUTURE_SKEW_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
    ACTIVITY_MAX_BACKFILL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(2_592_000),
    ACTIVITY_FUTURE_SKEW_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(32_768),
    WS_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(30),

    // Screenshot capture is always admin-initiated. These limits apply to the
    // private upload/download flow and the short-lived request lifecycle.
    SCREENSHOT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    SCREENSHOT_LOCAL_DIR: z.string().min(1).default('storage/screenshots'),
    PUBLIC_BASE_URL: optionalString,
    SCREENSHOT_REQUEST_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    SCREENSHOT_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(120),
    SCREENSHOT_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
    SCREENSHOT_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(86_400).default(300),
    SCREENSHOT_MAX_BYTES: z.coerce.number().int().min(1024).max(52_428_800).default(10_485_760),
    SCREENSHOT_ALLOWED_CONTENT_TYPES: z
      .string()
      .default('image/png,image/jpeg,image/webp')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    SCREENSHOT_S3_BUCKET: optionalString,
    SCREENSHOT_S3_REGION: z.string().min(1).default('us-east-1'),
    SCREENSHOT_S3_ENDPOINT: optionalString,
    SCREENSHOT_S3_ACCESS_KEY_ID: optionalString,
    SCREENSHOT_S3_SECRET_ACCESS_KEY: optionalString,
    SCREENSHOT_S3_FORCE_PATH_STYLE: booleanFromEnv.default('false'),

    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8 * 2).max(1_048_576).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(20).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

    COOKIE_SECURE: booleanFromEnv.optional(),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: optionalString,

    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    TRUST_PROXY: z
      .union([z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']), z.string().regex(/^\d+$/)])
      .default('false'),
    BODY_LIMIT: z.string().default('100kb'),

    RATE_LIMIT_ENABLED: booleanFromEnv.default('true'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.DATABASE_URL && !env.DB_NAME) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL (or DB_NAME) is required in production',
      });
    }

    if (env.NODE_ENV === 'production' && (!env.TOKEN_PEPPER || env.TOKEN_PEPPER.length < 32)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TOKEN_PEPPER'],
        message: 'TOKEN_PEPPER with at least 32 characters is required in production',
      });
    }

    if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must not be false in production',
      });
    }

    if (env.COOKIE_SAME_SITE === 'none' && env.COOKIE_SECURE !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true when COOKIE_SAME_SITE=none',
      });
    }

    if (env.SCREENSHOT_ALLOWED_CONTENT_TYPES.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCREENSHOT_ALLOWED_CONTENT_TYPES'],
        message: 'At least one screenshot content type is required',
      });
    }

    for (const contentType of env.SCREENSHOT_ALLOWED_CONTENT_TYPES) {
      if (!(SUPPORTED_SCREENSHOT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SCREENSHOT_ALLOWED_CONTENT_TYPES'],
          message: `Unsupported screenshot content type: ${contentType}`,
        });
      }
    }

    if (env.SCREENSHOT_STORAGE_DRIVER === 's3' && !env.SCREENSHOT_S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCREENSHOT_S3_BUCKET'],
        message: 'SCREENSHOT_S3_BUCKET is required when SCREENSHOT_STORAGE_DRIVER=s3',
      });
    }

    if (Boolean(env.SCREENSHOT_S3_ACCESS_KEY_ID) !== Boolean(env.SCREENSHOT_S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCREENSHOT_S3_ACCESS_KEY_ID'],
        message: 'Set both S3 access key values, or neither to use the runtime IAM role',
      });
    }

    if (env.NODE_ENV === 'production' && env.SCREENSHOT_STORAGE_DRIVER === 'local' && !env.PUBLIC_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_BASE_URL'],
        message: 'PUBLIC_BASE_URL is required for local screenshot storage in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Do not print values: they may contain secrets.
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

const env = loadEnv();
const isTest = env.NODE_ENV === 'test';
const isProduction = env.NODE_ENV === 'production';

const testDatabaseUrl = env.TEST_DATABASE_URL;
const useTestSqlite = isTest && !testDatabaseUrl;

const database = {
  url: testDatabaseUrl ?? env.DATABASE_URL,
  dialect: (useTestSqlite ? 'sqlite' : 'postgres') as 'sqlite' | 'postgres',
  storage: useTestSqlite ? ':memory:' : undefined,
  host: env.DB_HOST,
  port: env.DB_PORT,
  name: env.DB_NAME,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  ssl: env.DB_SSL,
  poolMax: 10,
  logging: env.NODE_ENV === 'development' && process.env.DB_LOGGING === 'true',
} as const;

const trustProxy = /^\d+$/.test(env.TRUST_PROXY)
  ? Number(env.TRUST_PROXY)
  : ['true', '1', 'yes', 'on'].includes(env.TRUST_PROXY);

const projectRoot = path.resolve(__dirname, '..', '..');
const screenshotLocalDir = path.isAbsolute(env.SCREENSHOT_LOCAL_DIR)
  ? env.SCREENSHOT_LOCAL_DIR
  : path.resolve(projectRoot, env.SCREENSHOT_LOCAL_DIR);
const publicBaseUrl = (env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, '');

export const config = {
  env: env.NODE_ENV,
  isProduction,
  isTest,
  isDevelopment: env.NODE_ENV === 'development',
  port: env.PORT,
  apiPrefix: '/api/v1',
  bodyLimit: env.BODY_LIMIT,
  trustProxy,
  database,
  cors: {
    origins: parseCorsOrigins(env.CORS_ORIGINS),
  },
  auth: {
    tokenPepper: env.TOKEN_PEPPER ?? 'development-only-token-pepper-do-not-use-in-production',
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    invitationTtlSeconds: env.INVITATION_TTL_SECONDS,
    maxActiveSessionsPerUser: env.MAX_ACTIVE_SESSIONS_PER_USER,
    argon2: {
      memoryCost: env.ARGON2_MEMORY_KIB,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    },
    cookie: {
      secure: env.COOKIE_SECURE ?? isProduction,
      sameSite: env.COOKIE_SAME_SITE,
      domain: env.COOKIE_DOMAIN,
    },
  },
  rateLimit: {
    enabled: env.RATE_LIMIT_ENABLED,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    loginMax: env.LOGIN_RATE_LIMIT_MAX,
  },
  timeTracking: {
    heartbeatStaleSeconds: env.HEARTBEAT_STALE_SECONDS,
    sessionStaleSeconds: env.SESSION_STALE_SECONDS,
    offlineMaxBackfillSeconds: env.OFFLINE_MAX_BACKFILL_SECONDS,
    offlineFutureSkewSeconds: env.OFFLINE_FUTURE_SKEW_SECONDS,
    activityMaxBackfillSeconds: env.ACTIVITY_MAX_BACKFILL_SECONDS,
    activityFutureSkewSeconds: env.ACTIVITY_FUTURE_SKEW_SECONDS,
    wsMaxPayloadBytes: env.WS_MAX_PAYLOAD_BYTES,
    wsSweepIntervalMs: env.WS_SWEEP_INTERVAL_SECONDS * 1000,
  },
  screenshots: {
    driver: env.SCREENSHOT_STORAGE_DRIVER,
    localDir: screenshotLocalDir,
    publicBaseUrl,
    requestTtlSeconds: env.SCREENSHOT_REQUEST_TTL_SECONDS,
    uploadTtlSeconds: env.SCREENSHOT_UPLOAD_TTL_SECONDS,
    downloadTtlSeconds: env.SCREENSHOT_DOWNLOAD_TTL_SECONDS,
    cleanupIntervalMs: env.SCREENSHOT_CLEANUP_INTERVAL_SECONDS * 1000,
    maxBytes: env.SCREENSHOT_MAX_BYTES,
    allowedContentTypes: env.SCREENSHOT_ALLOWED_CONTENT_TYPES,
    s3: {
      bucket: env.SCREENSHOT_S3_BUCKET,
      region: env.SCREENSHOT_S3_REGION,
      endpoint: env.SCREENSHOT_S3_ENDPOINT,
      accessKeyId: env.SCREENSHOT_S3_ACCESS_KEY_ID,
      secretAccessKey: env.SCREENSHOT_S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.SCREENSHOT_S3_FORCE_PATH_STYLE,
    },
  },
  logLevel: env.LOG_LEVEL,
  paths: {
    root: projectRoot,
  },
} as const;

export type AppConfig = typeof config;

if (!isTest && !env.TOKEN_PEPPER) {
  // eslint-disable-next-line no-console
  console.warn('[config] TOKEN_PEPPER is not set; using an insecure development default.');
}
