import { z } from 'zod';
import { loadEnv } from './env-utils';

/**
 * Environment configuration for apps/admin-web (Vite/React, desktop-first).
 *
 * Same rule as customer-web: everything here ships to the browser bundle,
 * so no secret belongs in this schema. Staff authentication (password,
 * TOTP) and all authorization happen server-side in apps/api.
 */
export const adminWebEnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url('Required — e.g. https://api.esamagri.example'),
  VITE_APP_NAME: z.string().min(1).default('e Samagri Admin'),
  VITE_ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
});

export type AdminWebEnv = z.infer<typeof adminWebEnvSchema>;

/**
 * Validates `source` (pass `import.meta.env` in real use) and returns
 * fully-typed config, or throws with every problem listed at once.
 */
export function loadAdminWebEnv(source: Record<string, string | undefined>): AdminWebEnv {
  return loadEnv(adminWebEnvSchema, source, 'admin-web');
}
