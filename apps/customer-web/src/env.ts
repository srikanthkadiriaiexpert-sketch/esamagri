import { loadCustomerWebEnv, type CustomerWebEnv } from '@esamagri/config/customer-web-env';
// Deliberately importing the narrow subpath, not '@esamagri/config' — the
// root barrel also exports api-env.ts, which is Node-only (reads
// process.env) and must never be pulled into a browser bundle's
// TypeScript project. See packages/config/src/index.ts.

/**
 * Validated, typed environment for customer-web. Loaded once at module
 * init from `import.meta.env` (Vite only exposes VITE_-prefixed vars to
 * client code — see @esamagri/config/customer-web-env for the schema
 * and the rule that nothing here may ever be a secret).
 */
export const env: CustomerWebEnv = loadCustomerWebEnv(import.meta.env as unknown as Record<string, string | undefined>);
