import { z } from 'zod';
import { loadEnv } from './env-utils';

/**
 * Environment configuration for apps/customer-web (Vite/React/PWA).
 *
 * Everything here ends up in the built JS bundle and is readable by
 * anyone who opens the app — so this file must NEVER declare a secret.
 * Vite only exposes variables prefixed VITE_ to client code by design;
 * this schema mirrors that boundary deliberately. Any credential the
 * customer app needs (there should be none — OTP verification, session
 * issuance, etc. all happen server-side) is a sign something is wrong,
 * not a var to add here.
 */
/**
 * The API base may be written two ways, and the difference matters.
 *
 *   ABSOLUTE   http://localhost:3000 — the browser talks to the API
 *              directly, which is cross-origin and therefore needs the
 *              API's CORS allowlist to name this app's exact origin.
 *   SAME-ORIGIN  /api — the browser talks to the host it already loaded
 *              the app from, and the dev server (or the production
 *              reverse proxy) forwards to the API. No CORS is involved,
 *              and the refresh cookie is set on whatever host the person
 *              actually typed. That is what makes one build serve both
 *              http://localhost:5173 and http://<lan-ip>:5173.
 *
 * WHY THE RELATIVE FORM IS MATCHED SO NARROWLY. `//evil.example` is a
 * protocol-relative URL: it looks relative and is not — the browser
 * reads it as another origin, so every API call and the access token
 * attached to it would leave for a host nobody configured. It is
 * rejected here rather than anywhere later. A bare `/` is rejected too,
 * because every caller composes `${base}${path}` where path already
 * begins with a slash, and `/` + `/auth/refresh` is `//auth/refresh` —
 * protocol-relative again, by accident. For the same composition rule a
 * trailing slash is refused: `/api/` would yield `/api//auth/refresh`.
 */
const SAME_ORIGIN_API_PATH = /^\/(?!\/)[A-Za-z0-9._~\-]+(?:\/[A-Za-z0-9._~\-]+)*$/;

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const apiBaseUrl = z
  .string()
  .min(1)
  .refine((value) => SAME_ORIGIN_API_PATH.test(value) || isAbsoluteHttpUrl(value), {
    message:
      'Required — either an absolute http(s) URL (e.g. https://api.esamagri.example) or a same-origin path beginning with a single "/" and no trailing slash (e.g. /api)',
  });

export const customerWebEnvSchema = z.object({
  VITE_API_BASE_URL: apiBaseUrl,
  VITE_APP_NAME: z.string().min(1).default('e Samagri'),
  VITE_ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
});

export type CustomerWebEnv = z.infer<typeof customerWebEnvSchema>;

/**
 * Validates `source` (pass `import.meta.env` in real use) and returns
 * fully-typed config, or throws with every problem listed at once.
 */
export function loadCustomerWebEnv(source: Record<string, string | undefined>): CustomerWebEnv {
  return loadEnv(customerWebEnvSchema, source, 'customer-web');
}
