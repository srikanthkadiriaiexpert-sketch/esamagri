/**
 * Barrel export for @esamagri/shared-types.
 *
 * This package is the single source of truth for staff roles, permission
 * codes, and the API error envelope shared across apps/api,
 * apps/customer-web, and apps/admin-web. All three must import these
 * from here rather than redeclaring local copies, so that a change in
 * the approved Phase 2 database contract (roles, permissions) becomes a
 * compile error everywhere it matters instead of a silent drift.
 */
export * from './roles';
export * from './permissions';
export * from './module-scope';
export * from './errors';
