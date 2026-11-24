import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Component-test configuration, kept separate from vite.config.ts so the
 * production build (and its PWA plugin) is never loaded by the test run.
 *
 * `env` supplies the same variables packages/config's zod schema
 * validates at import time — without them, importing src/env.ts throws
 * before a single test body runs. These are test values, not secrets:
 * VITE_* variables are public by definition (Vite inlines them into the
 * client bundle), which is exactly why no secret is ever placed in one.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: {
      VITE_API_BASE_URL: 'http://localhost:3000',
      VITE_APP_NAME: 'e Samagri',
      VITE_ENVIRONMENT: 'development',
    },
  },
});
