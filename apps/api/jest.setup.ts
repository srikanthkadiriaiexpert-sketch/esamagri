import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs once per test file, before the file's own imports are evaluated
 * (see jest.config.cjs's `setupFiles`). ConfigModule.forRoot's
 * `validate` (loadApiEnv, @esamagri/config) runs synchronously the
 * moment app.module.ts is imported, so a valid fixture env must already
 * be in place by then — a test-local beforeAll() runs too late.
 *
 * These are throwaway, non-production values — this file is test-only
 * infrastructure, never loaded outside `jest`, and does not appear in
 * any real deployment's configuration.
 *
 * DATABASE_URL here must be a REAL, reachable database (STEP 5 wired
 * DatabaseModule into AppModule, and it connects during onModuleInit,
 * so any test that boots the full AppModule — e.g. app.e2e.spec.ts —
 * now needs a live PostgreSQL). It points at the same local
 * `esamagri_test` database (24 approved migrations applied, nothing
 * else) that database.integration.spec.ts uses, via `esamagri_app` — a
 * login role that is a member of the approved app_shared/app_rik/
 * app_pif roles (migration 0018), not a role the migrations created
 * themselves. See the STEP 5 report for why a combined role was
 * needed: the single NestJS process serves all modules from one DB
 * connection, unlike the migrations' assumption of one role per module.
 */
/**
 * Uploaded pictures go to a throwaway directory for the test run.
 *
 * It has to be decided HERE rather than in a suite's beforeAll, because
 * ConfigModule.forRoot validates the environment synchronously while
 * app.module.ts is being imported — which happens before any hook runs. A
 * suite that set the variable later would silently exercise the shipped
 * default and write into the repository's own `var/` folder.
 */
const mediaRoot = mkdtempSync(join(tmpdir(), 'esamagri-test-media-'));

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3000',
  PIF_MEDIA_ROOT: join(mediaRoot, 'pif-media'),
  RIK_MEDIA_ROOT: join(mediaRoot, 'rik-media'),
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://esamagri_app:devpass@localhost:5432/esamagri_test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  REFRESH_COOKIE_DOMAIN: 'localhost',
  OTP_HASH_PEPPER: 'b'.repeat(16),
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
});
