import os from 'node:os';
import path from 'node:path';

/**
 * Runs before every test module. Configuration is read at import time, so all
 * environment values must be set here.
 *
 * Tests use an in-memory SQLite database unless TEST_DATABASE_URL is provided
 * (PostgreSQL). No external services are required for the default suite.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.TOKEN_PEPPER = 'test-only-token-pepper-with-at-least-32-characters';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAME_SITE = 'lax';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.REFRESH_TOKEN_TTL_SECONDS = '2592000';
process.env.INVITATION_TTL_SECONDS = '604800';
process.env.ARGON2_MEMORY_KIB = '4096';
process.env.ARGON2_TIME_COST = '1';
process.env.ARGON2_PARALLELISM = '1';

// Screenshot tests use the local adapter in an OS temp directory. The small
// size cap makes oversized-upload tests cheap while still exercising Express'
// raw-body limit and the storage-level validation.
process.env.SCREENSHOT_STORAGE_DRIVER = 'local';
process.env.SCREENSHOT_LOCAL_DIR = path.join(
  os.tmpdir(),
  `temponest-test-screenshots-${process.env.VITEST_WORKER_ID ?? process.pid}`,
);
process.env.PUBLIC_BASE_URL = 'http://localhost:4000';
process.env.SCREENSHOT_REQUEST_TTL_SECONDS = '300';
process.env.SCREENSHOT_UPLOAD_TTL_SECONDS = '120';
process.env.SCREENSHOT_DOWNLOAD_TTL_SECONDS = '2';
process.env.SCREENSHOT_CLEANUP_INTERVAL_SECONDS = '60';
process.env.SCREENSHOT_MAX_BYTES = '4096';
process.env.SCREENSHOT_ALLOWED_CONTENT_TYPES = 'image/png,image/jpeg,image/webp';

// Never allow a developer's DATABASE_URL to be used by the test suite.
delete process.env.DATABASE_URL;
