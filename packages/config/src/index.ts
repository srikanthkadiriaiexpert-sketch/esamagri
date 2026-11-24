/**
 * Root barrel — includes api-env.ts, which reads `process.env` and
 * therefore needs Node types in scope. This is fine for apps/api
 * (Node-only), but a browser app (apps/customer-web, apps/admin-web)
 * must NOT import from this root barrel, or its TypeScript project ends
 * up transitively type-checking Node-only code. Browser apps import the
 * narrower subpaths instead: '@esamagri/config/customer-web-env' or
 * '@esamagri/config/admin-web-env' (see this package's "exports" map).
 */
export * from './env-utils';
export * from './api-env';
export * from './customer-web-env';
export * from './admin-web-env';
