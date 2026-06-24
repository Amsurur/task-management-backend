// Global test setup (loaded before every test file via vitest `setupFiles`).
//
// Provides safe defaults for the env vars that `src/config` validates at import,
// so unit tests can import application modules without a real `.env`. Individual
// integration tests may still point DATABASE_URL at a live test database.

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@localhost:5432/taskmgmt_test?schema=public';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars-long';
process.env.LOG_LEVEL ??= 'silent';
