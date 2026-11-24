import { loadAdminWebEnv, type AdminWebEnv } from '@esamagri/config/admin-web-env';

/**
 * Validated, typed environment for the admin app. Same rule as the
 * customer app: Vite exposes only VITE_-prefixed variables and inlines
 * them into the browser bundle, so none of these is ever a secret.
 * Staff passwords, TOTP secrets and every authorization decision live
 * server-side in apps/api.
 */
export const env: AdminWebEnv = loadAdminWebEnv(import.meta.env as unknown as Record<string, string | undefined>);
